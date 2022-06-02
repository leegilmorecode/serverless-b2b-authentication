import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as targets from "aws-cdk-lib/aws-events-targets";

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { Construct } from "constructs";
import { UserPool } from "aws-cdk-lib/aws-cognito";

export class TiresCompanyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // create the tires orders event bus
    const ordersEventBus: events.EventBus = new events.EventBus(
      this,
      "orders-event-bus",
      {
        eventBusName: "orders-event-bus",
      }
    );
    ordersEventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // create the stock table for storing the tire orders
    const stockTable: dynamodb.Table = new dynamodb.Table(
      this,
      "StockOrdersTable",
      {
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        pointInTimeRecovery: false,
        tableName: "StockOrders",
        contributorInsightsEnabled: true,
        removalPolicy: RemovalPolicy.DESTROY,
        partitionKey: {
          name: "id",
          type: dynamodb.AttributeType.STRING,
        },
      }
    );

    // create the lambda handler to order tire stock
    const orderStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "OrderStockHandler", {
        functionName: "order-stock-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/order-stock/order-stock.ts"),
        memorySize: 1024,
        handler: "orderStockHandler",
        environment: {
          TABLE: stockTable.tableName,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // create the lambda handler to update the orders on a cron
    const completeOrderHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "CompleteOrderHandler", {
        functionName: "complete-order-handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/complete-order/complete-order.ts"),
        memorySize: 1024,
        handler: "completeOrderHandler",
        environment: {
          TABLE: stockTable.tableName,
          EVENT_BUS_NAME: ordersEventBus.eventBusName,
        },
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
      });

    // allow the complete orders lambda to put events to the bus
    ordersEventBus.grantPutEventsTo(completeOrderHandler);

    // ensure there is a rule to run the lambda every minute to complete tire orders async
    const generateTokenRule: events.Rule = new events.Rule(
      this,
      "GenerateTokenRule",
      {
        schedule: events.Schedule.rate(Duration.minutes(1)),
      }
    );

    generateTokenRule.addTarget(
      new targets.LambdaFunction(completeOrderHandler)
    );

    // allow the stock handlers to write to the database
    stockTable.grantWriteData(orderStockHandler);
    stockTable.grantReadWriteData(completeOrderHandler);

    // create the api for the orders in the tires domain
    const tiresAPI: apigw.RestApi = new apigw.RestApi(this, "OrdersApi", {
      description: "tires orders api",
      restApiName: "tires-orders-api",
      deploy: true,
      deployOptions: {
        stageName: "prod",
        dataTraceEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: true,
        metricsEnabled: true,
      },
    });

    // add the usage plan for the api
    const usagePlan: apigw.UsagePlan = tiresAPI.addUsagePlan("UsagePlan", {
      name: "External",
      description: "Usage plan for external customers",
      apiStages: [
        {
          api: tiresAPI,
          stage: tiresAPI.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 10,
        burstLimit: 2,
      },
    });
    usagePlan.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // add a specific api key for the usage plan
    const keyValue = "SuperSecretKey!12345";
    const key = tiresAPI.addApiKey("ApiKey", {
      apiKeyName: "CarOrdersCompany",
      description: "The API Key for the Car Orders Company",
      value: keyValue,
    });

    usagePlan.addApiKey(key);

    // create the cognito user pool for auth
    const authUserPool: cognito.UserPool = new cognito.UserPool(
      this,
      "AuthUserPool",
      {
        userPoolName: "AuthUserPool",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    // create a user pool domain (this will allow the car orders domain to request tokens from it)
    const authUserPoolDomain: cognito.UserPoolDomain =
      new cognito.UserPoolDomain(this, "AuthUserPoolDomain", {
        userPool: authUserPool,
        cognitoDomain: {
          domainPrefix: "auth-user-pool-domain",
        },
      });

    // create the scopes which are required i.e. the order domain can request scopes for hitting the tire domain
    const createTiresOrderScope: cognito.ResourceServerScope =
      new cognito.ResourceServerScope({
        scopeName: "create.order",
        scopeDescription: "create tire order scope",
      });

    // create another scope which is never used in our example (to show multiple only)
    const cancelTiresOrderScope: cognito.ResourceServerScope =
      new cognito.ResourceServerScope({
        scopeName: "cancel.order",
        scopeDescription: "cancel tire order scope",
      });

    // create the resource server for the tires domain i.e. the tires api which will be called
    // which has multiple scopes which can be requested from a client
    const tiresDomainResourceServer: cognito.UserPoolResourceServer =
      authUserPool.addResourceServer("TiresDomainResourceServer", {
        userPoolResourceServerName: "TiresDomainResourceServer",
        identifier: "tires",
        scopes: [createTiresOrderScope, cancelTiresOrderScope],
      });

    // create the client for the car orders domain i.e. the consumer of the tires domain
    const ordersDomainClient: cognito.UserPoolClient =
      new cognito.UserPoolClient(this, "OrdersDomainClient", {
        userPool: authUserPool,
        userPoolClientName: "OrdersDomainClient",
        preventUserExistenceErrors: true,
        refreshTokenValidity: Duration.minutes(60),
        accessTokenValidity: Duration.minutes(60),
        generateSecret: true,
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
        oAuth: {
          flows: {
            clientCredentials: true,
          },
          scopes: [
            // it has the scopes assigned for hitting the tires domain to create a tire order
            cognito.OAuthScope.resourceServer(
              tiresDomainResourceServer,
              createTiresOrderScope
            ),
            // it has the scopes assigned for cancelling orders
            cognito.OAuthScope.resourceServer(
              tiresDomainResourceServer,
              cancelTiresOrderScope
            ),
          ],
        },
      });

    // access the user pool to get the arn
    const userPool: cognito.IUserPool = UserPool.fromUserPoolId(
      this,
      "UserPool",
      authUserPool.userPoolId
    );

    // add the cognito authorizer to our tires api which validates our tokens using cognito
    const cognitoAuthorizer = new apigw.CfnAuthorizer(
      this,
      "APIGatewayAuthorizer",
      {
        name: "customer-authorizer",
        identitySource: "method.request.header.Authorization",
        providerArns: [userPool.userPoolArn],
        restApiId: tiresAPI.restApiId,
        type: apigw.AuthorizationType.COGNITO,
      }
    );

    // create the tires order api
    const orders: apigw.Resource = tiresAPI.root.addResource("orders");

    // add the endpoint for creating an order including the authorizer
    orders.addMethod(
      "POST",
      new apigw.LambdaIntegration(orderStockHandler, {
        proxy: true,
        allowTestInvoke: true,
      }),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        apiKeyRequired: true, // ensure that the consumer needs to send the api key
        authorizer: { authorizerId: cognitoAuthorizer.ref }, // the cognito authoriser will ensure we have a token
        authorizationScopes: [`tires/${createTiresOrderScope.scopeName}`], // ensure the token has the correct scope
      }
    );

    // outputs
    new CfnOutput(this, "tiresApi", {
      value: tiresAPI.url,
      description: "The tires API",
      exportName: "tiresApi",
    });

    new CfnOutput(this, "tiresApiKey", {
      value: "SuperSecretKey!12345",
      description: "The tires API key",
      exportName: "tiresApiKey",
    });

    new CfnOutput(this, "ordersClientId", {
      value: ordersDomainClient.userPoolClientId,
      description: "The orders client ID",
      exportName: "ordersClientId",
    });

    new CfnOutput(this, "cognitoAuthUrl", {
      value: `https://${authUserPoolDomain.domainName}.auth.${process.env.CDK_DEFAULT_REGION}.amazoncognito.com`,
      description: "The Cognito user pool auth url",
      exportName: "cognitoAuthUrl",
    });
  }
}
