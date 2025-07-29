const { TextractClient, AnalyzeExpenseCommand } = require("@aws-sdk/client-textract");

// Initialize AWS Textract client
const textract = new TextractClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  try {
    console.log('Starting Textract AnalyzeExpense processing');
    
    const { receiptId, imageBase64 } = event;
    
    if (!imageBase64) {
      throw new Error('No image data provided');
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    console.log(`Processing receipt ${receiptId} with Textract AnalyzeExpense. Image size: ${imageBuffer.length} bytes`);

    // Use AWS Textract AnalyzeExpense for receipt processing
    const command = new AnalyzeExpenseCommand({
      Document: {
        Bytes: imageBuffer
      }
    });

    const textractResult = await textract.send(command);
    console.log('Textract AnalyzeExpense completed successfully');

    // Extract structured expense data
    const expenseDocuments = textractResult.ExpenseDocuments || [];
    
    if (expenseDocuments.length === 0) {
      throw new Error('No expense documents found in the image');
    }

    const expenseDoc = expenseDocuments[0];
    
    // Extract summary fields (vendor, date, total, tax, etc.)
    const summaryFields = {};
    if (expenseDoc.SummaryFields) {
      for (const field of expenseDoc.SummaryFields) {
        const fieldType = field.Type?.Text;
        const fieldValue = field.ValueDetection?.Text;
        const confidence = field.ValueDetection?.Confidence || 0;
        
        if (fieldType && fieldValue) {
          summaryFields[fieldType] = {
            value: fieldValue,
            confidence: confidence
          };
        }
      }
    }

    // Extract line items
    const lineItems = [];
    if (expenseDoc.LineItemGroups) {
      for (const group of expenseDoc.LineItemGroups) {
        if (group.LineItems) {
          for (const item of group.LineItems) {
            const lineItem = {};
            
            if (item.LineItemExpenseFields) {
              for (const field of item.LineItemExpenseFields) {
                const fieldType = field.Type?.Text;
                const fieldValue = field.ValueDetection?.Text;
                const confidence = field.ValueDetection?.Confidence || 0;
                
                if (fieldType && fieldValue) {
                  lineItem[fieldType] = {
                    value: fieldValue,
                    confidence: confidence
                  };
                }
              }
            }
            
            if (Object.keys(lineItem).length > 0) {
              lineItems.push(lineItem);
            }
          }
        }
      }
    }

    // Also extract raw text for LLM processing
    const rawTextBlocks = [];
    
    // Get all text blocks for comprehensive text extraction
    const detectCommand = new (require("@aws-sdk/client-textract").DetectDocumentTextCommand)({
      Document: {
        Bytes: imageBuffer
      }
    });
    
    const detectResult = await textract.send(detectCommand);
    const rawText = detectResult.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n');

    console.log(`Extracted ${lineItems.length} line items and ${Object.keys(summaryFields).length} summary fields`);
    console.log('Summary fields found:', Object.keys(summaryFields));
    console.log('Raw text length:', rawText.length);

    return {
      receiptId,
      imageBase64, // Pass image to next step for Nova Lite vision processing
      textractResult: {
        summaryFields,
        lineItems,
        rawText,
        confidence: {
          summaryFields: Object.keys(summaryFields).length,
          lineItems: lineItems.length,
          textExtraction: rawText.length > 0 ? 0.9 : 0.1
        }
      },
      status: 'TEXTRACT_COMPLETED',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Textract processing error:', error);
    
    return {
      receiptId: event.receiptId,
      error: {
        message: error.message,
        type: 'TEXTRACT_ERROR'
      },
      status: 'TEXTRACT_FAILED',
      timestamp: new Date().toISOString()
    };
  }
};