import * as AWS from "aws-sdk";

import { Handler } from "aws-lambda";
import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();

// basic handler on a cron to scan all records, filter for unprocessed, then overwrite the
// items with a new status and raise EventBridge events. Note: This is for a demo only.
export const completeOrderHandler: Handler = async (): Promise<void> => {
  try {
    const correlationId = uuid();
    const method = "complete-order.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    const { TABLE: tableName, EVENT_BUS_NAME: eventBusName } = process.env;

    if (!tableName || !eventBusName) throw new Error("missing configuration");

    const params: AWS.DynamoDB.DocumentClient.ScanInput = {
      TableName: tableName,
    };

    // get all of the existing records: Note - this is for the demo only using the scan for ease
    const records: AWS.DynamoDB.DocumentClient.ScanOutput = await dynamoDb
      .scan(params)
      .promise();

    // get the items which are still at 'OrderSubmitted' status i.e. unprocessed
    const items = records.Items
      ? records.Items?.filter((item) => item.orderStatus === "OrderSubmitted")
      : [];

    const recordsToProcess = items.map((item) => {
      const itemUpdate = {
        ...item,
        orderStatus: "OrderCompleted",
      };

      const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
        TableName: process.env.TABLE as string,
        Item: itemUpdate,
      };

      console.log(
        `${prefix} - record to update: ${JSON.stringify(itemUpdate)}`
      );

      // update the tire order. Note: for the example lets just overwrite the records
      return dynamoDb.put(params).promise();
    });

    console.log(`${prefix} - updating records`);
    await Promise.all(recordsToProcess);

    // raise completed events for each item which has been updated as 'OrderCompleted'
    const eventsToProcess = items.map((item) => {
      const eventItem = {
        Detail: JSON.stringify(item),
        DetailType: "OrderCompleted",
        EventBusName: eventBusName,
        Source: "complete-order",
      };

      const completedEvent: AWS.EventBridge.PutEventsRequest = {
        Entries: [eventItem], // no batching for demo simplicity
      };

      console.log(
        `${prefix} - event to raise: ${JSON.stringify(completedEvent)}`
      );

      return eventBridge.putEvents(completedEvent).promise();
    });

    console.log(`${prefix} - raising completed events`);
    await Promise.all(eventsToProcess);

    console.log(`${prefix} - completed`);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
