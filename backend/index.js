const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");

// Initialize AWS clients
const textract = new TextractClient({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const RECEIPTS_TABLE = process.env.RECEIPTS_TABLE || 'SnapTally-Receipts';

exports.handler = async (event) => {
  try {
    // Parse the request body
    const body = JSON.parse(event.body || '{}');
    const imageBase64 = body.image;

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    console.log(`Processing receipt with AWS Textract. Image size: ${imageBuffer.length} bytes`);

    // Use AWS Textract to extract text from the image
    const command = new DetectDocumentTextCommand({
      Document: {
        Bytes: imageBuffer
      }
    });

    const textractResult = await textract.send(command);
    
    // Extract text from Textract response
    const extractedText = textractResult.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n');

    console.log(`AWS Textract extracted ${extractedText.length} characters of text`);
    
    // Enhanced receipt parsing
    const receiptData = parseReceiptText(extractedText);
    
    // Generate unique receipt ID
    const receiptId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Prepare data for DynamoDB
    const receiptRecord = {
      receiptId,
      timestamp,
      vendor: receiptData.vendor,
      date: receiptData.date,
      total: receiptData.total,
      subtotal: receiptData.subtotal,
      tax: receiptData.tax,
      items: receiptData.items,
      rawText: extractedText,
      itemCount: receiptData.items.length,
      processed: true
    };

    // Save to DynamoDB
    try {
      await docClient.send(new PutCommand({
        TableName: RECEIPTS_TABLE,
        Item: receiptRecord
      }));
      console.log(`Receipt saved to DynamoDB with ID: ${receiptId}`);
    } catch (dbError) {
      console.error('DynamoDB save error:', dbError);
      // Continue processing even if DB save fails
    }

    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
        success: true,
        receiptId,
        data: receiptData,
        rawText: extractedText
      }),
    };
  } catch (err) {
    console.error('Error processing receipt with AWS Textract:', err);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to process receipt with AWS Textract';
    if (err.name === 'InvalidParameterException') {
      errorMessage = 'Invalid image format. Please upload a clear image (JPEG or PNG).';
    } else if (err.name === 'UnsupportedDocumentException') {
      errorMessage = 'Unsupported document type. Please upload a receipt image.';
    } else if (err.name === 'DocumentTooLargeException') {
      errorMessage = 'Image file is too large. Please upload a smaller image.';
    }
    
    return {
      statusCode: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({ 
        error: errorMessage,
        details: err.message 
      }),
    };
  }
};

function parseReceiptText(text) {
  const lines = text.split('\n').filter(line => line.trim());
  
  let vendor = null;
  let date = null;
  let total = null;
  let subtotal = null;
  let tax = null;
  const items = [];

  // Enhanced patterns for better detection
  const datePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-](\d{2}|\d{4})\b/;
  const timePattern = /\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\b/i;
  const pricePattern = /\$?\d+\.\d{2}/;
  const totalPattern = /(total|grand\s*total|amount\s*due)\s*:?\s*\$?(\d+\.\d{2})/i;
  const subtotalPattern = /(subtotal|sub\s*total)\s*:?\s*\$?(\d+\.\d{2})/i;
  const taxPattern = /(tax|hst|gst|pst|sales\s*tax)\s*:?\s*\$?(\d+\.\d{2})/i;
  
  // Common non-item keywords to filter out
  const nonItemKeywords = [
    'total', 'subtotal', 'tax', 'cash', 'change', 'credit', 'debit', 'visa', 'mastercard',
    'thank', 'you', 'welcome', 'store', 'receipt', 'transaction', 'date', 'time',
    'cashier', 'register', 'card', 'approval', 'reference', 'auth', 'merchant'
  ];

  // First pass: Extract vendor (usually first meaningful line that's not a date/time)
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    if (!vendor && 
        line.length > 2 && 
        !datePattern.test(line) && 
        !timePattern.test(line) &&
        !pricePattern.test(line) &&
        !line.match(/^\d+$/) && // Not just numbers
        line.length < 50) { // Not too long
      vendor = line;
      break;
    }
  }

  // Second pass: Extract other data
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    
    // Extract date
    if (!date && datePattern.test(line)) {
      const dateMatch = line.match(datePattern);
      if (dateMatch) {
        date = dateMatch[0];
      }
    }

    // Extract total
    if (!total && totalPattern.test(line)) {
      const totalMatch = line.match(totalPattern);
      if (totalMatch) {
        total = '$' + totalMatch[2];
      }
    }

    // Extract subtotal
    if (!subtotal && subtotalPattern.test(line)) {
      const subtotalMatch = line.match(subtotalPattern);
      if (subtotalMatch) {
        subtotal = '$' + subtotalMatch[2];
      }
    }

    // Extract tax
    if (!tax && taxPattern.test(line)) {
      const taxMatch = line.match(taxPattern);
      if (taxMatch) {
        tax = '$' + taxMatch[2];
      }
    }

    // Extract items - enhanced logic
    if (pricePattern.test(line) && 
        !totalPattern.test(line) && 
        !subtotalPattern.test(line) && 
        !taxPattern.test(line)) {
      
      const priceMatch = line.match(pricePattern);
      if (priceMatch) {
        const price = priceMatch[0];
        
        // Try to extract item name (text before the price)
        let itemName = line.replace(pricePattern, '').trim();
        
        // Clean up item name
        itemName = itemName.replace(/^\d+\s*x?\s*/i, ''); // Remove quantity prefix
        itemName = itemName.replace(/\s+/g, ' '); // Normalize spaces
        
        // Check if this looks like a real item
        const isRealItem = itemName.length > 1 && 
                          !nonItemKeywords.some(keyword => 
                            itemName.toLowerCase().includes(keyword.toLowerCase()));
        
        if (isRealItem) {
          // Try to extract quantity
          const qtyMatch = line.match(/^(\d+)\s*x?\s*/i);
          const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
          
          items.push({
            name: itemName || 'Item',
            price: price,
            quantity: quantity,
            lineTotal: price
          });
        }
      }
    }
  }

  // Fallback: if no items found, try a different approach
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for lines that might be items (have letters and numbers)
      if (line.length > 3 && 
          /[a-zA-Z]/.test(line) && 
          /\d/.test(line) &&
          !datePattern.test(line) &&
          !timePattern.test(line) &&
          !totalPattern.test(line) &&
          !subtotalPattern.test(line) &&
          !taxPattern.test(line)) {
        
        const priceMatch = line.match(/\$?(\d+\.\d{2})/);
        if (priceMatch) {
          let itemName = line.replace(/\$?\d+\.\d{2}/g, '').trim();
          if (itemName.length > 1) {
            items.push({
              name: itemName,
              price: '$' + priceMatch[1],
              quantity: 1,
              lineTotal: '$' + priceMatch[1]
            });
          }
        }
      }
    }
  }

  return {
    vendor: vendor || "Unknown Vendor",
    date: date || "Unknown Date",
    total: total || "Unknown",
    subtotal: subtotal || null,
    tax: tax || null,
    items: items.length > 0 ? items : [{ name: "No items detected", price: "N/A", quantity: 0, lineTotal: "N/A" }]
  };
}
