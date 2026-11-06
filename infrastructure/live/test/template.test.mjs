import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const seedObjectKey = '_bootstrap/synthetic-signing-v1.json';
const bootstrap = phase => liveInfrastructureTemplate({ signingStoreBootstrap: { phase, seedObjectKey } });

test('staging adds only a new private-bucket import and preserves every deployed resource and output', async () => {
  const staged = await bootstrap('stage');
  assert.deepEqual(staged.Resources.SigningKeysImported, { Type: 'AWS::CloudFront::KeyValueStore', Properties: {
    Name: { 'Fn::Sub': '${AWS::StackName}-signing-v1' },
    Comment: 'Private playback signing keys imported from the private bootstrap seed.',
    ImportSource: { SourceArn: { 'Fn::Sub': '${LiveBucket.Arn}/' + seedObjectKey }, SourceType: 'S3' },
  } });
  assert.notDeepEqual(staged.Resources.SigningKeysImported.Properties.Name, resources.SigningKeys.Properties.Name);
  assert.equal(staged.Resources.SigningKeys.Properties.ImportSource, undefined);
  delete staged.Resources.SigningKeysImported;
  assert.deepEqual(staged, template);
});

test('activation changes only the association and active output without changing either store or its import', async () => {
  const staged = await bootstrap('stage'), activated = await bootstrap('activate');
  const association = [{ KeyValueStoreARN: { 'Fn::GetAtt': ['SigningKeysImported', 'Arn'] } }];
  assert.deepEqual(activated.Resources.SigningKeysImported, staged.Resources.SigningKeysImported);
  assert.deepEqual(activated.Resources.SigningKeys, resources.SigningKeys);
  assert.equal(activated.Resources.ViewerAuthorization.Properties.AutoPublish, true);
  staged.Resources.ViewerAuthorization.Properties.FunctionConfig.KeyValueStoreAssociations = association;
  staged.Outputs.SigningStoreArn.Value = { 'Fn::GetAtt': ['SigningKeysImported', 'Arn'] };
  assert.deepEqual(activated, staged);
  assert.deepEqual(await liveInfrastructureTemplate(), template);
});

function resourceDependencies(resource, names) {
  const dependencies = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (names.has(value.Ref)) dependencies.add(value.Ref);
    const getAtt = value['Fn::GetAtt'];
    if (Array.isArray(getAtt) && names.has(getAtt[0])) dependencies.add(getAtt[0]);
    if (typeof value['Fn::Sub'] === 'string') {
      for (const match of value['Fn::Sub'].matchAll(/\$\{([A-Za-z0-9]+)(?:\.[^}]+)?\}/g)) {
        if (names.has(match[1])) dependencies.add(match[1]);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(resource);
  for (const name of [resource.DependsOn].flat()) if (names.has(name)) dependencies.add(name);
  return [...dependencies].sort();
}

test('both phases have acyclic dependencies and activation references the imported store through GetAtt', async () => {
  for (const phase of ['stage', 'activate']) {
    const generated = await bootstrap(phase), names = new Set(Object.keys(generated.Resources));
    const graph = Object.fromEntries([...names].map(name => [name, resourceDependencies(generated.Resources[name], names)]));
    assert.deepEqual(graph.SigningKeysImported, ['LiveBucket']);
    assert.deepEqual(graph.ViewerAuthorization, [phase === 'stage' ? 'SigningKeys' : 'SigningKeysImported']);
    const done = new Set(), visiting = new Set();
    const visit = name => {
      assert.equal(visiting.has(name), false, 'Resource dependency cycle at ' + name);
      if (done.has(name)) return;
      visiting.add(name); for (const dependency of graph[name]) visit(dependency);
      visiting.delete(name); done.add(name);
    };
    for (const name of names) visit(name);
    assert.equal(done.size, names.size);
  }
});

test('bootstrap rejects public-media paths, foreign locations, substitution, traversal and incomplete options', async () => {
  for (const key of ['live/seed.json', 'daily-co-test-upload.txt', 's3://other-bucket/seed.json',
    'arn:aws:s3:::other-bucket/_bootstrap/seed.json', '_bootstrap/../live/seed.json', '_bootstrap/%2e%2e.json',
    '_bootstrap/${Secret}.json', '_bootstrap/seed.json?versionId=1', '_bootstrap/seed.json\n',
    '_bootstrap/seed.txt', '_bootstrap/' + 'x'.repeat(129) + '.json', null, 42]) {
    await assert.rejects(liveInfrastructureTemplate({ signingStoreBootstrap: { phase: 'stage', seedObjectKey: key } }), /Signing-store bootstrap requires/);
  }
  for (const value of [null, [], {}, { phase: 'stage' }, { seedObjectKey }, { phase: 'rotate', seedObjectKey },
    { phase: 'stage', seedObjectKey, secret: 'synthetic-never-accepted' }]) {
    await assert.rejects(liveInfrastructureTemplate({ signingStoreBootstrap: value }), /Signing-store bootstrap requires/);
  }
  await assert.rejects(liveInfrastructureTemplate({ arbitraryDestination: true }), /Invalid infrastructure template options/);
});

const generator = fileURLToPath(new URL('../template.mjs', import.meta.url));
const generate = (args, cwd) => spawnSync(process.execPath, [generator, ...args], { cwd, encoding: 'utf8', timeout: 10000 });

test('CLI generates both optional phases into explicit private files without touching the default artifact', async () => {
  const artifact = new URL('../live-cloudformation.json', import.meta.url), before = await readFile(artifact, 'utf8');
  const directory = await mkdtemp(join(tmpdir(), 'platinum-live-template-'));
  try {
    for (const phase of ['stage', 'activate']) {
      const destination = join(directory, phase + '.json');
      const result = generate([destination, '--signing-import-phase', phase, '--signing-import-key', seedObjectKey], directory);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), await bootstrap(phase));
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
    }
    assert.equal(await readFile(artifact, 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI bootstrap requires a destination and both options before writing any file', async () => {
  const artifact = new URL('../live-cloudformation.json', import.meta.url), before = await readFile(artifact, 'utf8');
  const directory = await mkdtemp(join(tmpdir(), 'platinum-live-template-'));
  try {
    const missingDestination = generate(['--signing-import-phase', 'stage', '--signing-import-key', seedObjectKey], directory);
    assert.notEqual(missingDestination.status, 0);
    assert.match(missingDestination.stderr, /requires an explicit output template path/);
    const destination = join(directory, 'incomplete.json');
    for (const args of [['--signing-import-phase', 'stage'], ['--signing-import-key', seedObjectKey]]) {
      const result = generate([destination, ...args], directory);
      assert.notEqual(result.status, 0); assert.match(result.stderr, /Signing-store bootstrap requires/);
      await assert.rejects(stat(destination), { code: 'ENOENT' });
    }
    assert.equal(await readFile(artifact, 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
