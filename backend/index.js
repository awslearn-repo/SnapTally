const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn");
const { v4: uuidv4 } = require("uuid");

// Initialize AWS clients
const sfnClient = new SFNClient({ region: 'us-east-1' });

const STEP_FUNCTION_ARN = process.env.STEP_FUNCTION_ARN;

exports.handler = async (event) => {
  try {
    // Debug: Log environment variables
    console.log('Environment check:', {
      STEP_FUNCTION_ARN: STEP_FUNCTION_ARN,
      RECEIPTS_TABLE: process.env.RECEIPTS_TABLE,
      hasStepFunctionArn: !!STEP_FUNCTION_ARN
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
    console.log(`Attempting to start Step Function with ARN: ${STEP_FUNCTION_ARN}`);
    
    const command = new StartExecutionCommand({
      stateMachineArn: STEP_FUNCTION_ARN,
      name: executionName,
      input: JSON.stringify(stepFunctionInput)
    });

    console.log('Step Function command:', {
      stateMachineArn: command.input.stateMachineArn,
      name: command.input.name,
      inputLength: command.input.input?.length
    });

    // Add try-catch specifically around the Step Function call
    let result;
    try {
      result = await sfnClient.send(command);
      console.log(`Step Function started successfully: ${result.executionArn}`);
    } catch (stepFunctionError) {
      console.error('Step Function specific error:', stepFunctionError);
      console.error('Step Function error details:', {
        name: stepFunctionError.name,
        message: stepFunctionError.message,
        code: stepFunctionError.code,
        statusCode: stepFunctionError.$metadata?.httpStatusCode,
        requestId: stepFunctionError.$metadata?.requestId,
        attempts: stepFunctionError.$metadata?.attempts,
        totalRetryDelay: stepFunctionError.$metadata?.totalRetryDelay
      });
      
      // Try to get the raw response if available
      if (stepFunctionError.$response) {
        console.error('Raw AWS response:', {
          statusCode: stepFunctionError.$response.statusCode,
          headers: stepFunctionError.$response.headers,
          hasBody: !!stepFunctionError.$response.body
        });
        
        // Try to log the body if it's readable
        try {
          if (stepFunctionError.$response.body && typeof stepFunctionError.$response.body.toString === 'function') {
            const responseBody = stepFunctionError.$response.body.toString();
            console.error('Raw response body (first 500 chars):', responseBody.substring(0, 500));
          }
        } catch (bodyLogError) {
          console.error('Could not log response body:', bodyLogError.message);
        }
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
        status: "PROCESSING"
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
