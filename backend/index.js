const { SFNClient, StartExecutionCommand, ListStateMachinesCommand } = require("@aws-sdk/client-sfn");
const { v4: uuidv4 } = require("uuid");

// Initialize AWS clients with explicit configuration
const sfnClient = new SFNClient({ 
  region: 'us-east-1',
  maxAttempts: 3
});

const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;

// Step Functions has a 256KB payload limit
const STEP_FUNCTION_PAYLOAD_LIMIT = 256 * 1024; // 256KB in bytes

exports.handler = async (event) => {
  try {
    // Debug: Log environment variables and AWS context
    console.log('Environment check:', {
      STEP_FUNCTION_ARN: STEP_FUNCTION_ARN,
      RECEIPTS_TABLE: process.env.RECEIPTS_TABLE,
      hasStepFunctionArn: !!STEP_FUNCTION_ARN,
      AWS_REGION: process.env.AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME
    });

    // Validate Step Function ARN
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

    // Check image size
    const imageSizeKB = Math.round((imageBase64.length * 3) / 4 / 1024); // Base64 to bytes to KB
    console.log(`Image size: ${imageSizeKB} KB`);

    if (imageBase64.length > 150000) { // ~100KB base64 limit for safety
      return {
        statusCode: 400,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ 
          error: "Image too large for processing",
          details: `Image size is ${imageSizeKB} KB. Please use an image smaller than 100 KB.`,
          maxSizeKB: 100
        }),
      };
    }

    // Generate unique receipt ID and execution name
    const receiptId = uuidv4();
    const executionName = `receipt-processing-${receiptId}`;
    
    console.log(`Starting Step Function execution for receipt: ${receiptId}`);

    // Prepare input for Step Function
    const stepFunctionInput = {
      receiptId,
      imageBase64,
      timestamp: new Date().toISOString(),
      requestId: event.requestContext?.requestId || 'local-test'
    };

    // Check total payload size
    const payloadString = JSON.stringify(stepFunctionInput);
    const payloadSizeBytes = Buffer.byteLength(payloadString, 'utf8');
    const payloadSizeKB = Math.round(payloadSizeBytes / 1024);
    
    console.log(`Step Function payload size: ${payloadSizeKB} KB (${payloadSizeBytes} bytes)`);

    if (payloadSizeBytes > STEP_FUNCTION_PAYLOAD_LIMIT) {
      console.error(`Payload too large: ${payloadSizeBytes} bytes > ${STEP_FUNCTION_PAYLOAD_LIMIT} bytes limit`);
      return {
        statusCode: 400,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({ 
          error: "Payload too large for Step Functions",
          details: `Payload is ${payloadSizeKB} KB but Step Functions limit is 256 KB`,
          payloadSizeKB: payloadSizeKB,
          limitKB: 256
        }),
      };
    }

    // Start Step Function execution
    console.log(`Attempting to start Step Function with ARN: ${STEP_FUNCTION_ARN}`);
    
    const command = new StartExecutionCommand({
      stateMachineArn: STEP_FUNCTION_ARN,
      name: executionName,
      input: payloadString
    });

    console.log('Step Function command ready:', {
      stateMachineArn: STEP_FUNCTION_ARN,
      name: executionName,
      inputSizeKB: payloadSizeKB
    });

    // Execute Step Function
    let result;
    try {
      result = await sfnClient.send(command);
      console.log(`✅ Step Function started successfully: ${result.executionArn}`);
    } catch (stepFunctionError) {
      console.error('❌ Step Function execution failed:', stepFunctionError);
      console.error('Step Function error details:', {
        name: stepFunctionError.name,
        message: stepFunctionError.message,
        code: stepFunctionError.code,
        statusCode: stepFunctionError.$metadata?.httpStatusCode,
        requestId: stepFunctionError.$metadata?.requestId
      });
      
      // Check for payload size error specifically
      if (stepFunctionError.$metadata?.httpStatusCode === 413 || 
          stepFunctionError.message?.includes('Payload Too Large') ||
          stepFunctionError.message?.includes('content length exceeded')) {
        return {
          statusCode: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS"
          },
          body: JSON.stringify({ 
            error: "Image too large for processing",
            details: "The image exceeds Step Functions payload limit. Please use a smaller image.",
            payloadSizeKB: payloadSizeKB,
            limitKB: 256
          }),
        };
      }
      
      // Check if this is a permission issue
      if (stepFunctionError.name === 'AccessDeniedException' || stepFunctionError.code === 'AccessDenied') {
        return {
          statusCode: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS"
          },
          body: JSON.stringify({ 
            error: "Permission denied to start Step Function",
            details: "Lambda function lacks permission to execute Step Function",
            stepFunctionArn: STEP_FUNCTION_ARN
          }),
        };
      }
      
      // Check if this is a resource not found issue
      if (stepFunctionError.name === 'StateMachineDoesNotExist' || stepFunctionError.code === 'StateMachineDoesNotExist') {
        return {
          statusCode: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS"
          },
          body: JSON.stringify({ 
            error: "Step Function does not exist",
            details: "The specified Step Function ARN does not exist or is in a different region",
            stepFunctionArn: STEP_FUNCTION_ARN
          }),
        };
      }
      
      // Re-throw for general error handling
      throw stepFunctionError;
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
        payloadSizeKB: payloadSizeKB
      }),
    };

  } catch (err) {
    console.error('Error starting receipt processing:', err);
    console.error('Error details:', {
      name: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.$metadata?.httpStatusCode,
      requestId: err.$metadata?.requestId
    });
    
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
