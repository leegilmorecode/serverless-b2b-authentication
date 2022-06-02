#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { TiresCompanyDestStack } from "../lib/tires-company-dest-stack";

interface TiresCompanyDestStackProps extends cdk.StackProps {
  ordersApi: string;
}

const stackProps: TiresCompanyDestStackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  ordersApi: "https://xxx.execute-api.eu-west-1.amazonaws.com/prod/orders",
};

const app = new cdk.App();
new TiresCompanyDestStack(app, "TiresCompanyDestStack", stackProps);
