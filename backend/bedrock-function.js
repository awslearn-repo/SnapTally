const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Initialize Bedrock client
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

const NOVA_MODEL_ID = 'amazon.nova-lite-v1:0';

exports.handler = async (event) => {
  try {
    console.log('Starting Bedrock Nova Lite processing');
    
    const { receiptId, textractResult, imageBase64 } = event;
    
    if (!textractResult || !textractResult.rawText) {
      throw new Error('No Textract result or raw text provided');
    }

    // Prepare the prompt for Nova Lite with vision capabilities
    const prompt = createNovaReceiptParsingPrompt(textractResult);
    
    console.log(`Processing receipt ${receiptId} with Nova Lite. Raw text length: ${textractResult.rawText.length}`);

    // Prepare the request for Nova Lite with multimodal capabilities
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
        temperature: 0.1, // Low temperature for consistent parsing
        topP: 0.9
      }
    };

    // Add image if available for enhanced processing
    if (imageBase64) {
      novaRequest.messages[0].content.push({
        image: {
          format: "jpeg",
          source: {
            bytes: imageBase64
          }
        }
      });
      console.log('Added image data for Nova Lite vision processing');
    }

    // Call Bedrock Nova Lite
    const command = new InvokeModelCommand({
      modelId: NOVA_MODEL_ID,
      contentType: 'application/json',
      body: JSON.stringify(novaRequest)
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log('Nova Lite processing completed');

    // Parse Nova's response
    let parsedData;
    try {
      // Extract JSON from Nova's response
      const novaText = responseBody.output.message.content[0].text;
      console.log('Nova Lite raw response:', novaText);
      
      // Try to extract JSON from the response
      const jsonMatch = novaText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in Nova response');
      }
    } catch (parseError) {
      console.error('Error parsing Nova response:', parseError);
      // Fallback to basic structure
      parsedData = createFallbackData(textractResult);
    }

    // Enhance the parsed data with confidence scores
    const enhancedData = enhanceParsedData(parsedData, textractResult);

    console.log('Final parsed data:', JSON.stringify(enhancedData, null, 2));

    return {
      receiptId,
      parsedData: enhancedData,
      status: 'BEDROCK_COMPLETED',
      timestamp: new Date().toISOString(),
      novaResponse: responseBody.output.message.content[0].text
    };

  } catch (error) {
    console.error('Bedrock processing error:', error);
    
    // Fallback processing if Bedrock fails
    const fallbackData = createFallbackData(event.textractResult);
    
    return {
      receiptId: event.receiptId,
      parsedData: fallbackData,
      status: 'BEDROCK_FALLBACK',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        type: 'BEDROCK_ERROR'
      }
    };
  }
};

function createNovaReceiptParsingPrompt(textractResult) {
  const { summaryFields, lineItems, rawText } = textractResult;
  
  let prompt = `You are Nova Lite, an expert multimodal AI assistant. I need you to parse receipt data from both the provided image (if available) and the extracted text data. 

TASK: Extract receipt information and return ONLY a JSON object with this exact structure:

{
  "merchant": "store name",
  "date": "MM/DD/YYYY format",
  "total": "XX.XX",
  "subtotal": "XX.XX or null",
  "tax": "XX.XX or null",
  "items": [
    {
      "name": "item name",
      "quantity": 1,
      "price": "XX.XX",
      "lineTotal": "XX.XX"
    }
  ]
}

AVAILABLE DATA:

AWS Textract Structured Data:`;

  // Add Textract summary fields
  if (Object.keys(summaryFields).length > 0) {
    prompt += `\nSummary Fields:\n`;
    for (const [key, value] of Object.entries(summaryFields)) {
      prompt += `- ${key}: ${value.value} (confidence: ${value.confidence}%)\n`;
    }
  }

  // Add Textract line items
  if (lineItems.length > 0) {
    prompt += `\nLine Items:\n`;
    lineItems.forEach((item, index) => {
      prompt += `Item ${index + 1}:\n`;
      for (const [key, value] of Object.entries(item)) {
        prompt += `  - ${key}: ${value.value} (confidence: ${value.confidence}%)\n`;
      }
    });
  }

  prompt += `\nRaw Text Extracted:
${rawText}

PARSING INSTRUCTIONS:
1. If an image is provided, use your vision capabilities to verify and enhance the extracted data
2. Prioritize high-confidence Textract structured data
3. Use raw text parsing for missing or low-confidence fields
4. For merchant: Look for business name (usually at top of receipt)
5. For date: Convert any date format to MM/DD/YYYY
6. For items: Extract product names, quantities (default 1), prices, and line totals
7. For prices: Use XX.XX format without currency symbols
8. Use null for optional fields if not found, "Unknown" for required fields if not found

IMPORTANT: Return ONLY the JSON object. No explanations, no markdown formatting, no additional text.

JSON:`;

  return prompt;
}

