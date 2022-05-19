import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

import { RemovalPolicy, Stack } from "aws-cdk-lib";

import { Construct } from "constructs";

interface CustomerStackProps extends cdk.StackProps {
  tiresApi: string;
}

export class CarCompanyStack extends Stack {
  constructor(scope: Construct, id: string, props?: CustomerStackProps) {
    super(scope, id, props);

    if (!props?.env?.account || !props?.env?.region || !props?.tiresApi) {
      throw new Error("props not fully supplied");
    }

    // add the appconfig application for car orders
    const configApplication: appconfig.CfnApplication =
      new appconfig.CfnApplication(this, "AppConfigApplication", {
        name: "CarOrdersConfigApplication",
        description: "App Config Application for Car Orders",
      });

    const configEnviornment = new appconfig.CfnEnvironment(
      this,
      "AppConfigEnvironment",
      {
        applicationId: configApplication.ref,
        name: "CarOrdersAppConfigEnvironment",
        description: "App Config Enviornment for Car Orders",
      }
    );

    const configProfile = new appconfig.CfnConfigurationProfile(
      this,
      "AppConfigProfile",
      {
        applicationId: configApplication.ref,
        name: "CarOrdersAppConfigProfile",
        description: "App Config profile for Car Orders",
        locationUri: "hosted",
      }
    );

    new appconfig.CfnHostedConfigurationVersion(
      this,
      "AppConfigConfigurationVersion",
      {
        applicationId: configApplication.ref,
        configurationProfileId: configProfile.ref,
        contentType: "application/json",
        latestVersionNumber: 1,
        content: JSON.stringify({ token: "none" }),
      }
    );

    const configDeploymentStrategy = new appconfig.CfnDeploymentStrategy(
      this,
      "AppConfigDepStrategy",
      {
        deploymentDurationInMinutes: 0,
        finalBakeTimeInMinutes: 0,
        growthFactor: 100,
        growthType: "LINEAR",
        replicateTo: "NONE",
        name: "CarOrdersAppConfigDepStrategy",
        description: "Car orders app config deployment strategy",
      }
    );

    new appconfig.CfnDeployment(this, "AppConfigDeployment", {
      applicationId: configApplication.ref,
      environmentId: configEnviornment.ref,
      deploymentStrategyId: configDeploymentStrategy.ref,
      configurationProfileId: configProfile.ref,
      configurationVersion: "1",
      description: "Car orders config deployment",
    });

    // create the orders table
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

    // lambda environment variables
    const environment = {
      TABLE: ordersTable.tableName,
      // app config specific
      AWS_APPCONFIG_EXTENSION_POLL_INTERVAL_SECONDS: "30",
      AWS_APPCONFIG_EXTENSION_POLL_TIMEOUT_MILLIS: "3000",
      AWS_APPCONFIG_EXTENSION_HTTP_PORT: "2772",
      // application specific i.e. feature flag
      ENVIRONMENT: configEnviornment.name,
      APPLICATION: configApplication.name,
      CONFIGURATION: configProfile.name,
      // tires api details
      TIRES_API: props.tiresApi,
    };

    // add the aws lambda layer extension for appconfig
    const appConfigLambdaLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "AppConfigLayer",
      "arn:aws:lambda:eu-west-1:434848589818:layer:AWS-AppConfig-Extension:69"
    );

    // create the lambda handler to order stock
    const orderStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "orderStockHandler", {
        functionName: "order-stock-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/order-stock/order-stock.ts"),
        memorySize: 1024,
        handler: "orderStockHandler",
        layers: [appConfigLambdaLayer],
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment,
      });

    // create a policy statement for accessing app config
    const appConfigPolicyStatement = new iam.PolicyStatement({
      actions: [
        "appconfig:GetLatestConfiguration",
        "appconfig:StartConfigurationSession",
      ],
      resources: ["*"],
      effect: iam.Effect.ALLOW,
    });

    // allow the lambda to access the configuation in app config
    orderStockHandler.role?.attachInlinePolicy(
      new iam.Policy(this, "app-config-read-policy", {
        statements: [appConfigPolicyStatement],
      })
    );

    // create the lambda handler for the webhook i.e. order complete
    const orderConfirmedWebhookHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "orderConfirmedWebhookHandler", {
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
        environment,
      });

    // allow the lambdas to write to the table
    ordersTable.grantWriteData(orderConfirmedWebhookHandler);
    ordersTable.grantWriteData(orderStockHandler);

    // create the api for the orders
    const locationsAPI: apigw.RestApi = new apigw.RestApi(this, "OrdersApi", {
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

    const orders: apigw.Resource = locationsAPI.root.addResource("orders");

    // add the endpoint for creating an order
    orders.addMethod(
      "POST",
      new apigw.LambdaIntegration(orderStockHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // add the endpoint for updating the order to state it is complete
    const item = orders.addResource("{item}");
    item.addMethod("PATCH");
  }
}
