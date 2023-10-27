import {
  CfnInternetGateway,
  CfnRouteTable, CfnSubnetRouteTableAssociation,
  CfnVPCGatewayAttachment, ISubnet, Subnet,
  Vpc,
  VpcProps,
} from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Fn } from 'aws-cdk-lib';

export class InternetAttachedVpc extends Vpc {
  public readonly subnets: ISubnet[] = [];

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id, props);

    const gateway = new CfnInternetGateway(this, 'InternetGateway');

    new CfnVPCGatewayAttachment(this, 'InternetGatewayAttachment', {
      internetGatewayId: gateway.attrInternetGatewayId,
      vpcId: this.vpcId,
    });

    const routeTable = new CfnRouteTable(this, 'RouteTable', {
      vpcId: this.vpcId,
    });

    this.subnets.push(new Subnet(this, 'SubnetA', {
      availabilityZone: this.availabilityZones[0],
      vpcId: this.vpcId,
      cidrBlock: Fn.select(0, Fn.cidr('10.200.0.0/26', 4, '4')),
    }));

    this.subnets.push(new Subnet(this, 'SubnetB', {
      availabilityZone: this.availabilityZones[1],
      vpcId: this.vpcId,
      cidrBlock: Fn.select(1, Fn.cidr('10.200.0.0/26', 4, '4')),
    }));

    new CfnSubnetRouteTableAssociation(this, 'SubnetARoute', {
      routeTableId: routeTable.attrRouteTableId,
      subnetId: this.subnets[0].subnetId,
    });

    new CfnSubnetRouteTableAssociation(this, 'SubnetBRoute', {
      routeTableId: routeTable.attrRouteTableId,
      subnetId: this.subnets[1].subnetId,
    });
  }
}
