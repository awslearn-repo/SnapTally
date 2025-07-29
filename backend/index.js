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
    console.log('Raw extracted text:', extractedText);
    
    // Enhanced receipt parsing with intelligence
    const receiptData = parseReceiptTextIntelligent(extractedText);
    
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
      processed: true,
      confidence: receiptData.confidence
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

function parseReceiptTextIntelligent(text) {
  const lines = text.split('\n').filter(line => line.trim()).map(line => line.trim());
  
  console.log('Processing lines:', lines);
  
  let vendor = null;
  let date = null;
  let total = null;
  let subtotal = null;
  let tax = null;
  const items = [];
  let confidence = { vendor: 0, date: 0, items: 0, total: 0 };

  // Enhanced date patterns for various formats
  const datePatterns = [
    // MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY
    /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/,
    // MM/DD/YY, MM-DD-YY
    /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})\b/,
    // DD/MM/YYYY (European format)
    /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/,
    // YYYY-MM-DD (ISO format)
    /\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/,
    // Month DD, YYYY (e.g., Jan 15, 2024)
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
    // DD Month YYYY (e.g., 15 Jan 2024)
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i
  ];

  const timePattern = /\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\b/i;
  
  // Enhanced price patterns
  const pricePatterns = [
    /\$\s*(\d+\.\d{2})/,           // $12.99
    /(\d+\.\d{2})\s*\$/,           // 12.99$
    /(\d+\.\d{2})/,                // 12.99
    /(\d+),(\d{2})/,               // European format 12,99
  ];

  // Enhanced total patterns
  const totalPatterns = [
    /(total|grand\s*total|amount\s*due|balance\s*due|final\s*total)\s*:?\s*\$?\s*(\d+[,.]?\d{2})/i,
    /(total)\s+(\d+\.\d{2})/i,
    /^(total)\s*(\d+\.\d{2})$/i,
    /(amt\s*due|amount)\s*:?\s*\$?\s*(\d+\.\d{2})/i
  ];

  // Enhanced subtotal patterns
  const subtotalPatterns = [
    /(subtotal|sub\s*total|sub-total)\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /(merchandise|merch)\s*:?\s*\$?\s*(\d+\.\d{2})/i
  ];

  // Enhanced tax patterns
  const taxPatterns = [
    /(tax|hst|gst|pst|sales\s*tax|vat)\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /(tax\s*total)\s*:?\s*\$?\s*(\d+\.\d{2})/i,
    /(\d+\.?\d*%\s*tax)\s*:?\s*\$?\s*(\d+\.\d{2})/i
  ];
  
  // Comprehensive non-item keywords
  const nonItemKeywords = [
    'total', 'subtotal', 'tax', 'cash', 'change', 'credit', 'debit', 'visa', 'mastercard',
    'thank', 'you', 'welcome', 'store', 'receipt', 'transaction', 'date', 'time',
    'cashier', 'register', 'card', 'approval', 'reference', 'auth', 'merchant',
    'phone', 'address', 'street', 'city', 'state', 'zip', 'www', 'http', '.com',
    'manager', 'customer', 'service', 'return', 'policy', 'hours', 'open', 'closed',
    'tender', 'payment', 'method', 'account', 'balance', 'points', 'rewards',
    'discount', 'coupon', 'savings', 'promotion', 'offer', 'sale'
  ];

  // Known store chains and patterns
  const storePatterns = [
    /walmart/i, /target/i, /costco/i, /home\s*depot/i, /lowes/i, /kroger/i,
    /safeway/i, /albertsons/i, /publix/i, /whole\s*foods/i, /trader\s*joe/i,
    /cvs/i, /walgreens/i, /rite\s*aid/i, /best\s*buy/i, /staples/i, /office\s*depot/i,
    /mcdonald/i, /burger\s*king/i, /kfc/i, /subway/i, /starbucks/i, /dunkin/i,
    /shell/i, /exxon/i, /chevron/i, /bp/i, /mobil/i, /texaco/i
  ];

  // First pass: Extract vendor with intelligence
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    
    // Check for known store patterns
    for (const pattern of storePatterns) {
      if (pattern.test(line)) {
        vendor = line;
        confidence.vendor = 0.9;
        break;
      }
    }
    
    // If no store pattern found, use heuristics
    if (!vendor && 
        line.length > 2 && 
        line.length < 50 &&
        !datePatterns.some(p => p.test(line)) &&
        !timePattern.test(line) &&
        !pricePatterns.some(p => p.test(line)) &&
        !line.match(/^\d+$/) &&
        !line.toLowerCase().includes('receipt') &&
        !line.toLowerCase().includes('invoice')) {
      
      // Score the line as potential vendor
      let score = 0.5;
      
      // Bonus for being early in receipt
      if (i < 3) score += 0.2;
      
      // Bonus for proper case
      if (line.match(/^[A-Z][a-z]+/)) score += 0.1;
      
      // Penalty for all caps (might be header info)
      if (line === line.toUpperCase() && line.length > 10) score -= 0.2;
      
      // Penalty for containing numbers
      if (/\d/.test(line)) score -= 0.1;
      
      if (score > confidence.vendor) {
        vendor = line;
        confidence.vendor = score;
      }
    }
    
    if (vendor && confidence.vendor > 0.8) break;
  }

  // Second pass: Extract date with multiple patterns
  for (const line of lines) {
    if (date) break;
    
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        date = match[0];
        confidence.date = 0.9;
        console.log('Found date:', date, 'in line:', line);
        break;
      }
    }
  }

  // Third pass: Extract financial information
  for (const line of lines) {
    // Extract total
    if (!total) {
      for (const pattern of totalPatterns) {
        const match = line.match(pattern);
        if (match) {
          const amount = match[2] || match[1];
          if (amount && amount.match(/\d+\.\d{2}/)) {
            total = '$' + amount;
            confidence.total = 0.9;
            console.log('Found total:', total, 'in line:', line);
            break;
          }
        }
      }
    }

    // Extract subtotal
    if (!subtotal) {
      for (const pattern of subtotalPatterns) {
        const match = line.match(pattern);
        if (match) {
          const amount = match[2];
          if (amount && amount.match(/\d+\.\d{2}/)) {
            subtotal = '$' + amount;
            break;
          }
        }
      }
    }

    // Extract tax
    if (!tax) {
      for (const pattern of taxPatterns) {
        const match = line.match(pattern);
        if (match) {
          const amount = match[2];
          if (amount && amount.match(/\d+\.\d{2}/)) {
            tax = '$' + amount;
            break;
          }
        }
      }
    }
  }

  // Fourth pass: Extract items with enhanced intelligence
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const prevLine = i > 0 ? lines[i - 1] : '';
    
    // Skip obvious non-item lines
    if (isNonItemLine(line, nonItemKeywords, totalPatterns, subtotalPatterns, taxPatterns, datePatterns)) {
      continue;
    }
    
    // Check if line contains a price
    let priceMatch = null;
    let price = null;
    
    for (const pattern of pricePatterns) {
      priceMatch = line.match(pattern);
      if (priceMatch) {
        price = priceMatch[1] || priceMatch[0];
        if (!price.includes('$')) price = '$' + price;
        break;
      }
    }
    
    if (price) {
      // Extract item name (everything except the price)
      let itemName = line;
      
      // Remove price from item name
      for (const pattern of pricePatterns) {
        itemName = itemName.replace(pattern, '').trim();
      }
      
      // Remove quantity prefix (e.g., "2 x", "3X", "QTY 2")
      const qtyPatterns = [
        /^(\d+)\s*[xX]\s*/,
        /^QTY\s*(\d+)\s*/i,
        /^(\d+)\s*@\s*/,
        /^\*\s*(\d+)\s*/
      ];
      
      let quantity = 1;
      for (const qtyPattern of qtyPatterns) {
        const qtyMatch = itemName.match(qtyPattern);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1]);
          itemName = itemName.replace(qtyPattern, '').trim();
          break;
        }
      }
      
      // Clean up item name
      itemName = cleanItemName(itemName);
      
      // Validate item name
      if (isValidItemName(itemName, nonItemKeywords)) {
        items.push({
          name: itemName || 'Item',
          price: price,
          quantity: quantity,
          lineTotal: price
        });
        
        console.log('Found item:', { name: itemName, price, quantity });
      }
    } else {
      // Check if this might be an item name with price on next line
      if (nextLine && isLikelyPrice(nextLine) && isValidItemName(line, nonItemKeywords)) {
        const nextPriceMatch = extractPrice(nextLine);
        if (nextPriceMatch) {
          items.push({
            name: cleanItemName(line),
            price: nextPriceMatch,
            quantity: 1,
            lineTotal: nextPriceMatch
          });
          
          console.log('Found split item:', { name: line, price: nextPriceMatch });
        }
      }
    }
  }

  // Fifth pass: If no items found, try fallback method
  if (items.length === 0) {
    console.log('No items found with primary method, trying fallback...');
    
    for (const line of lines) {
      // Look for any line with letters and numbers that might be an item
      if (line.length > 2 && 
          /[a-zA-Z]/.test(line) && 
          /\d/.test(line) &&
          !isNonItemLine(line, nonItemKeywords, totalPatterns, subtotalPatterns, taxPatterns, datePatterns)) {
        
        const priceMatch = extractPrice(line);
        if (priceMatch) {
          let itemName = line.replace(/\$?\d+\.\d{2}/g, '').trim();
          itemName = cleanItemName(itemName);
          
          if (itemName.length > 1) {
            items.push({
              name: itemName,
              price: priceMatch,
              quantity: 1,
              lineTotal: priceMatch
            });
          }
        }
      }
    }
  }

  confidence.items = items.length > 0 ? Math.min(0.9, items.length * 0.3) : 0;

  return {
    vendor: vendor || "Unknown Vendor",
    date: date || formatTodayDate(),
    total: total || "Unknown",
    subtotal: subtotal || null,
    tax: tax || null,
    items: items.length > 0 ? items : [{ name: "No items detected", price: "N/A", quantity: 0, lineTotal: "N/A" }],
    confidence: confidence
  };
}

