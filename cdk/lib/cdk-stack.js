const { Stack, Duration, RemovalPolicy } = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const path = require("path");

class CdkStack extends Stack {
  /**
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // 👇 DynamoDB table for storing receipt data
    const receiptsTable = new dynamodb.Table(this, "ReceiptsTable", {
      tableName: "SnapTally-Receipts",
      partitionKey: { name: "receiptId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN, // Keep data when stack is deleted
      pointInTimeRecovery: true, // Enable backup
    });

    // Add GSI for querying by vendor
    receiptsTable.addGlobalSecondaryIndex({
      indexName: "VendorIndex",
      partitionKey: { name: "vendor", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });

    // 👇 Lambda function for receipt processing with AWS Textract
    const receiptLambda = new lambda.Function(this, "ReceiptLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(30), // Timeout for AWS Textract processing
      memorySize: 512, // Increased memory for image processing
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1', // Optimize SDK v3 performance
        RECEIPTS_TABLE: receiptsTable.tableName,
      },
    });

    // 👇 Add AWS Textract permissions to Lambda (exclusive OCR processing)
    receiptLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:DetectDocumentText",
          "textract:AnalyzeDocument" // For future enhanced features
        ],
        resources: ["*"],
      })
    );

    // 👇 Grant DynamoDB permissions to Lambda
    receiptsTable.grantWriteData(receiptLambda);

    // 👇 API Gateway with /receipt POST endpoint
    const api = new apigateway.RestApi(this, "SnapTallyAPI", {
      restApiName: "SnapTally Service",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const receipt = api.root.addResource("receipt");
    receipt.addMethod("POST", new apigateway.LambdaIntegration(receiptLambda));

    // ✅ You can still add more resources here later (e.g., SQS, DynamoDB, etc.)
  }
}

module.exports = { CdkStack };
