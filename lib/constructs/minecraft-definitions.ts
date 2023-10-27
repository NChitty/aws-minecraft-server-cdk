import { Construct } from 'constructs';
import {
  ContainerDefinition,
  ContainerImage, Ec2Service,
  Ec2TaskDefinition,
  LogDriver,
  NetworkMode,
  Protocol,
} from 'aws-cdk-lib/aws-ecs';
import { ILogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { TimeZone } from 'aws-cdk-lib';

export interface MinecraftDefinitionsProps {
  logGroup?: ILogGroup;
  logRetentionDays: RetentionDays;
  mcEnvironment?: MinecraftContainerEnvironmentProps;
  mcImageTag: string;
  streamPrefix: string;
}

export interface MinecraftContainerEnvironmentProps {
  type?: MinecraftType,
  ops?: string[],
  difficulty?: MinecraftDifficulty,
  whitelist?: string[],
  version?: string,
  memory?: number,
  seed?: string,
  maxPlayers?: number,
  viewDistance?: number,
  mode?: MinecraftGamemode,
  levelType?: MinecraftLevelType,
  enableRollingLogs?: boolean,
  tz?: TimeZone,
}

export enum MinecraftType {
  SPIGOT = 'SPIGOT',
}

export enum MinecraftDifficulty {
  PEACEFUL = 'peaceful',
  HARD = 'hard'
}

export enum MinecraftGamemode {
  SURVIVAL = 'SURVIVAL'
}

export enum MinecraftLevelType {
  NORMAL = 'minecraft:normal',
  SUPERFLAT = 'minecraft:flat',
}

function convertEnvironment(mcEnvironment: MinecraftContainerEnvironmentProps | undefined) {
  const environment: { [key: string]: string; } = {};

  if (mcEnvironment?.type)
    environment['TYPE'] = mcEnvironment.type;
  if (mcEnvironment?.ops)
    environment['OPS'] = mcEnvironment.ops.join(',');
  if (mcEnvironment?.difficulty)
    environment['DIFFICULTY'] = mcEnvironment.difficulty;
  if (mcEnvironment?.whitelist)
    environment['WHITELIST'] = mcEnvironment.whitelist.join(',');
  if (mcEnvironment?.version)
    environment['VERSION'] = mcEnvironment.version;
  if (mcEnvironment?.memory)
    environment['MEMORY'] = mcEnvironment.memory.toPrecision(0);
  if (mcEnvironment?.seed)
    environment['SEED'] = mcEnvironment.seed;
  if (mcEnvironment?.maxPlayers)
    environment['MAX_PLAYERS'] = mcEnvironment.maxPlayers.toPrecision(0);
  if (mcEnvironment?.viewDistance)
    environment['VIEW_DISTANCE'] = mcEnvironment.viewDistance.toPrecision(0);
  if (mcEnvironment?.mode)
    environment['MODE'] = mcEnvironment.mode;
  if (mcEnvironment?.levelType)
    environment['LEVEL_TYPE'] = mcEnvironment.levelType;
  if (mcEnvironment?.enableRollingLogs)
    environment['ENABLE_ROLLING_LOGS'] = mcEnvironment.enableRollingLogs.toString().toUpperCase();
  if (mcEnvironment?.tz)
    environment['TZ'] = mcEnvironment.tz.timezoneName;

  return environment;
}

export class MinecraftDefinitions extends Construct {
  public readonly task: Ec2TaskDefinition;
  public readonly container: ContainerDefinition;

  constructor(scope: Construct, id: string, props: MinecraftDefinitionsProps) {
    super(scope, id);
    this.task = new Ec2TaskDefinition(scope, 'McTaskDef', {
      networkMode: NetworkMode.BRIDGE,
      volumes: [
        {
          name: 'minecraft',
          host: {
            sourcePath: '/opt/minecraft',
          },
        },
      ],
    });

    this.container = this.task.addContainer('McContainerDef', {
      image: ContainerImage.fromRegistry(`itzg/minecraft-server:${props.mcImageTag}`),
      memoryReservationMiB: 1024,
      containerName: 'minecraft',
      logging: LogDriver.awsLogs({
        logGroup: props.logGroup,
        streamPrefix: props.streamPrefix,
        logRetention: props.logRetentionDays,
      }),
      environment: {
        'EULA': 'TRUE',
        'LEVEL_TYPE': 'DEFAULT',
        'OPS': 'Desireaux',
        'MEMORY': '1G',
        'ENABLE_ROLLING_LOGS': 'TRUE',
        'VERSION': '1.20.1',
      },
      portMappings: [
        {
          containerPort: 25565,
          hostPort: 25565,
          protocol: Protocol.TCP,
        },
      ],
    });
    this.container.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'minecraft',
      readOnly: false,
    });
  }
}
