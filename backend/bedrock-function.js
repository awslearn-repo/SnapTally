const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// Initialize AWS clients
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });

const NOVA_MODEL_ID = 'amazon.nova-lite-v1:0';

exports.handler = async (event) => {
  try {
    console.log('Bedrock Nova Lite processing started');
    
    const { receiptId, textractResult, s3Bucket, s3Key } = event;
    
    if (!receiptId || !textractResult) {
      throw new Error('Missing required parameters: receiptId or textractResult');
    }

    console.log(`Processing receipt ${receiptId} with Nova Lite multimodal AI`);

    // Download image from S3 for Nova Lite vision processing
    let imageBase64 = null;
    if (s3Bucket && s3Key) {
      try {
        console.log('Downloading image from S3 for Nova Lite vision...');
        const getObjectCommand = new GetObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key
        });

        const s3Response = await s3Client.send(getObjectCommand);
        
        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of s3Response.Body) {
          chunks.push(chunk);
        }
        const imageBuffer = Buffer.concat(chunks);
        imageBase64 = imageBuffer.toString('base64');
        
        console.log(`✅ Downloaded image for Nova Lite: ${Math.round(imageBuffer.length / 1024)} KB`);
        
      } catch (s3Error) {
        console.error('❌ Failed to download image from S3 for Nova Lite:', s3Error);
        // Continue without image for Nova Lite (text-only processing)
      }
    }

    // Create enhanced prompt for Nova Lite using Textract data
    const prompt = createNovaReceiptParsingPrompt(textractResult);
    
    console.log('Calling Nova Lite with multimodal input...');
    
    // Prepare Nova Lite request with both text and image
    const novaRequest = {
      messages: [
        {
          role: "user",
          content: [
            {
              text: prompt
            }
          ]
        }
      ],
      inferenceConfig: {
        maxTokens: 4000,
        temperature: 0.1,
        topP: 0.9
      }
    };

    // Add image for vision processing if available
    if (imageBase64) {
      novaRequest.messages[0].content.push({
        image: {
          format: "jpeg",
          source: {
            bytes: imageBase64
          }
        }
      });
      console.log('Added image to Nova Lite request for vision processing');
    } else {
      console.log('Processing with text-only (no image available)');
    }

    const command = new InvokeModelCommand({
      modelId: NOVA_MODEL_ID,
      contentType: 'application/json',
      body: JSON.stringify(novaRequest)
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const novaText = responseBody.output.message.content[0].text;

    console.log('✅ Nova Lite processing completed');
    console.log('Nova Lite response length:', novaText.length);

    // Extract JSON from Nova Lite response
    let parsedData;
    try {
      // Try to extract JSON from the response
      const jsonMatch = novaText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
        console.log('✅ Successfully parsed JSON from Nova Lite response');
      } else {
        throw new Error('No JSON found in Nova Lite response');
      }
    } catch (parseError) {
      console.warn('⚠️ Failed to parse Nova Lite JSON, using fallback data:', parseError.message);
      parsedData = createFallbackData(textractResult);
    }

    // Enhance parsed data with additional processing
    const enhancedData = enhanceParsedData(parsedData, textractResult);

    // Add confidence scoring
    enhancedData.metadata.confidence = calculateOverallConfidence(enhancedData, textractResult);

    console.log(`✅ Bedrock processing completed for receipt ${receiptId}`);
    console.log(`   - Merchant: ${enhancedData.merchant || enhancedData.vendor}`);
    console.log(`   - Total: ${enhancedData.total}`);
    console.log(`   - Items: ${enhancedData.items?.length || 0}`);
    console.log(`   - Confidence: ${Math.round(enhancedData.metadata.confidence * 100)}%`);

    return {
      receiptId,
      parsedData: enhancedData,
      textractResult, // Pass through for DynamoDB
      s3Bucket, // Pass individual components
      s3Key,
      s3Location: `s3://${s3Bucket}/${s3Key}`,
      status: 'BEDROCK_COMPLETED',
      timestamp: new Date().toISOString(),
      novaResponse: novaText.substring(0, 500) + (novaText.length > 500 ? '...' : ''), // Truncate for logging
      processingMethod: imageBase64 ? 'nova-lite-multimodal' : 'nova-lite-text-only'
    };

  } catch (error) {
    console.error('❌ Bedrock processing failed:', error);
    
    // Return fallback data in case of error
    const fallbackData = event.textractResult ? createFallbackData(event.textractResult) : {
      merchant: 'Unknown',
      total: '0.00',
      items: [],
      date: formatTodayDate()
    };

    return {
      receiptId: event.receiptId || 'unknown',
      parsedData: fallbackData,
      status: 'BEDROCK_FAILED',
      error: error.message,
      timestamp: new Date().toISOString(),
      processingMethod: 'fallback'
    };
  }
};

