import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// a lambda handler for placing a new tire order
export const orderStockHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "order-stock.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    // log the clientId (consumer) and the apiKeyId that they used to show this working
    console.log(`clientId: ${event.requestContext.authorizer?.claims.sub}`); // this is the car company id
    console.log(`apiKey: ${event.requestContext.identity.apiKeyId}`); // this is the specific api key used

    const order = JSON.parse(event.body as string);

    const tireOrderId = uuid();

    console.log(`${prefix} - tire order id ${tireOrderId}`);

    // create the tire order for the associated car
    const tireOrder = {
      id: tireOrderId,
      carOrderId: order.id,
      carType: order.type,
      orderStatus: "OrderSubmitted",
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: process.env.TABLE as string,
      Item: tireOrder,
    };

    // write the new tire order to the table with status 'OrderSubmitted'
    await dynamoDb.put(params).promise();

    console.log(`response: ${JSON.stringify(tireOrder)}`);

    return {
      statusCode: 201,
      body: JSON.stringify(tireOrder),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};
