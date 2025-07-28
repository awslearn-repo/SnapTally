const { TextractClient, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");

// Initialize AWS Textract client
const textract = new TextractClient({ region: 'us-east-1' });

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
    
    // Basic receipt parsing (this is a simple implementation)
    const receiptData = parseReceiptText(extractedText);

    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
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
  const items = [];

  // Simple patterns for common receipt elements
  const datePattern = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;
  const pricePattern = /\$?\d+\.\d{2}/g;
  const totalPattern = /total.*?(\$?\d+\.\d{2})/i;

  for (const line of lines) {
    // Extract vendor (usually first meaningful line)
    if (!vendor && line.length > 3 && !datePattern.test(line) && !pricePattern.test(line)) {
      vendor = line.trim();
    }

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
        total = totalMatch[1];
      }
    }

    // Extract items (lines with prices that aren't totals)
    if (pricePattern.test(line) && !totalPattern.test(line)) {
      items.push(line.trim());
    }
  }

  return {
    vendor: vendor || "Unknown",
    date: date || "Unknown",
    total: total || "Unknown",
    items: items.length > 0 ? items : ["No items found"]
  };
}