function createNovaReceiptParsingPrompt(textractResult) {
  const { summaryFields, lineItems, rawText } = textractResult;
  
  let prompt = `You are an expert receipt data extraction AI. Analyze this receipt data and extract structured information.

TEXTRACT STRUCTURED DATA:
Summary Fields: ${JSON.stringify(summaryFields, null, 2)}
Line Items: ${JSON.stringify(lineItems, null, 2)}

RAW TEXT:
${rawText}

Please extract and return ONLY a valid JSON object with this exact structure:
{
  "merchant": "store name",
  "vendor": "store name (same as merchant)",
  "date": "YYYY-MM-DD format",
  "total": "X.XX (final total amount)",
  "subtotal": "X.XX (before tax)",
  "tax": "X.XX (tax amount)",
  "items": [
    {
      "name": "item description",
      "price": "X.XX",
      "quantity": "1"
    }
  ]
}

IMPORTANT RULES:
1. Return ONLY valid JSON, no extra text
2. Use the most accurate data from Textract structured fields when available
3. For missing data, use reasonable defaults or "Unknown"/"0.00"
4. Ensure all prices are in X.XX format
5. Extract individual items with their prices when possible
6. If you can see the receipt image, use visual information to improve accuracy

Extract the data now:`;

  return prompt;
}

function createFallbackData(textractResult) {
  const { summaryFields, lineItems } = textractResult;
  
  // Try to extract basic info from Textract data
  const fallbackData = {
    merchant: summaryFields?.vendor || summaryFields?.name || 'Unknown Store',
    vendor: summaryFields?.vendor || summaryFields?.name || 'Unknown Store',
    date: summaryFields?.date || formatTodayDate(),
    total: summaryFields?.total || '0.00',
    subtotal: summaryFields?.subtotal || '0.00',
    tax: summaryFields?.tax || '0.00',
    items: []
  };

  // Try to extract items from line items
  if (lineItems && lineItems.length > 0) {
    fallbackData.items = lineItems.map(item => ({
      name: item.item || item.description || 'Unknown Item',
      price: item.price || item.amount || '0.00',
      quantity: item.quantity || '1'
    }));
  }

  return fallbackData;
}

function enhanceParsedData(parsedData, textractResult) {
  // Clean and validate the parsed data
  if (parsedData.total) {
    parsedData.total = cleanPrice(parsedData.total);
  }
  
  if (parsedData.subtotal) {
    parsedData.subtotal = cleanPrice(parsedData.subtotal);
  }
  
  if (parsedData.tax) {
    parsedData.tax = cleanPrice(parsedData.tax);
  }

  // Clean item prices
  if (parsedData.items && Array.isArray(parsedData.items)) {
    parsedData.items = parsedData.items.map(item => ({
      ...item,
      price: cleanPrice(item.price || '0.00'),
      quantity: item.quantity || '1'
    }));
  }

  // Add metadata
  parsedData.metadata = {
    processedBy: 'bedrock-nova-lite',
    processingTimestamp: new Date().toISOString(),
    textractFieldsUsed: Object.keys(textractResult.summaryFields || {}).length,
    lineItemsFound: (textractResult.lineItems || []).length,
    confidence: 0.85 // Will be calculated separately
  };

  return parsedData;
}

function cleanPrice(price) {
  if (!price) return '0.00';
  
  // Remove currency symbols and extra spaces
  const cleaned = price.toString().replace(/[$£€¥,\s]/g, '');
  
  // Extract number
  const match = cleaned.match(/\d+\.?\d*/);
  if (match) {
    const num = parseFloat(match[0]);
    return num.toFixed(2);
  }
  
  return '0.00';
}

function calculateOverallConfidence(parsedData, textractResult) {
  let confidence = 0.5; // Base confidence
  
  // Boost confidence based on data quality
  if (parsedData.merchant && parsedData.merchant !== 'Unknown Store') confidence += 0.2;
  if (parsedData.total && parseFloat(parsedData.total) > 0) confidence += 0.15;
  if (parsedData.items && parsedData.items.length > 0) confidence += 0.1;
  if (parsedData.date && parsedData.date !== formatTodayDate()) confidence += 0.05;
  
  // Factor in Textract confidence
  if (textractResult.confidence && textractResult.confidence.overall) {
    confidence = (confidence + textractResult.confidence.overall / 100) / 2;
  }
  
  return Math.min(confidence, 1.0);
}

function formatTodayDate() {
  return new Date().toISOString().split('T')[0];
}