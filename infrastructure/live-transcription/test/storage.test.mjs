import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transcriptionStorageTemplate } from '../storage-template.mjs';

test('storage stack creates no runnable workload, public object access or runtime admission', async () => {
  const template = transcriptionStorageTemplate();
  assert.deepEqual(template, JSON.parse(await readFile(new URL('../storage-cloudformation.json', import.meta.url), 'utf8')));
  assert.deepEqual(Object.values(template.Resources).map(r => r.Type).sort(), ['AWS::IAM::Role', 'AWS::S3::Bucket', 'AWS::S3::BucketPolicy']);
  const bucket = template.Resources.AudioBucket;
  assert.equal(bucket.DeletionPolicy, 'Retain');
  assert.ok(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(value => value === true));
  assert.equal(bucket.Properties.OwnershipControls.Rules[0].ObjectOwnership, 'BucketOwnerEnforced');
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  assert.equal(bucket.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays, 1);
});
test('Transcribe data role is constrained to exact service, account, region, job prefix and object types', () => {
  const role = transcriptionStorageTemplate().Resources.TranscribeDataRole.Properties;
  const trust = role.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Principal.Service, 'transcribe.amazonaws.com');
  assert.deepEqual(trust.Condition.StringEquals['aws:SourceAccount'], { Ref: 'AWS::AccountId' });
  assert.match(trust.Condition.ArnLike['aws:SourceArn']['Fn::Sub'], /transcribe:us-east-2:.*:transcription-job\/pc-live-caption-\*$/);
  const policy = role.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(policy.map(s => s.Action), ['s3:GetBucketLocation', 's3:ListBucket', 's3:GetObject', 's3:PutObject']);
  // https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html
  // HeadBucket requires ListBucket but cannot supply a prefix condition.
  assert.equal(policy.find(s => s.Action === 's3:ListBucket').Condition, undefined);
  assert.deepEqual(policy.find(s => s.Action === 's3:ListBucket').Resource, { 'Fn::GetAtt': ['AudioBucket', 'Arn'] });
  assert.ok(policy.find(s => s.Action === 's3:GetObject').Resource['Fn::Sub'].endsWith('/transcription/*/source.flac'));
  assert.ok(policy.find(s => s.Action === 's3:PutObject').Resource['Fn::Sub'].endsWith('/transcription/*/result.json'));
  assert.ok(policy.every(s => s.Resource !== '*'));
});
