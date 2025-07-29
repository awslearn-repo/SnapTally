const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SFNClient, DescribeExecutionCommand } = require("@aws-sdk/client-sfn");

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sfnClient = new SFNClient({ region: 'us-east-1' });

const RECEIPTS_TABLE = process.env.RECEIPTS_TABLE || 'SnapTally-Receipts';

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, OPTIONS"
        },
        body: JSON.stringify({ message: "CORS preflight" })
      };
    }

    const receiptId = event.pathParameters?.receiptId;
    const executionArn = event.queryStringParameters?.executionArn;

    if (!receiptId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, OPTIONS"
        },
        body: JSON.stringify({ error: "Receipt ID is required" })
      };
    }

    console.log(`Checking status for receipt: ${receiptId}`);

    // First, try to get the completed result from DynamoDB
    try {
      const getCommand = new GetCommand({
        TableName: RECEIPTS_TABLE,
        Key: {
          receiptId: receiptId,
          timestamp: event.queryStringParameters?.timestamp
        }
      });

      const dynamoResult = await docClient.send(getCommand);
      
      if (dynamoResult.Item) {
        console.log(`Found completed receipt in DynamoDB: ${receiptId}`);
        
        // Transform DynamoDB item to API response format
        const receiptData = {
          vendor: dynamoResult.Item.vendor,
          date: dynamoResult.Item.date,
          total: dynamoResult.Item.total,
          subtotal: dynamoResult.Item.subtotal,
          tax: dynamoResult.Item.tax,
          items: dynamoResult.Item.items || []
        };

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, OPTIONS"
          },
          body: JSON.stringify({
            success: true,
            receiptId,
            status: 'COMPLETED',
            data: receiptData,
            metadata: {
              confidence: dynamoResult.Item.confidence,
              category: dynamoResult.Item.category,
              itemCount: dynamoResult.Item.itemCount,
              processingMethod: dynamoResult.Item.processingMethod,
              timestamp: dynamoResult.Item.timestamp
            }
          })
        };
      }
    } catch (dynamoError) {
      console.log('Receipt not found in DynamoDB yet, checking Step Function status');
    }

    // If not in DynamoDB, check Step Function execution status
    if (executionArn) {
      try {
        const describeCommand = new DescribeExecutionCommand({
          executionArn: executionArn
        });

        const executionResult = await sfnClient.send(describeCommand);
        
        console.log(`Step Function status: ${executionResult.status}`);

        let status = 'PROCESSING';
        let message = 'Receipt is being processed';

        switch (executionResult.status) {
          case 'RUNNING':
            status = 'PROCESSING';
            message = 'Receipt processing in progress';
            break;
          case 'SUCCEEDED':
            status = 'COMPLETED';
            message = 'Receipt processing completed';
            break;
          case 'FAILED':
            status = 'FAILED';
            message = 'Receipt processing failed';
            break;
          case 'TIMED_OUT':
            status = 'FAILED';
            message = 'Receipt processing timed out';
            break;
          case 'ABORTED':
            status = 'FAILED';
            message = 'Receipt processing was aborted';
            break;
        }

        // If execution succeeded but we don't have DynamoDB data, 
        // try to parse the execution output
        let data = null;
        if (executionResult.status === 'SUCCEEDED' && executionResult.output) {
          try {
            const output = JSON.parse(executionResult.output);
            if (output.parsedData) {
              data = {
                vendor: output.parsedData.merchant || output.parsedData.vendor,
                date: output.parsedData.date,
                total: output.parsedData.total,
                subtotal: output.parsedData.subtotal,
                tax: output.parsedData.tax,
                items: output.parsedData.items || []
              };
            }
          } catch (parseError) {
            console.error('Error parsing execution output:', parseError);
          }
        }

        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, OPTIONS"
          },
          body: JSON.stringify({
            success: status !== 'FAILED',
            receiptId,
            status,
            message,
            data,
            executionArn,
            executionStatus: executionResult.status
          })
        };

      } catch (sfnError) {
        console.error('Error checking Step Function status:', sfnError);
      }
    }

    // Default response if we can't determine status
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: JSON.stringify({
        success: true,
        receiptId,
        status: 'PROCESSING',
        message: 'Receipt processing in progress'
      })
    };

  } catch (error) {
    console.error('Error checking receipt status:', error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: JSON.stringify({
        error: 'Failed to check receipt status',
        details: error.message
      })
    };
  }
};