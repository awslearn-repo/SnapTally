const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Initialize Bedrock client
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

const CLAUDE_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

exports.handler = async (event) => {
  try {
    console.log('Starting Bedrock Claude processing');
    
    const { receiptId, textractResult } = event;
    
    if (!textractResult || !textractResult.rawText) {
      throw new Error('No Textract result or raw text provided');
    }

    // Prepare the prompt for Claude
    const prompt = createReceiptParsingPrompt(textractResult);
    
    console.log(`Processing receipt ${receiptId} with Claude. Raw text length: ${textractResult.rawText.length}`);

    // Prepare the request for Claude
    const claudeRequest = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent parsing
      top_p: 0.9
    };

    // Call Bedrock Claude
    const command = new InvokeModelCommand({
      modelId: CLAUDE_MODEL_ID,
      contentType: 'application/json',
      body: JSON.stringify(claudeRequest)
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log('Claude processing completed');

    // Parse Claude's response
    let parsedData;
    try {
      // Extract JSON from Claude's response
      const claudeText = responseBody.content[0].text;
      console.log('Claude raw response:', claudeText);
      
      // Try to extract JSON from the response
      const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in Claude response');
      }
    } catch (parseError) {
      console.error('Error parsing Claude response:', parseError);
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
      claudeResponse: responseBody.content[0].text
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

function createReceiptParsingPrompt(textractResult) {
  const { summaryFields, lineItems, rawText } = textractResult;
  
  let prompt = `You are an expert at parsing receipt data. I will provide you with raw text from a receipt and some structured data from AWS Textract. Please extract the following information and return it in JSON format only (no other text):

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

TEXTRACT STRUCTURED DATA:
`;

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

  prompt += `\nRAW TEXT FROM RECEIPT:
${rawText}

INSTRUCTIONS:
1. Use the structured Textract data when available and confident
2. Fall back to raw text parsing for missing or low-confidence data
3. For merchant name, look for the business name (usually at the top)
4. For date, convert to MM/DD/YYYY format
5. For items, extract the product name, quantity (default 1 if not specified), individual price, and line total
6. Ensure all prices are in XX.XX format without currency symbols
7. If you cannot find a field, use null for optional fields or "Unknown" for required fields
8. Return ONLY the JSON object, no explanations or additional text

JSON Response:`;

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
    processedBy: 'bedrock-claude',
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