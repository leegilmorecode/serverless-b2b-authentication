import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as cr from "aws-cdk-lib/custom-resources";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as targets from "aws-cdk-lib/aws-events-targets";

import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";

import { Construct } from "constructs";

interface CustomerStackProps extends cdk.StackProps {
  tiresApi: string;
  tiresApiKey: string;
  ordersClientId: string;
  ordersClientSecret: string;
  cognitoAuthUrl: string;
  orderStockScope: string;
}

export class CarCompanyStack extends Stack {
  constructor(scope: Construct, id: string, props?: CustomerStackProps) {
    super(scope, id, props);

    if (
      !props?.env?.account ||
      !props?.env?.region ||
      !props?.tiresApi ||
      !props?.tiresApiKey ||
      !props?.ordersClientId ||
      !props?.ordersClientSecret ||
      !props?.cognitoAuthUrl ||
      !props?.orderStockScope
    ) {
      throw new Error("props not fully supplied");
    }

    // create the api for the car orders
    const ordersAPI: apigw.RestApi = new apigw.RestApi(this, "OrdersApi", {
      description: "orders api",
      restApiName: "orders-api",
      deploy: true,
      deployOptions: {
        stageName: "prod",
        dataTraceEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: true,
        metricsEnabled: true,
      },
    });

    // create the ssm value for the storing of the generated access token
    const tokenParam: ssm.StringParameter = new ssm.StringParameter(
      this,
      "OrderStockToken",
      {
        parameterName: "/lambda/order-stock/token",
        stringValue: JSON.stringify({ token: "" }),
        description: "the access token for the order stock lambda",
        type: ssm.ParameterType.STRING,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // create the orders table for storing the car orders
    const ordersTable: dynamodb.Table = new dynamodb.Table(
      this,
      "CarOrdersTable",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: "CarOrders",
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: "id",
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    const ordersStockEnvVars = {
      SSM_ORDER_STOCK_TOKEN_PARAM: tokenParam.parameterName,
      TABLE: ordersTable.tableName,
      TIRES_API: props.tiresApi,
      TIRES_API_KEY: props.tiresApiKey,
    };

    // create the lambda handler to order stock
    const orderStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "OrderStockHandler", {
        functionName: "order-stock-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/order-stock/order-stock.ts"),
        memorySize: 1024,
        handler: "orderStockHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          ...ordersStockEnvVars,
        },
      });

    // Lambda to generate a token on a CRON and push to ssm
    const generateTokenHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "GenerateTokenHandler", {
        functionName: "generate-token-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/generate-token-cron/generate-token-cron.ts"
        ),
        memorySize: 1024,
        handler: "generateTokenHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          SSM_ORDER_STOCK_TOKEN_PARAM: tokenParam.parameterName,
          ORDER_STOCK_SCOPE: props.orderStockScope,
          AUTH_URL: props.cognitoAuthUrl,
          ORDERS_CLIENT_ID: props.ordersClientId,
          ORDERS_CLIENT_SECRET: props.ordersClientSecret,
        },
      });

    // ensure there is a rule to run the lambda every hour for generating the new access token
    const generateTokenRule = new events.Rule(this, "GenerateTokenRule", {
      schedule: events.Schedule.rate(Duration.hours(1)),
    });

    generateTokenRule.addTarget(
      new targets.LambdaFunction(generateTokenHandler)
    );

    // allow the lambda to read the parameter from ssm
    tokenParam.grantRead(orderStockHandler);

    // allow the token generation lambda to write the token to ssm
    tokenParam.grantWrite(generateTokenHandler);

    // create the lambda handler for the webhook i.e. order complete (patch)
    const orderConfirmedWebhookHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "OrderConfirmedWebhookHandler", {
        functionName: "order-confirmed-webhook-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/order-confirmed-webhook/order-confirmed-webhook.ts"
        ),
        memorySize: 1024,
        handler: "orderConfirmedWebhookHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          SSM_ORDER_STOCK_TOKEN_PARAM: tokenParam.parameterName,
          TABLE: ordersTable.tableName,
          TIRES_API: props.tiresApi,
        },
      });

    // allow the lambdas to write to the table
    ordersTable.grantWriteData(orderConfirmedWebhookHandler);
    ordersTable.grantWriteData(orderStockHandler);

    const orders: apigw.Resource = ordersAPI.root.addResource("orders");

    // add the endpoint for creating an order (post) on /orders/
    orders.addMethod(
      "POST",
      new apigw.LambdaIntegration(orderStockHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // add the endpoint for updating the order to state it is complete i.e. (patch) on /orders/item
    const item: apigw.Resource = orders.addResource("{item}");
    item.addMethod(
      "PATCH",
      new apigw.LambdaIntegration(orderConfirmedWebhookHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // Note: circular dependency fix for api url passed into the lambda integration as env var
    new cr.AwsCustomResource(this, "UpdateEnvVars", {
      onCreate: {
        service: "Lambda",
        action: "updateFunctionConfiguration",
        parameters: {
          FunctionName: orderStockHandler.functionArn,
          Environment: {
            Variables: {
              CAR_API: ordersAPI.url,
              ...ordersStockEnvVars, // ensure we pass through all required
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of("OrdersApi"),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [orderStockHandler.functionArn],
      }),
    });

    new CfnOutput(this, "ordersAPI", {
      value: `${ordersAPI.url}orders`,
      description: "The orders API",
      exportName: "ordersAPI",
    });
  }
}
