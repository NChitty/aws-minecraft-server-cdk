import { CfnParameter, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { FileSystem } from 'aws-cdk-lib/aws-efs';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import {
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { AsgCapacityProvider, Cluster, Ec2Service, EcsOptimizedImage } from 'aws-cdk-lib/aws-ecs';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { ILogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { MinecraftDefinitions } from './constructs/minecraft-definitions';
import { HostedZone } from 'aws-cdk-lib/aws-route53';

export interface MinecraftServerStackProps extends StackProps {
  containerInsights: boolean;
  hostedZoneId: string;
  instanceClass: InstanceClass;
  instanceSize: InstanceSize;
  keyName: string;
  recordName: string;
  spotPrice: string;
  streamPrefix: string;
  logGroup?: ILogGroup;
  logRetentionDays?: RetentionDays;
  mcImageTag?: string;
}

export class AwsMinecraftServerStack extends Stack {
  constructor(scope: Construct, id: string, props: MinecraftServerStackProps) {
    super(scope, id, props);

    const state = new CfnParameter(this, 'State', {
      allowedValues: ['RUNNING', 'STOPPED'],
      description: 'The desired state of the server.',
      default: 'STOPPED',
    });

    const vpc = new Vpc(this, 'Vpc', {
      availabilityZones: this.availabilityZones.slice(0, 2),
      ipAddresses: IpAddresses.cidr('10.100.0.0/26'),
      enableDnsSupport: true,
      enableDnsHostnames: true,
      createInternetGateway: true,
      subnetConfiguration: [
        { name: 'Subnet', subnetType: SubnetType.PUBLIC, mapPublicIpOnLaunch: true, cidrMask: 28 },
      ],
    });

    const ec2SecurityGroup = new SecurityGroup(this, 'Ec2Sg', {
      securityGroupName: `${this.stackName}-ec2sg`,
      description: `${this.stackName}-ec2`,
      vpc,
    });
    ec2SecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH rule');
    ec2SecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(25565), 'Minecraft');

    const fileSystemSecurityGroup = new SecurityGroup(this, 'EfsSg', {
      securityGroupName: `${this.stackName}-efs`,
      description: `${this.stackName}-efs`,
      vpc,
    });
    fileSystemSecurityGroup.addIngressRule(
        Peer.securityGroupId(ec2SecurityGroup.securityGroupId),
        Port.tcp(2049),
    );

    const fileSystem = new FileSystem(this, 'FileSystem', {
      vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: SubnetType.PUBLIC,
      }),
    });

    const instanceRole = new Role(this, 'InstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
    });
    instanceRole.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(
        this,
        'Ec2RolePolicy',
        'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role',
    ));

    const ecsCluster = new Cluster(this, 'EcsCluster', {
      vpc,
      clusterName: `${this.stackName}-cluster`,
      containerInsights: props.containerInsights,
    });
    const userData = UserData.forLinux();
    userData.addCommands(
        `mount -t efs ${fileSystem.fileSystemId}:/ /opt/minecraft`,
    );
    const autoScalingGroup = new AutoScalingGroup(this, 'ASG', {
      associatePublicIpAddress: true,
      autoScalingGroupName: `${this.stackName}-asg`,
      desiredCapacity: state.valueAsString == 'RUNNING' ? 1 : 0,
      instanceType: InstanceType.of(props.instanceClass, props.instanceSize),
      keyName: props.keyName,
      machineImage: EcsOptimizedImage.amazonLinux2023(),
      maxCapacity: 1,
      minCapacity: 0,
      newInstancesProtectedFromScaleIn: true,
      role: instanceRole,
      securityGroup: ec2SecurityGroup,
      spotPrice: props.spotPrice,
      userData,
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
    });
    autoScalingGroup.node.addDependency(fileSystem.mountTargetsAvailable);
    const capacityProvider = new AsgCapacityProvider(this, 'McCapacityProvider', {
      capacityProviderName: 'McCapacityProvider',
      autoScalingGroup,
      enableManagedTerminationProtection: true,
      minimumScalingStepSize: 1,
      maximumScalingStepSize: 1,
    });
    ecsCluster.addAsgCapacityProvider(capacityProvider);
    ecsCluster.addDefaultCapacityProviderStrategy([
      {
        capacityProvider: capacityProvider.capacityProviderName,
        base: 0,
        weight: 1,
      },
    ]);

    const mcDef = new MinecraftDefinitions(this, 'Mc', {
      logRetentionDays: props.logRetentionDays ? props.logRetentionDays : RetentionDays.ONE_WEEK,
      mcImageTag: 'latest',
      streamPrefix: props.streamPrefix,
    });

    new Ec2Service(this, 'McService', {
      cluster: ecsCluster,
      taskDefinition: mcDef.task,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
          base: 0,
        },
      ],
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
      desiredCount: 1,
    });

    const dnsRole = new Role(this, 'SetDNSRecordLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'updateDnsRecord': new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['route53:ChangeResourceRecordSets'],
              resources: [
                HostedZone.fromHostedZoneId(
                    this,
                    'ImportedHostedZone',
                    props.hostedZoneId,
                ).hostedZoneArn,
              ],
            }),
            new PolicyStatement({
              actions: ['ec2:DescribeInstance*'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    dnsRole.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this, 'lambdapolicy',
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ));

    const lambda = new Function(this, 'SetDNSLambda', {
      runtime: Runtime.PYTHON_3_7,
      description: 'Sets Route 53 DNS Record for Minecraft',
      handler: 'index.handler',
      code: Code.fromInline(`import boto3
import os
def handler(event, context):
  new_instance = boto3.resource('ec2').Instance(event['detail']['EC2InstanceId'])
  boto3.client('route53').change_resource_record_sets(
  HostedZoneId= os.environ['HostedZoneId'],
  ChangeBatch={
    'Comment': 'updating',
    'Changes': [
      {
        'Action': 'UPSERT',
        'ResourceRecordSet': {
          'Name': os.environ['RecordName'],
          'Type': 'A',
          'TTL': 60,
          'ResourceRecords': [
            {
              'Value': new_instance.public_ip_address
            },
          ]
        }
      },
    ]
  })`),
      role: dnsRole,
      timeout: Duration.seconds(20),
      memorySize: 128,
      functionName: `${this.stackName}-set-dns`,
      environment: {
        'HostedZoneId': `${props.hostedZoneId}`,
        'RecordName': `${props.recordName}`,
      },
      events: [],
    });
    const launchEvent = new Rule(this, 'LaunchEvent', {
      eventPattern: {
        source: ['aws.autoscaling'],
        detailType: ['EC2 Instance Launch Successful'],
        detail: {
          'AutoScalingGroupName': [autoScalingGroup.autoScalingGroupName],
        },
      },
      ruleName: `${this.stackName}-instance-launch`,
      enabled: true,
      targets: [
        new LambdaFunction(lambda),
      ],
    });
    lambda.addPermission('LaunchEventLambdaPermission', {
      principal: new ServicePrincipal('events.amazonaws.com'),
      sourceArn: launchEvent.ruleArn,
    });
  }
}
