import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// this example lambda is invoked via a patch on the orders api by id, which updates the overall
// car order to set the status to 'OrderCompleted' now that the tires have been provided.
export const orderConfirmedWebhookHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "order-confirmed-webhook.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event?.pathParameters?.item) throw new Error("id not passed in url");
    if (!event?.body) throw new Error("no body passed in request");

    const { item } = event.pathParameters;
    const body = JSON.parse(event.body);

    console.log(`${prefix} - Car Order: ${item}`);
    console.log(`${prefix} - Car event body: ${body}`);

    // update the car order to state it is complete using the webhook
    const params: AWS.DynamoDB.DocumentClient.UpdateItemInput = {
      TableName: process.env.TABLE as string,
      Key: {
        id: item,
      },
      UpdateExpression: "SET #status = :status",
      ConditionExpression: "attribute_exists(id)",
      ExpressionAttributeValues: {
        ":status": "OrderCompleted",
      },
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ReturnValues: "ALL_NEW",
    };

    // update the record in the table to status order completed
    await dynamoDb.update(params).promise();

    console.log(`${prefix} - Order completed for car Order: ${item}`);

    return {
      statusCode: 204,
      body: "No Content",
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};
