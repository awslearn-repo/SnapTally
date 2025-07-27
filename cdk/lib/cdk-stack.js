const { Stack, Duration } = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const path = require("path");

class CdkStack extends Stack {
  /**
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // 👇 Lambda function for receipt processing
    const receiptLambda = new lambda.Function(this, "ReceiptLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../backend")),
    });

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
