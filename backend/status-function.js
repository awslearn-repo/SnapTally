const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");
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

    // First, try to get the completed result from DynamoDB using Query (not Get)
    try {
      console.log(`Querying DynamoDB for receiptId: ${receiptId}`);
      
      const queryCommand = new QueryCommand({
        TableName: RECEIPTS_TABLE,
        KeyConditionExpression: 'receiptId = :receiptId',
        ExpressionAttributeValues: {
          ':receiptId': receiptId
        },
        ScanIndexForward: false, // Get most recent first
        Limit: 1
      });

      const dynamoResult = await docClient.send(queryCommand);
      
      if (dynamoResult.Items && dynamoResult.Items.length > 0) {
        const item = dynamoResult.Items[0];
        console.log(`✅ Found completed receipt in DynamoDB: ${receiptId}`);
        console.log(`   - Vendor: ${item.vendor}`);
        console.log(`   - Total: $${item.totalFormatted || item.total}`);
        console.log(`   - Items: ${item.itemCount || 0}`);
        
        // Transform DynamoDB item to API response format with COMPLETE data
        const receiptData = {
          vendor: item.vendor || item.merchant,
          merchant: item.vendor || item.merchant,
          date: item.date,
          total: item.totalFormatted || item.total,
          subtotal: item.subtotalFormatted || item.subtotal,
          tax: item.taxFormatted || item.tax,
          items: (item.items || []).map(dbItem => ({
            name: dbItem.name,
            price: dbItem.priceFormatted || dbItem.price,
            quantity: dbItem.quantityFormatted || dbItem.quantity,
            lineTotal: dbItem.lineTotalFormatted || dbItem.lineTotal
          })),
          itemCount: item.itemCount || 0,
          totalItems: item.totalItems || 0,
          confidence: item.confidence || 0.85,
          category: item.category || 'Other'
        };

        const responseMetadata = {
          receiptId: item.receiptId,
          timestamp: item.timestamp,
          processingMethod: item.processingMethod || 'textract-bedrock-nova',
          confidence: Math.round((item.confidence || 0.85) * 100),
          category: item.category || 'Other',
          s3Location: item.s3Location || '',
          isValid: item.isValid !== false,
          hasItems: (item.items || []).length > 0
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
            message: 'Receipt processing completed',
            data: receiptData,
            metadata: responseMetadata
          })
        };
      } else {
        console.log(`❌ No completed receipt found in DynamoDB for: ${receiptId}`);
      }

    } catch (dynamoError) {
      console.error('❌ DynamoDB query error:', dynamoError);
    }

    // If not found in DynamoDB, check Step Function execution status
    if (executionArn) {
      try {
        console.log(`Checking Step Function execution: ${executionArn}`);
        
        const describeCommand = new DescribeExecutionCommand({
          executionArn: executionArn
        });

        const executionResult = await sfnClient.send(describeCommand);
        console.log(`Step Function status: ${executionResult.status}`);

        if (executionResult.status === 'SUCCEEDED') {
          // Parse the output to get the final result
          let finalOutput = null;
          try {
            if (executionResult.output) {
              finalOutput = JSON.parse(executionResult.output);
              console.log('Step Function completed with output:', JSON.stringify(finalOutput, null, 2));
            }
          } catch (parseError) {
            console.error('Failed to parse Step Function output:', parseError);
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
              success: true,
              receiptId,
              status: 'COMPLETED',
              message: 'Receipt processing completed',
              data: finalOutput?.savedData || null,
              metadata: {
                executionArn: executionArn,
                stepFunctionStatus: executionResult.status,
                processingMethod: 'step-function-completed'
              }
            })
          };

        } else if (executionResult.status === 'FAILED') {
          return {
            statusCode: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "Content-Type",
              "Access-Control-Allow-Methods": "GET, OPTIONS"
            },
            body: JSON.stringify({
              success: false,
              receiptId,
              status: 'FAILED',
              message: 'Receipt processing failed',
              error: executionResult.cause || 'Step Function execution failed',
              data: null
            })
          };

        } else {
          // Still processing
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
              message: 'Receipt processing in progress',
              data: null,
              metadata: {
                executionArn: executionArn,
                stepFunctionStatus: executionResult.status
              }
            })
          };
        }

      } catch (stepFunctionError) {
        console.error('❌ Step Function status check error:', stepFunctionError);
      }
    }

    // Default response if no execution ARN provided and not found in DB
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
        message: 'Receipt processing in progress',
        data: null
      })
    };

  } catch (error) {
    console.error('❌ Status check error:', error);
    
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: JSON.stringify({
        success: false,
        error: 'Failed to check receipt status',
        details: error.message
      })
    };
  }
};