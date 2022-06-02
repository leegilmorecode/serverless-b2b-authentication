import * as AWS from "aws-sdk";

import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

import axios from "axios";
import { decode } from "jsonwebtoken";
import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const ssm = new AWS.SSM();

// function to get the pre-generated token from param store so we don't need to
// create one every time a lambda is invoked.
async function hydrateToken(tokenParameterPath: string): Promise<string> {
  const ssmParams: AWS.SSM.GetParameterRequest = {
    Name: tokenParameterPath,
  };

  const parameter: AWS.SSM.GetParameterResult = await ssm
    .getParameter(ssmParams)
    .promise();

  if (!parameter?.Parameter?.Value) {
    throw new Error("token not found in the parameter");
  }

  // get the access token from the ssm param
  const { token: accessToken } = JSON.parse(parameter.Parameter.Value);

  return accessToken;
}

// cached access token outside of the handler for subsequent invocations
let accessToken: string;

export const orderStockHandler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = "order-stock.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      // get the environment variable params. note: these would typically be in param store as some are secret
      const {
        SSM_ORDER_STOCK_TOKEN_PARAM: tokenParameterPath,
        TIRES_API: tiresAPI,
        CAR_API: carAPI,
        TIRES_API_KEY: tiresAPIKey,
      } = process.env;

      if (!tokenParameterPath || !tiresAPI || !tiresAPIKey || !carAPI) {
        throw new Error("api parameters missing");
      }

      // if there is no token cached then hydrate it from ssm and subsequently cache it
      if (!accessToken) {
        console.log(
          `${prefix} - no access token cached - hydrating from ssm..`
        );
        accessToken = await hydrateToken(tokenParameterPath);
      } else {
        console.log(`${prefix} - access token is already cached`);
      }

      const orderId = uuid();

      console.log(`${prefix} - car order id ${orderId}`);

      // note: this would typically come from the event but for demo only its hardcoded apart from the order id
      const order = {
        id: orderId,
        status: "OrderSubmitted",
        type: "Tesla Model 3",
        price: "£47000",
      };

      const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
        TableName: process.env.TABLE as string,
        Item: order,
      };

      // write the new car order to the table
      await dynamoDb.put(params).promise();

      // Note: we should NEVER log the access token - but for this example lets look at the contents of it decoded
      const decoded = decode(accessToken, { complete: true });
      console.log(decoded);

      // make a call to the tires order api to create an order for our car
      const { data } = await axios.request({
        url: "orders",
        method: "post",
        baseURL: tiresAPI,
        headers: {
          Authorization: accessToken,
          "x-api-key": tiresAPIKey,
        },
        data: order,
      });

      console.log(`response: ${JSON.stringify(data)}`);

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
