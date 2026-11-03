import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const attr = (name, key) => ({ 'Fn::GetAtt': [name, key] });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveTranscription' }];

/** Storage and service role only. Creates no job, subscription, worker or gate. */
export function transcriptionStorageTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Private ephemeral Live caption input/output and narrowly scoped Transcribe data role. No worker or job is started.',
    Resources: {
      AudioBucket: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireCaptionScratch', Status: 'Enabled', Prefix: 'transcription/',
          ExpirationInDays: 1, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] },
        Tags: tags,
      } },
      SecureBucketPolicy: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref('AudioBucket'), PolicyDocument: {
        Version: '2012-10-17', Statement: [{ Sid: 'RejectInsecureTransport', Effect: 'Deny', Principal: '*',
          Action: 's3:*', Resource: [attr('AudioBucket', 'Arn'), sub('${AudioBucket.Arn}/*')], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }],
      } } },
      TranscribeDataRole: { Type: 'AWS::IAM::Role', Properties: {
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'transcribe.amazonaws.com' },
          Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': ref('AWS::AccountId') },
            ArnLike: { 'aws:SourceArn': sub('arn:${AWS::Partition}:transcribe:us-east-2:${AWS::AccountId}:transcription-job/pc-live-caption-*') } } }] },
        Policies: [{ PolicyName: 'ReadCaptionAudioWriteCaptionJson', PolicyDocument: { Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 's3:GetBucketLocation', Resource: attr('AudioBucket', 'Arn') },
          // HeadBucket requires ListBucket and sends no s3:prefix. The dedicated
          // scratch bucket permits that metadata check; object access stays exact.
          { Effect: 'Allow', Action: 's3:ListBucket', Resource: attr('AudioBucket', 'Arn') },
          { Effect: 'Allow', Action: 's3:GetObject', Resource: sub('${AudioBucket.Arn}/transcription/*/source.flac') },
          { Effect: 'Allow', Action: 's3:PutObject', Resource: sub('${AudioBucket.Arn}/transcription/*/result.json') },
        ] } }], Tags: tags,
      } },
    },
    Outputs: {
      BucketName: { Value: ref('AudioBucket') }, BucketArn: { Value: attr('AudioBucket', 'Arn') },
      DataAccessRoleArn: { Value: attr('TranscribeDataRole', 'Arn') }, Region: { Value: 'us-east-2' },
      Admission: { Value: 'No caption admission or AWS job was enabled by this stack.' },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./storage-cloudformation.json', import.meta.url), JSON.stringify(transcriptionStorageTemplate(), null, 2) + '\n');
  process.stdout.write('Transcription storage template generated; no hosted action performed.\n');
}
