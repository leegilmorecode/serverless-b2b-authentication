import * as AWS from "aws-sdk";

import { Handler } from "aws-lambda";
import { generateAccessToken } from "../helpers/generate-token/generate-token";
import { v4 as uuid } from "uuid";

const ssm = new AWS.SSM();

export const generateTokenHandler: Handler = async (): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "generate-token.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    // get the environment variables. Note: these would typically be pulled from ssm as they are secrets
    // but keeping it simple for this example demo
    const {
      SSM_ORDER_STOCK_TOKEN_PARAM: tokenParameterPath,
      ORDER_STOCK_SCOPE: orderStockScope,
      AUTH_URL: authURL,
      ORDERS_CLIENT_ID: ordersClientId,
      ORDERS_CLIENT_SECRET: ordersClientSecret,
    } = process.env;

    if (
      !tokenParameterPath ||
      !ordersClientId ||
      !ordersClientSecret ||
      !authURL ||
      !orderStockScope
    )
      throw new Error("missing parameters");

    // generate an access token for the tires api with the order stock scope only
    const accessToken = await generateAccessToken(
      ordersClientId,
      ordersClientSecret,
      authURL,
      [orderStockScope]
    );

    const params: AWS.SSM.PutParameterRequest = {
      Name: tokenParameterPath,
      Type: "String",
      Value: JSON.stringify({ token: accessToken }),
      Overwrite: true,
    };

    // store the generated access token in ssm so we don't need to create it on each invocation
    await ssm.putParameter(params).promise();

    console.log(`${prefix} - completed`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
