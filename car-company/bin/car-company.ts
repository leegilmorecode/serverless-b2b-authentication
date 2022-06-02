#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { CarCompanyStack } from "../lib/car-company-stack";

interface CustomerStackProps extends cdk.StackProps {
  tiresApi: string;
  tiresApiKey: string;
  ordersClientId: string;
  ordersClientSecret: string;
  cognitoAuthUrl: string;
  orderStockScope: string;
}

// pass these through from the tires stack - these are example placeholders only
const stackProps: CustomerStackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  tiresApi: "https://xxx.execute-api.eu-west-1.amazonaws.com/prod/",
  tiresApiKey: "SuperSecretKey!12345",
  ordersClientId: "xxx",
  ordersClientSecret: "xxx",
  cognitoAuthUrl:
    "https://auth-user-pool-domain.auth.eu-west-1.amazoncognito.com",
  orderStockScope: "tires/create.order",
};

const app = new cdk.App();
new CarCompanyStack(app, "CarCompanyStack", stackProps);
