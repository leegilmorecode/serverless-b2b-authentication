import * as AWS from "aws-sdk";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import axios from "axios";
import { v4 as uuid } from "uuid";

const {
  APPLICATION: application,
  ENVIRONMENT: environment,
  CONFIGURATION: configuration,
} = process.env;

// this is the app config url path for the extension
const url = `http://localhost:2772/applications/${application}/environments/${environment}/configurations/${configuration}`;

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const orderStockHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "order-stock.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    console.log(`${prefix} - grabbing config from app config`);

    const config = await axios.get(url);

    const result = config.data;

    console.log(`${prefix} - token: ${JSON.stringify(result)}`);

    const orderId = uuid();

    console.log(`${prefix} - car order id ${orderId}`);

    const order = {
      id: orderId,
    };

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
      TableName: process.env.TABLE as string,
      Item: order,
    };

    // write the new car order to the table
    await dynamoDb.put(params).promise();

    console.log(`response: ${JSON.stringify(order)}`);

    return {
      statusCode: 201,
      body: JSON.stringify(order),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: "An error occurred",
    };
  }
};
