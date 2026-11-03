import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const ref = name => ({ Ref: name }), sub = value => ({ 'Fn::Sub': value }), attr = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveTranscription' }];
const taskTrust = () => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' }, Action: 'sts:AssumeRole',
  Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') }, ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*') } } }] });
export function transcriptionTaskTemplate() {
  const bucket = sub('arn:${AWS::Partition}:s3:::${AudioBucketName}'), object = name => sub('arn:${AWS::Partition}:s3:::${AudioBucketName}/transcription/*/' + name);
  const jobs = sub('arn:${AWS::Partition}:transcribe:us-east-2:${AWS::AccountId}:transcription-job/pc-live-caption-*');
  const alarm = (metric, threshold, compare = 'GreaterThanOrEqualToThreshold') => ({ Type: 'AWS::CloudWatch::Alarm', Properties: {
    AlarmDescription: 'Live captions ' + metric + '. Review sanitized executor events and durable provider reservations. Never increase admission automatically.',
    Namespace: 'PlatinumCircles/LiveTranscription', MetricName: metric, Dimensions: [{ Name: 'deployment', Value: ref('AWS::StackName') }],
    Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, DatapointsToAlarm: 1, Threshold: threshold, ComparisonOperator: compare,
    TreatMissingData: 'notBreaching', ActionsEnabled: true,
    AlarmActions: { 'Fn::If': ['HasAlarmTopic', [ref('AlarmTopicArn')], ref('AWS::NoValue')] }, Tags: tags,
  } });
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'Task-only outbound Live captions executor. No service, schedule or task starts. A reviewed budgeted launcher supplies an absolute deadline; broker admission defaults off.',
    Parameters: {
      VpcId: { Type: 'AWS::EC2::VPC::Id' }, PublicSubnetIds: { Type: 'List<AWS::EC2::Subnet::Id>', Description: 'Existing verified us-east-2 Internet Gateway subnets; no new NAT or load balancer.' },
      AudioBucketName: { Type: 'String', AllowedPattern: '[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', Description: 'Dedicated private bucket from storage-cloudformation.json.' },
      DataAccessRoleArn: { Type: 'String', AllowedPattern: 'arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+' },
      ImageRepositoryUri: { Type: 'String', AllowedPattern: '[0-9]{12}\\.dkr\\.ecr\\.us-east-2\\.amazonaws\\.com/[a-z0-9._/-]+' },
      ImageRepositoryArn: { Type: 'String', AllowedPattern: 'arn:aws:ecr:us-east-2:[0-9]{12}:repository/[a-z0-9._/-]+' },
      ImageDigest: { Type: 'String', AllowedPattern: 'sha256:[a-f0-9]{64}' },
      BrokerSecretArn: { Type: 'String', AllowedPattern: 'arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+', Description: 'Dedicated secret whose value matches Supabase LIVE_TRANSCRIPTION_WORKER_SECRET.' },
      BrokerKeyArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:kms:us-east-2:[0-9]{12}:key/[a-f0-9-]{36})', Description: 'Only if the broker secret uses a customer-managed KMS key.' },
      SupabaseProjectRef: { Type: 'String', Default: 'prlkikhckbifseosbukl', AllowedValues: ['prlkikhckbifseosbukl', 'uaulhuelcfkjwojtymmw'] },
      ExecutionEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'], Description: 'Explicit operator opt-in after tests and permission/cost review. Database admission remains separately off.' },
      AlarmTopicArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:sns:us-east-2:[0-9]{12}:[A-Za-z0-9_-]+)' },
    },
    Conditions: { HasAlarmTopic: { 'Fn::Not': [{ 'Fn::Equals': [ref('AlarmTopicArn'), ''] }] }, HasSecretKey: { 'Fn::Not': [{ 'Fn::Equals': [ref('BrokerKeyArn'), ''] }] } },
    Resources: {
      Cluster: { Type: 'AWS::ECS::Cluster', Properties: { ClusterSettings: [{ Name: 'containerInsights', Value: 'disabled' }], Tags: tags } },
      WorkerSecurityGroup: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: 'Caption worker HTTPS egress only; no listener or inbound access.', VpcId: ref('VpcId'),
        SecurityGroupIngress: [], SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0', Description: 'Fixed Supabase/AWS endpoints and task startup services.' }], Tags: tags } },
      WorkerLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: { LogGroupName: sub('/platinum/live-transcription/${AWS::StackName}/worker'), RetentionInDays: 14, Tags: tags } },
      TaskExecutionRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: taskTrust(), Tags: tags,
        Policies: [{ PolicyName: 'StartOnlyThisCaptionWorker', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'], Resource: ref('ImageRepositoryArn') },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: attr('WorkerLogs', 'Arn') },
          { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: ref('BrokerSecretArn') },
          { 'Fn::If': ['HasSecretKey', { Effect: 'Allow', Action: 'kms:Decrypt', Resource: ref('BrokerKeyArn'), Condition: { StringEquals: {
            'kms:ViaService': sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}'), 'kms:EncryptionContext:SecretARN': ref('BrokerSecretArn') } } }, ref('AWS::NoValue')] },
        ] } }] } },
      TaskRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: taskTrust(), Tags: tags,
        Policies: [{ PolicyName: 'OnlyReservedLiveCaptionJobs', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'], Resource: jobs, Condition: { StringEquals: { 'aws:RequestedRegion': 'us-east-2' } } },
          { Effect: 'Allow', Action: 'transcribe:TagResource', Resource: jobs, Condition: { StringEquals: { 'aws:RequestTag/Service': 'PlatinumLiveCaptions', 'aws:RequestedRegion': 'us-east-2' }, 'ForAllValues:StringEquals': { 'aws:TagKeys': ['Service', 'ConfigurationHash'] } } },
          { Effect: 'Allow', Action: 'iam:PassRole', Resource: ref('DataAccessRoleArn'), Condition: { StringEquals: { 'iam:PassedToService': 'transcribe.amazonaws.com' } } },
          { Effect: 'Allow', Action: ['s3:GetBucketLocation', 's3:ListBucket'], Resource: bucket },
          { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: [object('source.flac'), object('result.json')] },
        ] } }] } },
      Task: { Type: 'AWS::ECS::TaskDefinition', Properties: {
        RequiresCompatibilities: ['FARGATE'], NetworkMode: 'awsvpc', Cpu: '1024', Memory: '2048', RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
        ExecutionRoleArn: attr('TaskExecutionRole', 'Arn'), TaskRoleArn: attr('TaskRole', 'Arn'), Volumes: [{ Name: 'scratch' }],
        ContainerDefinitions: [{ Name: 'transcription', Essential: true, Image: sub('${ImageRepositoryUri}@${ImageDigest}'), User: '1000:1000', ReadonlyRootFilesystem: true, StopTimeout: 30,
          Command: ['node', 'workers/live-transcription/pull.mjs'], LinuxParameters: { InitProcessEnabled: true, Capabilities: { Drop: ['ALL'] } },
          MountPoints: [{ SourceVolume: 'scratch', ContainerPath: '/scratch', ReadOnly: false }], Ulimits: [{ Name: 'nofile', SoftLimit: 1024, HardLimit: 1024 }],
          Environment: [{ Name: 'NODE_ENV', Value: 'production' }, { Name: 'NODE_OPTIONS', Value: '--max-old-space-size=256' }, { Name: 'TMPDIR', Value: '/scratch' },
            { Name: 'AWS_REGION', Value: 'us-east-2' }, { Name: 'AWS_ACCOUNT_ID', Value: ref('AWS::AccountId') }, { Name: 'AWS_EC2_METADATA_DISABLED', Value: 'true' },
            { Name: 'LIVE_TRANSCRIPTION_BUCKET', Value: ref('AudioBucketName') }, { Name: 'LIVE_TRANSCRIPTION_DATA_ROLE_ARN', Value: ref('DataAccessRoleArn') },
            { Name: 'LIVE_TRANSCRIPTION_EXECUTION_ENABLED', Value: ref('ExecutionEnabled') }, { Name: 'LIVE_TRANSCRIPTION_IDLE_MS', Value: '60000' },
            { Name: 'TRANSCRIPTION_DEPLOYMENT', Value: ref('AWS::StackName') }, { Name: 'SUPABASE_URL', Value: sub('https://${SupabaseProjectRef}.supabase.co') }],
          Secrets: [{ Name: 'LIVE_TRANSCRIPTION_WORKER_SECRET', ValueFrom: ref('BrokerSecretArn') }],
          HealthCheck: { Command: ['CMD', 'node', 'workers/live-transcription/health.mjs'], Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 30 },
          LogConfiguration: { LogDriver: 'awslogs', Options: { 'awslogs-group': ref('WorkerLogs'), 'awslogs-region': ref('AWS::Region'), 'awslogs-stream-prefix': 'transcription', mode: 'non-blocking', 'max-buffer-size': '1m' } },
        }], Tags: tags,
      } },
      FailedJob: alarm('Failed', 1), BrokerOrAwsUnavailable: alarm('Unavailable', 3), ScratchCleanupPending: alarm('CleanupPending', 1),
    },
    Outputs: { ClusterArn: { Value: attr('Cluster', 'Arn') }, TaskDefinitionArn: { Value: ref('Task') },
      TaskRoleArn: { Value: attr('TaskRole', 'Arn') }, TaskExecutionRoleArn: { Value: attr('TaskExecutionRole', 'Arn') },
      SecurityGroupId: { Value: ref('WorkerSecurityGroup') }, SubnetIds: { Value: { 'Fn::Join': [',', ref('PublicSubnetIds')] } }, ContainerName: { Value: 'transcription' },
      QueuePeekUrl: { Value: sub('https://${SupabaseProjectRef}.supabase.co/functions/v1/live-transcription-worker') },
      TaskBudget: { Value: '1 vCPU / 2 GiB; 240-second lifetime, 25-second abort grace; reserve 360 task-seconds before RunTask.' }, WorkerLogGroup: { Value: ref('WorkerLogs') }, PinnedImage: { Value: sub('${ImageRepositoryUri}@${ImageDigest}') },
      Admission: { Value: 'Database transcription admission is unchanged; its independent default remains disabled.' } },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./task-cloudformation.json', import.meta.url), JSON.stringify(transcriptionTaskTemplate(), null, 2) + '\n');
  process.stdout.write('Transcription task template generated; no hosted action performed.\n');
}
