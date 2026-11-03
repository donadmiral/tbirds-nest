import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const ref=name=>({Ref:name}),attr=(name,key)=>({'Fn::GetAtt':[name,key]}),sub=value=>({'Fn::Sub':value});
const tags=[{Key:'Application',Value:'PlatinumCircles'},{Key:'Purpose',Value:'LiveSocialPublisher'}];
const assumeRole={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'ecs-tasks.amazonaws.com'},Action:'sts:AssumeRole',Condition:{StringEquals:{'aws:SourceAccount':ref('AWS::AccountId')},ArnLike:{'aws:SourceArn':sub('arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*')}}}]};

/** Separate outbound worker; the template does not change any social admission gate. */
export function socialServiceTemplate(){return{
 AWSTemplateFormatVersion:'2010-09-09',
 Description:'Platinum Live direct publishing: paused Fargate service, scoped execution permissions, no AWS task role or public listener.',
 Parameters:{
  VpcId:{Type:'AWS::EC2::VPC::Id'},PublicSubnetIds:{Type:'List<AWS::EC2::Subnet::Id>',Description:'Existing us-east-2 subnets with Internet Gateway routes; no NAT is created.'},
  ImageRepositoryUri:{Type:'String',AllowedPattern:'[0-9]{12}\\.dkr\\.ecr\\.us-east-2\\.amazonaws\\.com/[a-z0-9._/-]+'},
  ImageRepositoryArn:{Type:'String',AllowedPattern:'arn:aws:ecr:us-east-2:[0-9]{12}:repository/[a-z0-9._/-]+'},
  ImageDigest:{Type:'String',AllowedPattern:'sha256:[a-f0-9]{64}',Description:'Exact tested and reviewed image digest; mutable tags are refused.'},
  BrokerSecretArn:{Type:'String',AllowedPattern:'arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+',Description:'Dedicated existing secret matching only LIVE_SOCIAL_WORKER_SECRET in Supabase.'},
  BrokerKeyArn:{Type:'String',AllowedPattern:'arn:aws:kms:us-east-2:[0-9]{12}:key/[a-f0-9-]{36}'},
  SupabaseProjectRef:{Type:'String',AllowedPattern:'[a-z0-9]{20}',Default:'prlkikhckbifseosbukl'},
  DesiredCount:{Type:'Number',Default:0,AllowedValues:[0,1,2],Description:'Paused by default. Start with one only after provider approvals, consent and recorded acceptance.'},
 },
 Resources:{
  Cluster:{Type:'AWS::ECS::Cluster',Properties:{ClusterSettings:[{Name:'containerInsights',Value:'disabled'}],Tags:tags}},
  WorkerLogs:{Type:'AWS::Logs::LogGroup',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{LogGroupName:sub('/platinum/live-social/${AWS::StackName}/worker'),RetentionInDays:14,Tags:tags}},
  WorkerSecurityGroup:{Type:'AWS::EC2::SecurityGroup',Properties:{VpcId:ref('VpcId'),GroupDescription:'Live social publisher: outbound HTTPS only and no inbound traffic.',SecurityGroupIngress:[],SecurityGroupEgress:[{IpProtocol:'tcp',FromPort:443,ToPort:443,CidrIp:'0.0.0.0/0',Description:'Scoped broker, signed private media and allowlisted platform APIs; startup AWS services.'}],Tags:tags}},
  TaskExecutionRole:{Type:'AWS::IAM::Role',Properties:{AssumeRolePolicyDocument:assumeRole,Policies:[{PolicyName:'StartOnlyThisPublisher',PolicyDocument:{Version:'2012-10-17',Statement:[
   {Effect:'Allow',Action:'ecr:GetAuthorizationToken',Resource:'*'},
   {Effect:'Allow',Action:['ecr:BatchCheckLayerAvailability','ecr:GetDownloadUrlForLayer','ecr:BatchGetImage'],Resource:ref('ImageRepositoryArn')},
   {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:attr('WorkerLogs','Arn')},
   {Effect:'Allow',Action:['secretsmanager:GetSecretValue'],Resource:ref('BrokerSecretArn'),Condition:{Bool:{'aws:SecureTransport':'true'}}},
   {Effect:'Allow',Action:['kms:Decrypt'],Resource:ref('BrokerKeyArn'),Condition:{StringEquals:{'kms:ViaService':sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}'),'kms:EncryptionContext:SecretARN':ref('BrokerSecretArn')},Bool:{'aws:SecureTransport':'true'}}},
  ]}}],Tags:tags}},
  Task:{Type:'AWS::ECS::TaskDefinition',Properties:{RequiresCompatibilities:['FARGATE'],NetworkMode:'awsvpc',Cpu:'512',Memory:'1024',RuntimePlatform:{CpuArchitecture:'X86_64',OperatingSystemFamily:'LINUX'},ExecutionRoleArn:attr('TaskExecutionRole','Arn'),Volumes:[{Name:'scratch'}],ContainerDefinitions:[{
   Name:'publisher',Essential:true,Image:sub('${ImageRepositoryUri}@${ImageDigest}'),User:'1000:1000',ReadonlyRootFilesystem:true,StopTimeout:30,
   Command:['node','workers/live-social/pull.mjs'],LinuxParameters:{InitProcessEnabled:true,Capabilities:{Drop:['ALL']}},MountPoints:[{SourceVolume:'scratch',ContainerPath:'/scratch',ReadOnly:false}],Ulimits:[{Name:'nofile',SoftLimit:1024,HardLimit:1024}],
   Environment:[{Name:'NODE_ENV',Value:'production'},{Name:'NODE_OPTIONS',Value:'--max-old-space-size=384'},{Name:'TMPDIR',Value:'/scratch'},{Name:'AWS_EC2_METADATA_DISABLED',Value:'true'},{Name:'LIVE_SOCIAL_PROJECT_ORIGIN',Value:sub('https://${SupabaseProjectRef}.supabase.co')}],
   Secrets:[{Name:'LIVE_SOCIAL_WORKER_SECRET',ValueFrom:ref('BrokerSecretArn')}],HealthCheck:{Command:['CMD','node','workers/live-social/health.mjs'],Interval:60,Timeout:5,Retries:3,StartPeriod:120},
   LogConfiguration:{LogDriver:'awslogs',Options:{'awslogs-group':ref('WorkerLogs'),'awslogs-region':ref('AWS::Region'),'awslogs-stream-prefix':'publisher',mode:'non-blocking','max-buffer-size':'1m'}},
  }],Tags:tags}},
  Service:{Type:'AWS::ECS::Service',Properties:{Cluster:ref('Cluster'),TaskDefinition:ref('Task'),DesiredCount:ref('DesiredCount'),LaunchType:'FARGATE',PlatformVersion:'1.4.0',EnableExecuteCommand:false,DeploymentConfiguration:{MinimumHealthyPercent:100,MaximumPercent:200,DeploymentCircuitBreaker:{Enable:true,Rollback:true}},NetworkConfiguration:{AwsvpcConfiguration:{AssignPublicIp:'ENABLED',Subnets:ref('PublicSubnetIds'),SecurityGroups:[ref('WorkerSecurityGroup')]}},PropagateTags:'TASK_DEFINITION',EnableECSManagedTags:true,Tags:tags}},
  UnavailableMetric:{Type:'AWS::Logs::MetricFilter',Properties:{LogGroupName:ref('WorkerLogs'),FilterPattern:'{ $.service = "live-social" && $.error = "PROVIDER_UNAVAILABLE" }',MetricTransformations:[{MetricNamespace:sub('PlatinumCircles/LiveSocial/${AWS::StackName}'),MetricName:'Unavailable',MetricValue:'1',DefaultValue:0}]}},
  UnavailableAlarm:{Type:'AWS::CloudWatch::Alarm',Properties:{AlarmDescription:'Inspect bounded redacted publishing errors and durable request state. This alarm does not activate or scale publishing.',Namespace:sub('PlatinumCircles/LiveSocial/${AWS::StackName}'),MetricName:'Unavailable',Statistic:'Sum',Period:300,EvaluationPeriods:1,DatapointsToAlarm:1,Threshold:3,ComparisonOperator:'GreaterThanOrEqualToThreshold',TreatMissingData:'notBreaching',ActionsEnabled:false,Tags:tags}},
 },
 Outputs:{TaskDefinitionArn:{Value:ref('Task')},ServiceName:{Value:attr('Service','Name')},ClusterArn:{Value:attr('Cluster','Arn')},WorkerLogGroup:{Value:ref('WorkerLogs')},PinnedImage:{Value:sub('${ImageRepositoryUri}@${ImageDigest}')},Admission:{Value:'No provider is enabled by this stack. Keep integration_runtime publishing gates off until account/app and creator acceptance.'}},
};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await writeFile(new URL('./service-cloudformation.json',import.meta.url),JSON.stringify(socialServiceTemplate(),null,2)+'\n');process.stdout.write('Social publisher template generated; no hosted action performed.\n');}
