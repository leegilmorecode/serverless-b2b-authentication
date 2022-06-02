import * as events from "aws-cdk-lib/aws-events";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as targets from "aws-cdk-lib/aws-events-targets";

import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { Construct } from "constructs";

interface TiresCompanyDestStackProps extends StackProps {
  ordersApi: string;
}

export class TiresCompanyDestStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: TiresCompanyDestStackProps
  ) {
    super(scope, id, props);

    if (!props?.ordersApi) throw new Error("missing props");

    // get the orders event bus from the other tires stack
    const ordersEventBus = events.EventBus.fromEventBusName(
      this,
      "orders-event-bus",
      "orders-event-bus"
    );

    // create the car orders connection for the api destination
    const carOrdersConnection: events.Connection = new events.Connection(
      this,
      "CarOrdersApiDestinationsConnection",
      {
        authorization: events.Authorization.apiKey(
          "x-api-key",
          SecretValue.unsafePlainText("SuperSecretKey") // this is for a demo only - never use this method in production
        ),
        description: "Car Orders API Destination Connection",
        connectionName: "CarOrdersApiDestinationsConnection",
      }
    );

    // create the api destination for the car orders connection
    const carOrdersDestination: events.ApiDestination =
      new events.ApiDestination(this, "CarOrdersDestination", {
        connection: carOrdersConnection,
        endpoint: `${props.ordersApi}/*`, // the '*' placeholder is replaced with the id using the target
        description: "The api destination for our car orders api",
        rateLimitPerSecond: 50, // this allows us to limit the requests we sent to the orders api
        httpMethod: events.HttpMethod.PATCH,
        apiDestinationName: "CarOrdersDestination",
      });

    // create the target rule for the api destination
    new events.Rule(this, "CarOrdersApiDestinationsRule", {
      eventBus: ordersEventBus,
      ruleName: "CarOrdersApiDestinationsRule",
      description: "Rule for Orders API Destination",
      eventPattern: {
        source: ["complete-order"],
        detailType: ["OrderCompleted"], // we ensure only these events are matched
      },
      targets: [
        new targets.ApiDestination(carOrdersDestination, {
          retryAttempts: 10,
          pathParameterValues: ["$.detail.carOrderId"], // we want to pass the carOrderId as the /orders/* param
          event: events.RuleTargetInput.fromEventPath("$.detail"), // we only want to pass the http body as the detail
          headerParameters: {},
          queryStringParameters: {},
          maxEventAge: Duration.minutes(60),
          deadLetterQueue: new sqs.Queue(this, "car-orders-api-dlq", {
            removalPolicy: RemovalPolicy.DESTROY,
            queueName: "car-orders-api-dlq", // we ensure any failures go to a dead letter queue
          }),
        }),
      ],
    });
  }
}
