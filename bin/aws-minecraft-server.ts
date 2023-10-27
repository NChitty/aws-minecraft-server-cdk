#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsMinecraftServerStack } from '../lib/aws-minecraft-server-stack';
import { InstanceClass, InstanceSize } from 'aws-cdk-lib/aws-ec2';

const app = new cdk.App();
new AwsMinecraftServerStack(app, 'AwsMinecraftServerStack', {
  containerInsights: false,
  hostedZoneId: 'Z07331263K2TM3PKSWBJY',
  instanceClass: InstanceClass.T3,
  instanceSize: InstanceSize.MEDIUM,
  keyName: 'MobaXterm',
  mcImageTag: 'latest',
  recordName: 'mc.chittyinsights.com',
  streamPrefix: '/ecs/minecraft',
  spotPrice: '0.05',
});
