import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class AwsMinecraftServerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'AwsMinecraftServerQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
