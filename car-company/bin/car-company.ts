#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { CarCompanyStack } from "../lib/car-company-stack";

interface CustomerStackProps extends cdk.StackProps {
  tiresApi: string;
}

const stackProps: CustomerStackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  tiresApi: "/api",
};

const app = new cdk.App();
new CarCompanyStack(app, "CarCompanyStack", stackProps);
