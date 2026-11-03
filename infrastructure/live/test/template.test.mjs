import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveInfrastructureTemplate } from '../template.mjs';
const template = await liveInfrastructureTemplate(), resources = template.Resources;

test('generated deployment artifact exactly matches the reviewed generator and function', async () => {
  const artifact = JSON.parse(await readFile(new URL('../live-cloudformation.json', import.meta.url), 'utf8'));
  assert.deepEqual(artifact, template);
  assert.ok(Buffer.byteLength(resources.ViewerAuthorization.Properties.FunctionCode, 'utf8') <= 10240);
});

test('Daily trust is domain-scoped, supports twelve-hour sessions and limits object access', () => {
  const role = resources.DailyWriter.Properties;
  assert.equal(role.MaxSessionDuration, 43200);
  const trust = role.AssumeRolePolicyDocument.Statement;
  assert.equal(trust.length, 1); assert.equal(trust[0].Action, 'sts:AssumeRole');
  assert.deepEqual(trust[0].Principal, { AWS: { 'Fn::Sub': 'arn:aws:iam::${DailyAccountId}:root' } });
  assert.deepEqual(trust[0].Condition, { StringEquals: { 'sts:ExternalId': { Ref: 'DailyExternalId' } } });
  const domainPattern = new RegExp('^(?:' + template.Parameters.DailyExternalId.AllowedPattern + ')$');
  assert.ok(domainPattern.test('synthetic-live')); assert.ok(!domainPattern.test('https://synthetic.daily.co'));
  const permissions = role.Policies[0].PolicyDocument.Statement;
  const objectStatement = permissions.find(item => Array.isArray(item.Action) && item.Action.includes('s3:PutObject'));
  assert.deepEqual(objectStatement.Resource, { 'Fn::Sub': '${LiveBucket.Arn}/live/*' });
  const probeStatement = permissions.find(item => item.Resource?.['Fn::Sub']?.endsWith('/daily-co-test-upload.txt'));
  assert.equal(probeStatement.Action, 's3:PutObject');
  assert.ok(permissions.every(item => item.Resource !== '*' && item.Action !== 's3:*'));
});

test('every cache behavior authenticates before shared lookup and never forwards write methods', () => {
  const distribution = resources.LiveCdn.Properties.DistributionConfig;
  for (const behavior of [distribution.DefaultCacheBehavior, ...distribution.CacheBehaviors]) {
    assert.deepEqual(behavior.AllowedMethods, ['GET', 'HEAD', 'OPTIONS']);
    assert.deepEqual(behavior.CachedMethods, ['GET', 'HEAD']); assert.equal(behavior.ViewerProtocolPolicy, 'https-only');
    assert.deepEqual(behavior.FunctionAssociations, [{ EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': ['ViewerAuthorization', 'FunctionMetadata.FunctionARN'] } }]);
  }
  assert.equal(resources.ViewerAuthorization.Properties.FunctionConfig.Runtime, 'cloudfront-js-2.0');
  assert.deepEqual(resources.ViewerAuthorization.Properties.FunctionConfig.KeyValueStoreAssociations,
    [{ KeyValueStoreARN: { 'Fn::GetAtt': ['SigningKeys', 'Arn'] } }]);
  assert.equal(resources.ManifestCache.Properties.CachePolicyConfig.MaxTTL, 2);
  assert.equal(resources.ManifestCache.Properties.CachePolicyConfig.MinTTL, 0);
  assert.equal(resources.PlaybackHeaders.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items[0].Value, 'private, max-age=1');
});

test('S3 stays private, encrypted, versioned and retained with distribution-specific OAC reads', () => {
  const bucket = resources.LiveBucket;
  assert.equal(bucket.DeletionPolicy, 'Retain'); assert.equal(bucket.UpdateReplacePolicy, 'Retain');
  assert.ok(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(value => value === true));
  assert.equal(bucket.Properties.OwnershipControls.Rules[0].ObjectOwnership, 'BucketOwnerEnforced');
  assert.equal(bucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  const read = resources.LiveBucketPolicy.Properties.PolicyDocument.Statement.find(item => item.Sid === 'CdnReadOnly');
  assert.equal(read.Action, 's3:GetObject'); assert.deepEqual(read.Resource, { 'Fn::Sub': '${LiveBucket.Arn}/live/*' });
  assert.deepEqual(read.Condition, { StringEquals: { 'AWS:SourceArn': { 'Fn::Sub': 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${LiveCdn}' } } });
  assert.equal(resources.OriginAccess.Properties.OriginAccessControlConfig.SigningBehavior, 'always');
});