// Helper functions
function isNonItemLine(line, nonItemKeywords, totalPatterns, subtotalPatterns, taxPatterns, datePatterns) {
  const lowerLine = line.toLowerCase();
  
  // Check against non-item keywords
  if (nonItemKeywords.some(keyword => lowerLine.includes(keyword))) {
    return true;
  }
  
  // Check against financial patterns
  if (totalPatterns.some(pattern => pattern.test(line)) ||
      subtotalPatterns.some(pattern => pattern.test(line)) ||
      taxPatterns.some(pattern => pattern.test(line))) {
    return true;
  }
  
  // Check against date patterns
  if (datePatterns.some(pattern => pattern.test(line))) {
    return true;
  }
  
  // Check for header/footer patterns
  if (line.match(/^[\-\*=]{3,}$/) || // divider lines
      line.match(/^#{2,}$/) ||        // hash lines
      line.match(/^\d{10,}$/) ||      // long numbers (transaction IDs)
      line.match(/^[A-Z\s]{20,}$/) || // long all caps lines
      line.length < 2) {              // too short
    return true;
  }
  
  return false;
}

function isValidItemName(name, nonItemKeywords) {
  if (!name || name.length < 2) return false;
  
  const lowerName = name.toLowerCase();
  
  // Check against non-item keywords
  if (nonItemKeywords.some(keyword => lowerName.includes(keyword))) {
    return false;
  }
  
  // Should have some letters
  if (!/[a-zA-Z]/.test(name)) return false;
  
  // Shouldn't be all numbers
  if (/^\d+$/.test(name)) return false;
  
  // Shouldn't be too long (likely description text)
  if (name.length > 40) return false;
  
  return true;
}

function cleanItemName(name) {
  if (!name) return '';
  
  return name
    .replace(/^\*+\s*/, '')           // Remove leading asterisks
    .replace(/\s*\*+$/, '')           // Remove trailing asterisks
    .replace(/^\d+\s*/, '')           // Remove leading numbers
    .replace(/\s{2,}/g, ' ')          // Normalize spaces
    .replace(/[^\w\s\-\&\.\,]/g, '')  // Remove special chars except common ones
    .trim();
}

function isLikelyPrice(line) {
  return /\$?\d+\.\d{2}/.test(line) && 
         !/[a-zA-Z]{5,}/.test(line);  // Not much text
}

function extractPrice(line) {
  const match = line.match(/\$?\d+\.\d{2}/);
  if (match) {
    let price = match[0];
    if (!price.includes('$')) price = '$' + price;
    return price;
  }
  return null;
}

function formatTodayDate() {
  const today = new Date();
  return `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;
}
