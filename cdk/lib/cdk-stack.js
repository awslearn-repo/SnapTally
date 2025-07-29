const { Stack, Duration, RemovalPolicy } = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const stepfunctions = require("aws-cdk-lib/aws-stepfunctions");
const sfnTasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
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
      timeToLiveAttribute: "ttl", // Enable TTL for compliance
    });

    // Add new GSI for querying by vendor (using vendorLower field)
    receiptsTable.addGlobalSecondaryIndex({
      indexName: "VendorLowerIndex",
      partitionKey: { name: "vendorLower", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });

    // Add new GSI for querying by category
    receiptsTable.addGlobalSecondaryIndex({
      indexName: "CategoryTimestampIndex", 
      partitionKey: { name: "category", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for querying by user (ready for Cognito integration)
    receiptsTable.addGlobalSecondaryIndex({
      indexName: "UserTimestampIndex",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });

    // 👇 Lambda function for API Gateway entry point
    const apiLambda = new lambda.Function(this, "ApiLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        RECEIPTS_TABLE: receiptsTable.tableName,
      },
    });

    // 👇 Lambda function for Textract AnalyzeExpense processing
    const textractLambda = new lambda.Function(this, "TextractLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "textract-function.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(60), // Textract can take longer
      memorySize: 1024, // More memory for image processing
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
    });

    // 👇 Lambda function for Bedrock Claude processing
    const bedrockLambda = new lambda.Function(this, "BedrockLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "bedrock-function.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(120), // Bedrock can take longer
      memorySize: 512,
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
    });

    // 👇 Lambda function for DynamoDB operations
    const dynamoLambda = new lambda.Function(this, "DynamoLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "dynamodb-function.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        RECEIPTS_TABLE: receiptsTable.tableName,
      },
    });

    // 👇 Lambda function for status checking
    const statusLambda = new lambda.Function(this, "StatusLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "status-function.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        RECEIPTS_TABLE: receiptsTable.tableName,
      },
    });

    // 👇 Step Function tasks
    const textractTask = new sfnTasks.LambdaInvoke(this, "TextractTask", {
      lambdaFunction: textractLambda,
      outputPath: "$.Payload",
    });

    const bedrockTask = new sfnTasks.LambdaInvoke(this, "BedrockTask", {
      lambdaFunction: bedrockLambda,
      outputPath: "$.Payload",
    });

    const dynamoTask = new sfnTasks.LambdaInvoke(this, "DynamoTask", {
      lambdaFunction: dynamoLambda,
      outputPath: "$.Payload",
    });

    // 👇 Step Function definition
    const definition = textractTask
      .next(bedrockTask)
      .next(dynamoTask);

    // 👇 Create Step Function
    const receiptProcessingStateMachine = new stepfunctions.StateMachine(this, "ReceiptProcessingStateMachine", {
      definition,
      timeout: Duration.minutes(10),
      stateMachineName: "SnapTally-ReceiptProcessing",
    });

    // 👇 Add Step Function ARN to API Lambda environment
    apiLambda.addEnvironment("STEP_FUNCTION_ARN", receiptProcessingStateMachine.stateMachineArn);

    // 👇 Permissions for API Lambda
    receiptProcessingStateMachine.grantStartExecution(apiLambda);

    // 👇 Permissions for Textract Lambda
    textractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:AnalyzeExpense",
          "textract:DetectDocumentText"
        ],
        resources: ["*"],
      })
    );

    // 👇 Permissions for Bedrock Lambda (Nova Lite)
    bedrockLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel"
        ],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0"
        ],
      })
    );

    // 👇 Permissions for DynamoDB Lambda
    receiptsTable.grantWriteData(dynamoLambda);

    // 👇 Permissions for Status Lambda
    receiptsTable.grantReadData(statusLambda);
    statusLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "states:DescribeExecution"
        ],
        resources: ["*"],
      })
    );

    // 👇 API Gateway with enhanced routes
    const api = new apigateway.RestApi(this, "SnapTallyAPI", {
      restApiName: "SnapTally Service",
      description: "Advanced Receipt Processing API with Textract and Nova Lite",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // 👇 Receipt processing endpoint
    const receipt = api.root.addResource("receipt");
    receipt.addMethod("POST", new apigateway.LambdaIntegration(apiLambda));

    // 👇 Status checking endpoint
    const status = api.root.addResource("status");
    const statusWithId = status.addResource("{receiptId}");
    statusWithId.addMethod("GET", new apigateway.LambdaIntegration(statusLambda));

    // 👇 Output important values
    new (require("aws-cdk-lib").CfnOutput)(this, "ApiGatewayUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new (require("aws-cdk-lib").CfnOutput)(this, "DynamoDBTableName", {
      value: receiptsTable.tableName,
      description: "DynamoDB Table Name",
    });

    new (require("aws-cdk-lib").CfnOutput)(this, "StateMachineArn", {
      value: receiptProcessingStateMachine.stateMachineArn,
      description: "Step Function State Machine ARN",
    });
  }
}

module.exports = { CdkStack };
