import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { finiteRendererCommand } from './finite-task.mjs';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const attr = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveClipRenderer' }];

/** Outbound-only finite encoder tasks. The service stays at zero; the budgeted launcher starts RunTask. */
export function rendererServiceTemplate() {
  const alarm = (name, metric, threshold, comparison, period = 300, evaluations = 1) => ({
    Type: 'AWS::CloudWatch::Alarm', Properties: {
      AlarmDescription: 'Live renderer ' + name + '. Inspect redacted worker events and the durable queue; do not increase admission automatically.',
      Namespace: 'PlatinumCircles/LiveClips', MetricName: metric,
      Dimensions: [{ Name: 'deployment', Value: ref('AWS::StackName') }], Statistic: 'Sum', Period: period,
      EvaluationPeriods: evaluations, DatapointsToAlarm: evaluations, Threshold: threshold, ComparisonOperator: comparison,
      TreatMissingData: 'notBreaching',
      ActionsEnabled: true,
      AlarmActions: { 'Fn::If': ['HasAlarmTopic', [ref('AlarmTopicArn')], ref('AWS::NoValue')] },
      OKActions: { 'Fn::If': ['HasAlarmTopic', [ref('AlarmTopicArn')], ref('AWS::NoValue')] },
      Tags: tags,
    },
  });
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Platinum Live clips: pinned finite Fargate task, paused service, no listener/NAT/load balancer. Separate launcher enforces runtime reservations.',
    Parameters: {
      VpcId: { Type: 'AWS::EC2::VPC::Id', Description: 'Verified existing VPC in us-east-2.' },
      PublicSubnetIds: { Type: 'List<AWS::EC2::Subnet::Id>', Description: 'Two verified AZs with effective 0.0.0.0/0 Internet Gateway routes.' },
      ImageRepositoryUri: { Type: 'String', AllowedPattern: '[0-9]{12}\\.dkr\\.ecr\\.us-east-2\\.amazonaws\\.com/[a-z0-9._/-]+' },
      ImageRepositoryArn: { Type: 'String', AllowedPattern: 'arn:aws:ecr:us-east-2:[0-9]{12}:repository/[a-z0-9._/-]+' },
      ImageDigest: { Type: 'String', AllowedPattern: 'sha256:[a-f0-9]{64}', Description: 'Exact image digest after build tests and image scan review.' },
      BrokerSecretArn: { Type: 'String', AllowedPattern: 'arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+',
        Description: 'Dedicated bootstrap secret ARN. Its exact value must already match Supabase LIVE_CLIP_WORKER_SECRET.' },
      BrokerKeyArn: { Type: 'String', AllowedPattern: 'arn:aws:kms:us-east-2:[0-9]{12}:key/[a-f0-9-]{36}' },
      SupabaseProjectRef: { Type: 'String', Default: 'prlkikhckbifseosbukl', AllowedPattern: '[a-z0-9]{20}' },
      HlsCdnOrigin: { Type: 'String', Default: 'https://d34dlehokbfej7.cloudfront.net',
        AllowedPattern: 'https://[a-z0-9-]+(?:\\.[a-z0-9-]+)+' },
      DesiredCount: { Type: 'Number', Default: 0, AllowedValues: [0],
        Description: 'Always zero under the initial project budget. Finite tasks are started only by the reviewed launcher or an explicit acceptance run.' },
      AlarmTopicArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:sns:us-east-2:[0-9]{12}:[A-Za-z0-9_-]+)',
        Description: 'Optional existing monitored SNS topic. Empty means alarms are visible in CloudWatch but send no notifications.' },
    },
    Conditions: {
      HasAlarmTopic: { 'Fn::Not': [{ 'Fn::Equals': [ref('AlarmTopicArn'), ''] }] },
    },
    Resources: {
      Cluster: { Type: 'AWS::ECS::Cluster', Properties: { ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }], Tags: tags } },
      WorkerSecurityGroup: { Type: 'AWS::EC2::SecurityGroup', Properties: {
        GroupDescription: 'Outbound HTTPS only for Live clip broker, signed media and task startup; no inbound rules.',
        VpcId: ref('VpcId'), SecurityGroupIngress: [],
        SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0',
          Description: 'Supabase broker/storage, authenticated CDN, ECR, Secrets Manager and CloudWatch.' }], Tags: tags,
      } },
      WorkerLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        LogGroupName: sub('/platinum/live-clips/${AWS::StackName}/worker'), RetentionInDays: 14, Tags: tags,
      } },
      TaskExecutionRole: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
          Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole',
          Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
            ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*') } } }] },
        Policies: [{ PolicyName: 'StartOnlyThisRenderer', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'],
            Resource: ref('ImageRepositoryArn') },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: attr('WorkerLogs', 'Arn') },
          { Effect: 'Allow', Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            Resource: ref('BrokerSecretArn'), Condition: { Bool: { 'aws:SecureTransport': 'true' } } },
          { Effect: 'Allow', Action: ['kms:Decrypt', 'kms:DescribeKey'], Resource: ref('BrokerKeyArn'),
            Condition: { StringEquals: { 'kms:ViaService': sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}'),
              'kms:EncryptionContext:SecretARN': ref('BrokerSecretArn') }, Bool: { 'aws:SecureTransport': 'true' } } },
        ] } }], Tags: tags,
      } },
      Task: { Type: 'AWS::ECS::TaskDefinition', Properties: {
        RequiresCompatibilities: ['FARGATE'], NetworkMode: 'awsvpc', Cpu: '2048', Memory: '4096',
        RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
        ExecutionRoleArn: attr('TaskExecutionRole', 'Arn'),
        // No TaskRoleArn: the encoder receives no AWS API credentials.
        Volumes: [{ Name: 'scratch' }],
        ContainerDefinitions: [{
          Name: 'renderer', Essential: true, Image: sub('${ImageRepositoryUri}@${ImageDigest}'),
          User: '1000:1000', ReadonlyRootFilesystem: true, StopTimeout: 30,
          Command: finiteRendererCommand,
          LinuxParameters: { InitProcessEnabled: true, Capabilities: { Drop: ['ALL'] } },
          MountPoints: [{ SourceVolume: 'scratch', ContainerPath: '/scratch', ReadOnly: false }],
          Ulimits: [{ Name: 'nofile', SoftLimit: 1024, HardLimit: 1024 }],
          Environment: [
            { Name: 'NODE_ENV', Value: 'production' }, { Name: 'NODE_OPTIONS', Value: '--max-old-space-size=256' },
            { Name: 'TMPDIR', Value: '/scratch' }, { Name: 'RENDERER_DEPLOYMENT', Value: ref('AWS::StackName') },
            { Name: 'LIVE_CLIP_IDLE_MS', Value: '60000' }, { Name: 'LIVE_HLS_CDN_ORIGIN', Value: ref('HlsCdnOrigin') },
            { Name: 'SUPABASE_URL', Value: sub('https://${SupabaseProjectRef}.supabase.co') },
            { Name: 'AWS_EC2_METADATA_DISABLED', Value: 'true' },
          ],
          Secrets: [{ Name: 'LIVE_CLIP_WORKER_SECRET', ValueFrom: ref('BrokerSecretArn') }],
          HealthCheck: { Command: ['CMD', 'node', 'workers/live-clips/health.mjs'], Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 30 },
          LogConfiguration: { LogDriver: 'awslogs', Options: {
            'awslogs-group': ref('WorkerLogs'), 'awslogs-region': ref('AWS::Region'), 'awslogs-stream-prefix': 'renderer',
            mode: 'non-blocking', 'max-buffer-size': '1m',
          } },
        }], Tags: tags,
      } },
      WorkerService: { Type: 'AWS::ECS::Service', Properties: {
        Cluster: ref('Cluster'), TaskDefinition: ref('Task'), DesiredCount: ref('DesiredCount'),
        LaunchType: 'FARGATE', PlatformVersion: '1.4.0', EnableExecuteCommand: false,
        DeploymentConfiguration: { MinimumHealthyPercent: 100, MaximumPercent: 200,
          DeploymentCircuitBreaker: { Enable: true, Rollback: true } },
        NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED', Subnets: ref('PublicSubnetIds'),
          SecurityGroups: [ref('WorkerSecurityGroup')] } },
        PropagateTags: 'TASK_DEFINITION', EnableECSManagedTags: true, Tags: tags,
      } },
      BrokerUnavailable: alarm('broker repeatedly unavailable', 'Unavailable', 3, 'GreaterThanOrEqualToThreshold'),
      TerminalJobFailure: alarm('durable terminal job failure', 'Failed', 1, 'GreaterThanOrEqualToThreshold'),
    },
    Outputs: {
      ClusterArn: { Value: attr('Cluster', 'Arn') }, ServiceName: { Value: attr('WorkerService', 'Name') },
      TaskDefinitionArn: { Value: ref('Task') }, WorkerLogGroup: { Value: ref('WorkerLogs') },
      SecurityGroupId: { Value: ref('WorkerSecurityGroup') }, TaskExecutionRoleArn: { Value: attr('TaskExecutionRole', 'Arn') },
      PinnedImage: { Value: sub('${ImageRepositoryUri}@${ImageDigest}') },
      Admission: { Value: 'This stack does not enable clipping. Keep live_clip_configure disabled until recorded acceptance.' },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./service-cloudformation.json', import.meta.url), JSON.stringify(rendererServiceTemplate(), null, 2) + '\n');
  process.stdout.write('Renderer service template generated; no hosted action performed.\n');
}
