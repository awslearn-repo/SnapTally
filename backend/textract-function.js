const { TextractClient, AnalyzeExpenseCommand, DetectDocumentTextCommand } = require("@aws-sdk/client-textract");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// Initialize AWS clients
const textract = new TextractClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });

exports.handler = async (event) => {
  try {
    console.log('Textract Lambda received event:', JSON.stringify(event, null, 2));

    // Extract S3 information from event
    const { receiptId, s3Bucket, s3Key, timestamp } = event;

    if (!receiptId || !s3Bucket || !s3Key) {
      throw new Error('Missing required parameters: receiptId, s3Bucket, or s3Key');
    }

    console.log(`Processing receipt ${receiptId} from S3: ${s3Bucket}/${s3Key}`);

    // Download image from S3
    let imageBuffer;
    try {
      console.log('Downloading image from S3...');
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
      imageBuffer = Buffer.concat(chunks);
      
      console.log(`✅ Downloaded image from S3: ${Math.round(imageBuffer.length / 1024)} KB`);
      
    } catch (s3Error) {
      console.error('❌ Failed to download image from S3:', s3Error);
      throw new Error(`S3 download failed: ${s3Error.message}`);
    }

    // Analyze expense using Textract
    console.log('Starting Textract AnalyzeExpense...');
    const command = new AnalyzeExpenseCommand({
      Document: {
        Bytes: imageBuffer
      }
    });

    const textractResult = await textract.send(command);
    console.log('✅ Textract AnalyzeExpense completed');

    // Extract summary fields
    const summaryFields = {};
    const confidence = {};

    if (textractResult.ExpenseDocuments && textractResult.ExpenseDocuments.length > 0) {
      const expenseDoc = textractResult.ExpenseDocuments[0];
      
      // Extract summary fields (vendor, total, tax, etc.)
      if (expenseDoc.SummaryFields) {
        expenseDoc.SummaryFields.forEach(field => {
          const fieldType = field.Type?.Text;
          const fieldValue = field.ValueDetection?.Text;
          const fieldConfidence = field.ValueDetection?.Confidence;
          
          if (fieldType && fieldValue) {
            summaryFields[fieldType.toLowerCase()] = fieldValue;
            confidence[fieldType.toLowerCase()] = fieldConfidence;
          }
        });
      }
    }

    // Extract line items
    const lineItems = [];
    if (textractResult.ExpenseDocuments && textractResult.ExpenseDocuments.length > 0) {
      const expenseDoc = textractResult.ExpenseDocuments[0];
      
      if (expenseDoc.LineItemGroups) {
        expenseDoc.LineItemGroups.forEach(group => {
          if (group.LineItems) {
            group.LineItems.forEach(item => {
              const lineItem = {};
              if (item.LineItemExpenseFields) {
                item.LineItemExpenseFields.forEach(field => {
                  const fieldType = field.Type?.Text;
                  const fieldValue = field.ValueDetection?.Text;
                  
                  if (fieldType && fieldValue) {
                    lineItem[fieldType.toLowerCase()] = fieldValue;
                  }
                });
              }
              if (Object.keys(lineItem).length > 0) {
                lineItems.push(lineItem);
              }
            });
          }
        });
      }
    }

    // Also get raw text for LLM processing
    console.log('Getting raw text with DetectDocumentText...');
    const detectCommand = new DetectDocumentTextCommand({
      Document: {
        Bytes: imageBuffer
      }
    });

    const detectResult = await textract.send(detectCommand);
    const rawText = detectResult.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n');

    console.log('✅ Raw text extraction completed');

    // Prepare result
    const result = {
      receiptId,
      textractResult: {
        summaryFields,
        lineItems,
        rawText,
        confidence: {
          overall: Object.values(confidence).reduce((sum, conf) => sum + conf, 0) / Object.values(confidence).length || 0,
          fields: confidence
        }
      },
      s3Location: `s3://${s3Bucket}/${s3Key}`,
      status: 'TEXTRACT_COMPLETED',
      timestamp: new Date().toISOString(),
      processingTime: Date.now() - new Date(timestamp).getTime()
    };

    console.log(`✅ Textract processing completed for receipt ${receiptId}`);
    console.log(`   - Summary fields: ${Object.keys(summaryFields).length}`);
    console.log(`   - Line items: ${lineItems.length}`);
    console.log(`   - Raw text length: ${rawText.length} characters`);

    return result;

  } catch (error) {
    console.error('❌ Textract processing failed:', error);
    
    return {
      receiptId: event.receiptId || 'unknown',
      status: 'TEXTRACT_FAILED',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};