import { Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CfnInternetGateway as InternetGateway,
  CfnRouteTable as RouteTable,
  CfnSubnetRouteTableAssociation as SubnetRoute,
  CfnVPCGatewayAttachment as VpcGatewayAttachment,
  IpAddresses, Peer, Port,
  SecurityGroup,
  Subnet,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { CfnFileSystem as FileSystem, CfnMountTarget as MountTarget } from 'aws-cdk-lib/aws-efs';
import {
  AutoScalingGroup,
  CfnLaunchConfiguration as LaunchConfiguration,
} from 'aws-cdk-lib/aws-autoscaling';
import { InstanceProfile, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export class AwsMinecraftServerStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr('10.100.0.0/26'),
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    const gateway = new InternetGateway(this, 'InternetGateway', {});

    new VpcGatewayAttachment(this, 'InternetGatewayAttachment', {
      internetGatewayId: gateway.attrInternetGatewayId,
      vpcId: vpc.vpcId,
    });

    const routeTable = new RouteTable(this, 'RouteTable', {
      vpcId: vpc.vpcId,
    });

    const subnetA = new Subnet(this, 'SubnetA', {
      availabilityZone: Fn.select(0, Fn.getAzs(Fn.ref('AWS::Region'))),
      vpcId: vpc.vpcId,
      cidrBlock: Fn.select(0, Fn.cidr('10.100.0.0/26', 4, '4')),
    });

    const subnetB = new Subnet(this, 'SubnetB', {
      availabilityZone: Fn.select(1, Fn.getAzs(Fn.ref('AWS::Region'))),
      vpcId: vpc.vpcId,
      cidrBlock: Fn.select(1, Fn.cidr('10.100.0.0/26', 4, '4')),
    });

    new SubnetRoute(this, 'SubnetARoute', {
      routeTableId: routeTable.attrRouteTableId,
      subnetId: subnetA.subnetId,
    });

    new SubnetRoute(this, 'SubnetBRoute', {
      routeTableId: routeTable.attrRouteTableId,
      subnetId: subnetB.subnetId,
    });

    const ec2SecurityGroup = new SecurityGroup(this, 'Ec2Sg', {
      securityGroupName: `${this.stackName}-ec2`,
      description: `${this.stackName}-ec2`,
      vpc,
    });
    ec2SecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH rule');

    const fileSystemSecurityGroup = new SecurityGroup(this, 'EfsSg', {
      securityGroupName: `${this.stackName}-efs`,
      description: `${this.stackName}-efs`,
      vpc,
    });
    fileSystemSecurityGroup.addIngressRule(
        Peer.securityGroupId(ec2SecurityGroup.securityGroupId),
        Port.tcp(2049),
    );

    const fileSystem = new FileSystem(this, 'FileSystem', {});
    new MountTarget(this, 'MountA', {
      fileSystemId: fileSystem.attrFileSystemId,
      securityGroups: [fileSystemSecurityGroup.securityGroupId],
      subnetId: subnetA.subnetId,
    });
    new MountTarget(this, 'MountB', {
      fileSystemId: fileSystem.attrFileSystemId,
      securityGroups: [fileSystemSecurityGroup.securityGroupId],
      subnetId: subnetB.subnetId,
    });
    const instanceRole = new Role(this, 'InstanceRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
    });
    instanceRole.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(
        this,
        'Ec2RolePolicy',
        'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role'
    ));
    const instanceProfile = new InstanceProfile(this, 'InstanceProfile', {
      role: instanceRole,
    });
    const launchConfig = new LaunchConfiguration(this, 'LaunchConfig', {
      associatePublicIpAddress: true,
      iamInstanceProfile: Fn.ref(instanceProfile.instanceProfileName),
      imageId: 'latest',
      instanceType: 'instance-type',
      keyName: '',
      securityGroups: [ec2SecurityGroup.securityGroupId],
      spotPrice: '',
      userData: Fn.base64(Fn.sub('#!/bin/bash -xe\n' +
          'echo ECS_CLUSTER=${EcsCluster} >> /etc/ecs/ecs.config\n' +
          'yum install -y amazon-efs-utils\n' +
          'mkdir /opt/minecraft\n' +
          'mount -t efs ${Efs}:/ /opt/minecraft\n' +
          'chown 845:845 /opt/minecraft\n',
      )),
    });
    // TODO fix capacity for lambda
    new AutoScalingGroup(this, 'ASG', {
      autoScalingGroupName: `${this.stackName}-asg`,
      desiredCapacity: 1,
      newInstancesProtectedFromScaleIn: true,
      maxCapacity: 1,
      minCapacity: 0,
      vpc,
    });
  }
}
