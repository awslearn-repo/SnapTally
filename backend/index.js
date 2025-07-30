const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");

// Initialize AWS clients
const sfnClient = new SFNClient({ 
  region: 'us-east-1',
  maxAttempts: 3
});

const s3Client = new S3Client({ 
  region: 'us-east-1'
});

const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;
const S3_BUCKET = process.env.S3_BUCKET || 'snaptally-receipts';

exports.handler = async (event) => {
  try {
    // Debug: Log environment variables
    console.log('Environment check:', {
      STEP_FUNCTION_ARN: STEP_FUNCTION_ARN,
      S3_BUCKET: S3_BUCKET,
      RECEIPTS_TABLE: process.env.RECEIPTS_TABLE,
      AWS_REGION: process.env.AWS_REGION
    });

    // Validate required environment variables
    if (!STEP_FUNCTION_ARN) {
      console.error('STEP_FUNCTION_ARN environment variable is not set');
      return {
        statusCode: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ 
          error: "Step Function ARN not configured",
          details: "Missing STEP_FUNCTION_ARN environment variable"
        }),
      };
    }

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ message: "CORS preflight" })
      };
    }

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

    // Generate unique receipt ID
    const receiptId = uuidv4();
    const timestamp = new Date().toISOString();
    
    console.log(`Processing receipt: ${receiptId}`);

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageSizeKB = Math.round(imageBuffer.length / 1024);
    
    console.log(`Image size: ${imageSizeKB} KB`);

    // Check reasonable image size limit (10MB)
    const maxSizeMB = 10;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    
    if (imageBuffer.length > maxSizeBytes) {
      return {
        statusCode: 400,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ 
          error: "Image too large",
          details: `Image size is ${imageSizeKB} KB. Maximum allowed is ${maxSizeMB} MB.`,
          maxSizeMB: maxSizeMB
        }),
      };
    }

    // Upload image to S3
    const s3Key = `receipts/${receiptId}/${timestamp.replace(/[:.]/g, '-')}.jpg`;
    
    try {
      console.log(`Uploading to S3: ${S3_BUCKET}/${s3Key}`);
      
      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: imageBuffer,
        ContentType: 'image/jpeg',
        Metadata: {
          receiptId: receiptId,
          uploadTimestamp: timestamp,
          originalSizeKB: imageSizeKB.toString()
        }
      });

      await s3Client.send(uploadCommand);
      console.log(`✅ Image uploaded to S3 successfully`);
      
    } catch (s3Error) {
      console.error('❌ S3 upload failed:', s3Error);
      return {
        statusCode: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ 
          error: "Failed to upload image",
          details: "Could not store image for processing",
          errorType: s3Error.name
        }),
      };
    }

    // Prepare minimal Step Function input (no image data!)
    const stepFunctionInput = {
      receiptId,
      s3Bucket: S3_BUCKET,
      s3Key: s3Key,
      timestamp: timestamp,
      requestId: event.requestContext?.requestId || 'local-test',
      imageSizeKB: imageSizeKB
    };

    // Check payload size (should be tiny now)
    const payloadString = JSON.stringify(stepFunctionInput);
    const payloadSizeBytes = Buffer.byteLength(payloadString, 'utf8');
    const payloadSizeKB = Math.round(payloadSizeBytes / 1024);
    
    console.log(`Step Function payload size: ${payloadSizeKB} KB (${payloadSizeBytes} bytes) - Image stored in S3`);

    // Start Step Function execution
    const executionName = `receipt-processing-${receiptId}`;
    console.log(`Starting Step Function execution: ${executionName}`);
    
    const command = new StartExecutionCommand({
      stateMachineArn: STEP_FUNCTION_ARN,
      name: executionName,
      input: payloadString
    });

    let result;
    try {
      result = await sfnClient.send(command);
      console.log(`✅ Step Function started successfully: ${result.executionArn}`);
    } catch (stepFunctionError) {
      console.error('❌ Step Function execution failed:', stepFunctionError);
      
      // Clean up S3 object if Step Function fails
      try {
        const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
        await s3Client.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key
        }));
        console.log('🧹 Cleaned up S3 object after Step Function failure');
      } catch (cleanupError) {
        console.error('Failed to cleanup S3 object:', cleanupError);
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
          error: "Failed to start processing",
          details: stepFunctionError.message,
          errorType: stepFunctionError.name
        }),
      };
    }

    return {
      statusCode: 202, // Accepted - processing started
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
        success: true,
        receiptId,
        message: "Receipt processing started",
        executionArn: result.executionArn,
        status: "PROCESSING",
        s3Location: `s3://${S3_BUCKET}/${s3Key}`,
        imageSizeKB: imageSizeKB,
        payloadSizeKB: payloadSizeKB
      }),
    };

  } catch (err) {
    console.error('Error starting receipt processing:', err);
    
    return {
      statusCode: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({ 
        error: "Failed to start receipt processing",
        details: err.message,
        errorType: err.name || 'Unknown'
      }),
    };
  }
};
