import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

// const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const orderConfirmedWebhookHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "order-confirmed-webhook.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    // const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
    //   TableName: process.env.TABLE as string,
    //   Item: order,
    // };

    // write the new car order to the table
    // await dynamoDb.put(params).promise();

    // console.log(`response: ${JSON.stringify(order)}`);

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
