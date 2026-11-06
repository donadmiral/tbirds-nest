import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const attr = (name, field) => ({ 'Fn::GetAtt': [name, field] });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveClipRenderer' }];
const roleTrust = service => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow',
  Principal: { Service: service }, Action: 'sts:AssumeRole',
  Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') } } }] });

/** Bootstrap has no running renderer, public endpoint, scheduler or application credential output. */
export function rendererBootstrapTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Platinum Live clip renderer: isolated image build and encrypted broker-secret bootstrap.',
    Resources: {
      BrokerKey: { Type: 'AWS::KMS::Key', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        Description: 'Encrypt only the dedicated Live clip broker credential through Secrets Manager.',
        EnableKeyRotation: true, PendingWindowInDays: 30, Tags: tags,
        KeyPolicy: { Version: '2012-10-17', Statement: [
          { Sid: 'AccountKeyAdministration', Effect: 'Allow', Principal: { AWS: sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root') },
            Action: ['kms:Create*', 'kms:Describe*', 'kms:Enable*', 'kms:List*', 'kms:Put*', 'kms:Update*', 'kms:Revoke*',
              'kms:Disable*', 'kms:Get*', 'kms:Delete*', 'kms:TagResource', 'kms:UntagResource', 'kms:ScheduleKeyDeletion', 'kms:CancelKeyDeletion'], Resource: '*' },
          { Sid: 'AccountUseOnlyThroughSecretsManager', Effect: 'Allow', Principal: { AWS: sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:root') },
            Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'], Resource: '*',
            Condition: { StringEquals: { 'kms:CallerAccount': ref('AWS::AccountId'),
              'kms:ViaService': sub('secretsmanager.${AWS::Region}.${AWS::URLSuffix}') } } },
        ] },
      } },
      BrokerSecret: { Type: 'AWS::SecretsManager::Secret', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        Name: sub('${AWS::StackName}/broker'), Description: 'Dedicated LIVE_CLIP_WORKER_SECRET; install the same value in the Supabase clip broker.',
        KmsKeyId: attr('BrokerKey', 'Arn'), GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true, IncludeSpace: false },
        Tags: tags,
      } },
      SourceBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] }, VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireBuildInputs', Status: 'Enabled', Prefix: 'source/', ExpirationInDays: 30,
          NoncurrentVersionExpiration: { NoncurrentDays: 7 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] }, Tags: tags,
      } },
      SourceBucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('SourceBucket'),
        PolicyDocument: { Version: '2012-10-17', Statement: [{ Sid: 'RequireTls', Effect: 'Deny', Principal: '*',
          Action: 's3:*', Resource: [attr('SourceBucket', 'Arn'), sub('${SourceBucket.Arn}/*')],
          Condition: { Bool: { 'aws:SecureTransport': 'false' } } }] } } },
      Images: { Type: 'AWS::ECR::Repository', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        ImageTagMutability: 'IMMUTABLE', ImageScanningConfiguration: { ScanOnPush: true }, EncryptionConfiguration: { EncryptionType: 'AES256' },
        LifecyclePolicy: { LifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, description: 'Remove only old untagged layers',
          selection: { tagStatus: 'untagged', countType: 'sinceImagePushed', countUnit: 'days', countNumber: 7 }, action: { type: 'expire' } }] }) },
        Tags: tags,
      } },
      BuildLogs: { Type: 'AWS::Logs::LogGroup', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        LogGroupName: sub('/platinum/live-clips/${AWS::StackName}/build'), RetentionInDays: 14, Tags: tags,
      } },
      BuildRole: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: roleTrust('codebuild.amazonaws.com'),
        Policies: [{ PolicyName: 'BuildOnlyThisRenderer', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: ['s3:GetObject', 's3:GetObjectVersion'], Resource: sub('${SourceBucket.Arn}/source/renderer-source.zip') },
          { Effect: 'Allow', Action: ['s3:GetBucketLocation'], Resource: attr('SourceBucket', 'Arn') },
          { Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*' },
          { Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:CompleteLayerUpload', 'ecr:InitiateLayerUpload',
            'ecr:PutImage', 'ecr:UploadLayerPart', 'ecr:BatchGetImage', 'ecr:DescribeImages'], Resource: attr('Images', 'Arn') },
          { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: sub('${BuildLogs.Arn}:*') },
        ] } }], Tags: tags,
      } },
      Builder: { Type: 'AWS::CodeBuild::Project', Properties: {
        Description: 'Build and locally test only the reviewed Live renderer source package. Never reads application secrets.',
        ServiceRole: attr('BuildRole', 'Arn'), ConcurrentBuildLimit: 1, TimeoutInMinutes: 30, QueuedTimeoutInMinutes: 5,
        Artifacts: { Type: 'NO_ARTIFACTS' }, Cache: { Type: 'NO_CACHE' },
        Source: { Type: 'S3', Location: sub('${SourceBucket}/source/renderer-source.zip'),
          BuildSpec: 'infrastructure/live-clips/buildspec.yml' },
        Environment: { Type: 'LINUX_CONTAINER', Image: 'aws/codebuild/standard:7.0', ComputeType: 'BUILD_GENERAL1_MEDIUM',
          PrivilegedMode: true, ImagePullCredentialsType: 'CODEBUILD', EnvironmentVariables: [
            { Name: 'RENDERER_REPOSITORY_URI', Value: attr('Images', 'RepositoryUri') },
            { Name: 'EXPECTED_MANIFEST_SHA256', Value: 'REQUIRED_OPERATOR_OVERRIDE' },
          ] },
        LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('BuildLogs'), StreamName: 'image' }, S3Logs: { Status: 'DISABLED' } },
        Tags: tags,
      } },
    },
    Outputs: {
      SourceBucket: { Value: ref('SourceBucket') }, SourceObjectKey: { Value: 'source/renderer-source.zip' },
      RepositoryUri: { Value: attr('Images', 'RepositoryUri') }, RepositoryArn: { Value: attr('Images', 'Arn') },
      BuildProjectName: { Value: ref('Builder') }, BuildLogGroup: { Value: ref('BuildLogs') },
      BrokerSecretArn: { Value: ref('BrokerSecret') }, BrokerKeyArn: { Value: attr('BrokerKey', 'Arn') },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./bootstrap-cloudformation.json', import.meta.url), JSON.stringify(rendererBootstrapTemplate(), null, 2) + '\n');
  process.stdout.write('Renderer bootstrap template generated; no hosted action performed.\n');
}
