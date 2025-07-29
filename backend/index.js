const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn");
const { v4: uuidv4 } = require("uuid");

// Initialize AWS clients
const sfnClient = new SFNClient({ region: 'us-east-1' });

const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;

exports.handler = async (event) => {
  try {
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

    // Start Step Function execution
    const command = new StartExecutionCommand({
      stateMachineArn: STEP_FUNCTION_ARN,
      name: executionName,
      input: JSON.stringify(stepFunctionInput)
    });

    const result = await sfnClient.send(command);
    
    console.log(`Step Function started successfully: ${result.executionArn}`);

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
        status: "PROCESSING"
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
        error: 'Failed to start receipt processing',
        details: err.message 
      }),
    };
  }
};
