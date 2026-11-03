import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const ref = name => ({ Ref: name }), sub = value => ({ 'Fn::Sub': value });
const attr = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const when = (name, yes, no = ref('AWS::NoValue')) => ({ 'Fn::If': [name, yes, no] });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveTaskLauncher' }];
const arn = (type, suffix, optional = false) => ({ Type: 'String', ...(optional ? { Default: '' } : {}),
  AllowedPattern: `(?:${optional ? '|' : ''}arn:aws:${type}:us-east-2:[0-9]{12}:${suffix})` });
const clusterTasks = parameter => ({ 'Fn::Join': ['', [sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:task/'),
  { 'Fn::Select': [1, { 'Fn::Split': [':cluster/', ref(parameter)] }] }, '/*']] });

export function rendererLauncherTemplate() {
  const source = readFileSync(new URL('./launcher.py', import.meta.url), 'utf8');
  const taskPolicy = (prefix, condition) => ({ ...(condition ? { 'Fn::If': [condition, {
    Effect: 'Allow', Action: 'ecs:RunTask', Resource: ref(prefix + 'TaskDefinitionArn'),
    Condition: { ArnEquals: { 'ecs:cluster': ref(prefix + 'ClusterArn') } },
  }, ref('AWS::NoValue')] } : {
    Effect: 'Allow', Action: 'ecs:RunTask', Resource: ref(prefix + 'TaskDefinitionArn'),
    Condition: { ArnEquals: { 'ecs:cluster': ref(prefix + 'ClusterArn') } },
  }) });
  const taskControl = (prefix, condition) => {
    const value = { Effect: 'Allow', Action: ['ecs:DescribeTasks', 'ecs:StopTask'], Resource: clusterTasks(prefix + 'ClusterArn'),
      Condition: { ArnEquals: { 'ecs:cluster': ref(prefix + 'ClusterArn') } } };
    return condition ? when(condition, value) : value;
  };
  const alarm = (metric, threshold, comparison, missing = 'notBreaching') => ({
    Type: 'AWS::CloudWatch::Alarm', Properties: {
      Namespace: 'PlatinumCircles/LiveLauncher', MetricName: metric,
      Dimensions: [{ Name: 'deployment', Value: ref('AWS::StackName') }], Statistic: 'Sum', Period: 300,
      EvaluationPeriods: 1, DatapointsToAlarm: 1, Threshold: threshold, ComparisonOperator: comparison,
      TreatMissingData: when('Enabled', missing, 'notBreaching'), ActionsEnabled: when('Enabled', true, false),
      AlarmDescription: 'Live finite-task launcher. Inspect redacted logs and the durable reservation before restarting; do not reset an ambiguous reservation.',
      AlarmActions: when('HasAlarmTopic', [ref('AlarmTopicArn')]), OKActions: when('HasAlarmTopic', [ref('AlarmTopicArn')]), Tags: tags,
    },
  });
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'One shared finite-task slot and a 120 two-vCPU-task-minute/day reservation limit for Live renderer and optional transcription. No always-on ECS compute.',
    Parameters: {
      RendererClusterArn: arn('ecs', 'cluster/[A-Za-z0-9_-]+'),
      RendererTaskDefinitionArn: arn('ecs', 'task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*'),
      RendererExecutionRoleArn: { Type: 'String', AllowedPattern: 'arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+' },
      RendererSecurityGroupId: { Type: 'AWS::EC2::SecurityGroup::Id' },
      RendererSubnetIds: { Type: 'List<AWS::EC2::Subnet::Id>' },
      QueueKeyArn: arn('kms', 'key/[a-f0-9-]{36}'),
      SupabaseProjectRef: { Type: 'String', Default: 'prlkikhckbifseosbukl', AllowedPattern: '[a-z0-9]{20}' },
      ScheduleEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'], Description: 'Enable only after queue-only credentials match and controlled launcher acceptance passes.' },
      AsrEnabled: { Type: 'String', Default: 'false', AllowedValues: ['false', 'true'] },
      AsrClusterArn: arn('ecs', 'cluster/[A-Za-z0-9_-]+', true),
      AsrTaskDefinitionArn: arn('ecs', 'task-definition/[A-Za-z0-9_-]+:[1-9][0-9]*', true),
      AsrExecutionRoleArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+)' },
      AsrTaskRoleArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9_+=,.@/-]+)' },
      AsrSecurityGroupId: { Type: 'String', Default: '', AllowedPattern: '(?:|sg-[a-f0-9]{8,17})' },
      AsrSubnetIds: { Type: 'String', Default: '', AllowedPattern: '(?:|subnet-[a-f0-9]{8,17}(?:,subnet-[a-f0-9]{8,17}){0,2})' },
      AsrQueueSecretArn: arn('secretsmanager', 'secret:[A-Za-z0-9/_+=.@-]+', true),
      AsrQueueKeyArn: arn('kms', 'key/[a-f0-9-]{36}', true),
      AlarmTopicArn: { Type: 'String', Default: '', AllowedPattern: '(?:|arn:aws:sns:us-east-2:[0-9]{12}:[A-Za-z0-9_-]+)' },
    },
    Rules: {
      CompleteAsrConfiguration: { RuleCondition: { 'Fn::Equals': [ref('AsrEnabled'), 'true'] }, Assertions:
        ['AsrClusterArn', 'AsrTaskDefinitionArn', 'AsrExecutionRoleArn', 'AsrTaskRoleArn', 'AsrSecurityGroupId', 'AsrSubnetIds', 'AsrQueueSecretArn', 'AsrQueueKeyArn']
          .map(name => ({ Assert: { 'Fn::Not': [{ 'Fn::Equals': [ref(name), ''] }] }, AssertDescription: name + ' must be supplied when ASR scheduling is enabled.' })),
      },
    },
    Conditions: {
      Enabled: { 'Fn::Equals': [ref('ScheduleEnabled'), 'true'] },
      HasAsr: { 'Fn::And': [{ 'Fn::Equals': [ref('AsrEnabled'), 'true'] },
        ...['AsrClusterArn', 'AsrTaskDefinitionArn', 'AsrExecutionRoleArn', 'AsrTaskRoleArn', 'AsrSecurityGroupId', 'AsrSubnetIds', 'AsrQueueSecretArn', 'AsrQueueKeyArn']
          .map(name => ({ 'Fn::Not': [{ 'Fn::Equals': [ref(name), ''] }] }))] },
      HasAlarmTopic: { 'Fn::Not': [{ 'Fn::Equals': [ref('AlarmTopicArn'), ''] }] },
    },
    Resources: {
      QueueSecret: { Type: 'AWS::SecretsManager::Secret', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        Description: 'Queue metadata only. Install the matching value as LIVE_CLIP_QUEUE_SECRET; it cannot claim, sign or finish clip jobs.',
        KmsKeyId: ref('QueueKeyArn'), GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true, IncludeSpace: false }, Tags: tags,
      } },
      Ledger: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true }, Tags: tags,
      } },
      LauncherLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        LogGroupName: sub('/platinum/live-clips/${AWS::StackName}/launcher'), RetentionInDays: 14, Tags: tags,
      } },
      LauncherRole: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
        Policies: [{ PolicyName: 'BoundedLiveTaskLauncher', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: attr('LauncherLogs', 'Arn') },
          // DynamoDB authorizes transactional writes through the individual item actions.
          { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem'], Resource: attr('Ledger', 'Arn') },
          taskPolicy('Renderer'), taskControl('Renderer'), taskPolicy('Asr', 'HasAsr'), taskControl('Asr', 'HasAsr'),
          { Effect: 'Allow', Action: 'iam:PassRole', Resource: [ref('RendererExecutionRoleArn'), when('HasAsr', ref('AsrExecutionRoleArn')), when('HasAsr', ref('AsrTaskRoleArn'))],
            Condition: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } } },
          { Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: [ref('QueueSecret'), when('HasAsr', ref('AsrQueueSecretArn'))],
            Condition: { Bool: { 'aws:SecureTransport': 'true' } } },
          { Effect: 'Allow', Action: 'kms:Decrypt', Resource: ref('QueueKeyArn'), Condition: { StringEquals: {
            'kms:ViaService': sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}'), 'kms:EncryptionContext:SecretARN': ref('QueueSecret') } } },
          when('HasAsr', { Effect: 'Allow', Action: 'kms:Decrypt', Resource: ref('AsrQueueKeyArn'), Condition: { StringEquals: {
            'kms:ViaService': sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}'), 'kms:EncryptionContext:SecretARN': ref('AsrQueueSecretArn') } } }),
        ] } }], Tags: tags,
      } },
      Launcher: { Type: 'AWS::Lambda::Function', Properties: {
        Runtime: 'python3.13', Handler: 'index.handler', Architectures: ['arm64'], MemorySize: 256, Timeout: 45,
        ReservedConcurrentExecutions: 1, Role: attr('LauncherRole', 'Arn'), Code: { ZipFile: source },
        LoggingConfig: { LogGroup: ref('LauncherLogs'), LogFormat: 'Text' },
        Environment: { Variables: {
          AWS_ACCOUNT_ID: ref('AWS::AccountId'), SUPABASE_PROJECT_REF: ref('SupabaseProjectRef'), DEPLOYMENT: ref('AWS::StackName'),
          LEDGER_TABLE: ref('Ledger'), LAUNCH_ENABLED: ref('ScheduleEnabled'),
          RENDERER_CLUSTER_ARN: ref('RendererClusterArn'), RENDERER_TASK_ARN: ref('RendererTaskDefinitionArn'),
          RENDERER_QUEUE_SECRET_ARN: ref('QueueSecret'), RENDERER_SECURITY_GROUP: ref('RendererSecurityGroupId'),
          RENDERER_SUBNET_IDS: { 'Fn::Join': [',', ref('RendererSubnetIds')] }, ASR_ENABLED: ref('AsrEnabled'),
          ASR_CLUSTER_ARN: ref('AsrClusterArn'), ASR_TASK_ARN: ref('AsrTaskDefinitionArn'),
          ASR_QUEUE_SECRET_ARN: ref('AsrQueueSecretArn'), ASR_SECURITY_GROUP: ref('AsrSecurityGroupId'), ASR_SUBNET_IDS: ref('AsrSubnetIds'),
        } }, Tags: tags,
      } },
      InvocationPolicy: { Type: 'AWS::Lambda::EventInvokeConfig', Properties: {
        FunctionName: ref('Launcher'), Qualifier: '$LATEST', MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0,
      } },
      Tick: { Type: 'AWS::Events::Rule', Properties: {
        Description: 'Bounded queue signal once per minute; never a poll per viewer.', ScheduleExpression: 'rate(1 minute)',
        State: when('Enabled', 'ENABLED', 'DISABLED'),
        Targets: [{ Arn: attr('Launcher', 'Arn'), Id: 'LiveLauncher', Input: '{}', RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }],
      } },
      AllowTick: { Type: 'AWS::Lambda::Permission', Properties: {
        FunctionName: ref('Launcher'), Action: 'lambda:InvokeFunction', Principal: 'events.amazonaws.com',
        SourceArn: attr('Tick', 'Arn'), SourceAccount: ref('AWS::AccountId'),
      } },
      MissingSchedulerHeartbeat: alarm('SchedulerHeartbeat', 1, 'LessThanThreshold', 'breaching'),
      ReconciliationRequired: alarm('ManualReviewRequired', 1, 'GreaterThanOrEqualToThreshold'),
      LauncherUnavailable: alarm('LauncherUnavailable', 3, 'GreaterThanOrEqualToThreshold'),
    },
    Outputs: {
      LauncherArn: { Value: attr('Launcher', 'Arn') }, QueueSecretArn: { Value: ref('QueueSecret') }, LedgerTable: { Value: ref('Ledger') },
      LauncherLogGroup: { Value: ref('LauncherLogs') }, ScheduleRuleArn: { Value: attr('Tick', 'Arn') },
      RuntimeReservationLimit: { Value: '7200 two-vCPU-equivalent seconds per UTC day; one active task; no uncertain-launch refunds.' },
      RequiredApplicationSecret: { Value: 'LIVE_CLIP_QUEUE_SECRET' },
      Activation: { Value: 'Default disabled. Queue signals do not enable clip/transcription/provider admission. Keep ECS service desired count zero.' },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./launcher-cloudformation.json', import.meta.url), JSON.stringify(rendererLauncherTemplate(), null, 2) + '\n');
  process.stdout.write('Finite Live launcher template generated; no hosted action performed.\n');
}