function createFallbackData(textractResult) {
  const fallback = {
    merchant: "Unknown Vendor",
    date: formatTodayDate(),
    total: "0.00",
    subtotal: null,
    tax: null,
    items: []
  };

  if (!textractResult) {
    return fallback;
  }

  // Try to extract from Textract summary fields
  const { summaryFields } = textractResult;
  
  if (summaryFields) {
    if (summaryFields.VENDOR_NAME) {
      fallback.merchant = summaryFields.VENDOR_NAME.value;
    }
    if (summaryFields.INVOICE_RECEIPT_DATE) {
      fallback.date = summaryFields.INVOICE_RECEIPT_DATE.value;
    }
    if (summaryFields.TOTAL) {
      fallback.total = summaryFields.TOTAL.value.replace(/[^0-9.]/g, '');
    }
    if (summaryFields.SUBTOTAL) {
      fallback.subtotal = summaryFields.SUBTOTAL.value.replace(/[^0-9.]/g, '');
    }
    if (summaryFields.TAX) {
      fallback.tax = summaryFields.TAX.value.replace(/[^0-9.]/g, '');
    }
  }

  // Try to extract items from Textract line items
  const { lineItems } = textractResult;
  if (lineItems && lineItems.length > 0) {
    fallback.items = lineItems.map((item, index) => {
      return {
        name: item.ITEM?.value || `Item ${index + 1}`,
        quantity: parseInt(item.QUANTITY?.value) || 1,
        price: item.PRICE?.value?.replace(/[^0-9.]/g, '') || "0.00",
        lineTotal: item.PRICE?.value?.replace(/[^0-9.]/g, '') || "0.00"
      };
    });
  }

  return fallback;
}

function enhanceParsedData(parsedData, textractResult) {
  // Add confidence scores and validation
  const enhanced = { ...parsedData };
  
  // Ensure required fields have values
  if (!enhanced.merchant || enhanced.merchant === "") {
    enhanced.merchant = "Unknown Vendor";
  }
  
  if (!enhanced.date || enhanced.date === "") {
    enhanced.date = formatTodayDate();
  }
  
  if (!enhanced.total || enhanced.total === "") {
    enhanced.total = "0.00";
  }

  // Ensure items is an array
  if (!Array.isArray(enhanced.items)) {
    enhanced.items = [];
  }

  // Clean up item data
  enhanced.items = enhanced.items.map(item => ({
    name: item.name || "Unknown Item",
    quantity: parseInt(item.quantity) || 1,
    price: cleanPrice(item.price),
    lineTotal: cleanPrice(item.lineTotal || item.price)
  }));

  // Add metadata
  enhanced.metadata = {
    processedBy: 'bedrock-nova-lite',
    textractFieldsFound: Object.keys(textractResult.summaryFields || {}).length,
    textractItemsFound: (textractResult.lineItems || []).length,
    confidence: calculateOverallConfidence(enhanced, textractResult)
  };

  return enhanced;
}

function cleanPrice(price) {
  if (!price) return "0.00";
  
  // Remove currency symbols and extract number
  const cleaned = price.toString().replace(/[^0-9.]/g, '');
  const number = parseFloat(cleaned);
  
  if (isNaN(number)) return "0.00";
  
  return number.toFixed(2);
}

function calculateOverallConfidence(parsedData, textractResult) {
  let score = 0;
  let maxScore = 5;
  
  // Merchant confidence
  if (parsedData.merchant && parsedData.merchant !== "Unknown Vendor") {
    score += 1;
  }
  
  // Date confidence
  if (parsedData.date && parsedData.date !== formatTodayDate()) {
    score += 1;
  }
  
  // Total confidence
  if (parsedData.total && parseFloat(parsedData.total) > 0) {
    score += 1;
  }
  
  // Items confidence
  if (parsedData.items && parsedData.items.length > 0) {
    score += 1;
  }
  
  // Textract data availability
  if (textractResult.summaryFields && Object.keys(textractResult.summaryFields).length > 0) {
    score += 1;
  }
  
  return Math.round((score / maxScore) * 100);
}

function formatTodayDate() {
  const today = new Date();
  return `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
}