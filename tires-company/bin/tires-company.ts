#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { TiresCompanyStack } from "../lib/tires-company-stack";

const app = new cdk.App();
new TiresCompanyStack(app, "TiresCompanyStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
