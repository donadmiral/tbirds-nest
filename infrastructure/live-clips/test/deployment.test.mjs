import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { rendererBootstrapTemplate } from '../bootstrap-template.mjs';
import { rendererServiceTemplate } from '../service-template.mjs';
import { verifySource } from '../verify-source.mjs';
import { publicationInput, publishImage } from '../image-receipt.mjs';
import { NODE_TAG, resolveBase } from '../resolve-base.mjs';

test('bootstrap build role cannot read the broker secret, deploy workers or write source', () => {
  const template = rendererBootstrapTemplate(), policies = template.Resources.BuildRole.Properties.Policies;
  const actions = policies.flatMap(policy => policy.PolicyDocument.Statement.flatMap(statement => statement.Action));
  assert.ok(actions.includes('ecr:PutImage'));
  assert.equal(actions.some(action => /^(secretsmanager|kms|ecs|iam):/.test(action)), false);
  assert.equal(actions.includes('s3:PutObject'), false);
  assert.equal(Object.values(template.Resources).some(value => value.Type === 'AWS::ECS::Service'), false);
  assert.equal(template.Resources.Builder.Properties.ConcurrentBuildLimit, 1);
  assert.equal(template.Resources.Builder.Properties.TimeoutInMinutes, 30);
  assert.equal(template.Resources.Images.Properties.ImageTagMutability, 'IMMUTABLE');
  assert.equal(template.Resources.BrokerSecret.Properties.GenerateSecretString.PasswordLength, 64);
  assert.equal(JSON.stringify(template.Outputs).includes('SecretString'), false);
});

test('production task has no listener or AWS task credential, immutable image and explicit capacity bounds', () => {
  const template = rendererServiceTemplate(), task = template.Resources.Task.Properties;
  const container = task.ContainerDefinitions[0], service = template.Resources.WorkerService.Properties;
  assert.equal(task.TaskRoleArn, undefined);
  assert.equal(task.Cpu, '2048'); assert.equal(task.Memory, '4096');
  assert.equal(container.PortMappings, undefined);
  assert.equal(container.ReadonlyRootFilesystem, true); assert.equal(container.User, '1000:1000');
  assert.deepEqual(container.LinuxParameters.Capabilities.Drop, ['ALL']);
  assert.equal(container.StopTimeout, 30); assert.ok(container.Image['Fn::Sub'].includes('@'));
  assert.deepEqual(template.Resources.WorkerSecurityGroup.Properties.SecurityGroupIngress, []);
  assert.deepEqual(template.Resources.WorkerSecurityGroup.Properties.SecurityGroupEgress.map(rule => [rule.IpProtocol, rule.FromPort, rule.ToPort]), [['tcp', 443, 443]]);
  assert.equal(service.LoadBalancers, undefined); assert.equal(service.EnableExecuteCommand, false);
  assert.equal(template.Parameters.DesiredCount.Default, 0);
  assert.deepEqual(template.Parameters.DesiredCount.AllowedValues, [0]);
  assert.equal(Object.values(template.Resources).some(value => /NATGateway|LoadBalancer|AutoScaling/.test(value.Type)), false);
  assert.deepEqual(container.Secrets.map(value => value.Name), ['LIVE_CLIP_WORKER_SECRET']);
  assert.equal(container.Environment.some(value => /SERVICE_ROLE|CRON_SECRET/.test(value.Name)), false);
});

test('source verification requires the reviewed exact file set and rejects tampering and extra files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-source-verification-'));
  try {
    await mkdir(path.join(directory, 'workers/live-clips'), { recursive: true });
    const files = [];
    for (let i = 0; i < 10; i++) {
      const name = 'workers/live-clips/test-' + i + '.mjs', bytes = Buffer.from('export const value = ' + i + ';\n');
      await writeFile(path.join(directory, name), bytes);
      files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const manifest = JSON.stringify({ schema_version: 1, files }), digest = createHash('sha256').update(manifest).digest('hex');
    await writeFile(path.join(directory, 'renderer-source-manifest.json'), manifest);
    assert.equal((await verifySource(directory, digest)).file_count, 10);
    await writeFile(path.join(directory, 'unreviewed.env'), 'synthetic');
    await assert.rejects(verifySource(directory, digest), /source_unexpected_file/);
    await rm(path.join(directory, 'unreviewed.env'));
    await writeFile(path.join(directory, files[0].path), 'tampered');
    await assert.rejects(verifySource(directory, digest), /source_file_mismatch/);
    await assert.rejects(verifySource(directory, 'bad'), /source_digest_required/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image publication is impossible after failed tests and verifies the pushed digest before reporting it', () => {
  const digest = 'a'.repeat(64), env = { CODEBUILD_BUILD_SUCCEEDING: '1', EXPECTED_MANIFEST_SHA256: digest,
    RENDERER_REPOSITORY_URI: '123456789012.dkr.ecr.us-east-2.amazonaws.com/synthetic-renderer',
    RENDERER_IMAGE_TAG: 'source-' + digest.slice(0, 32), AWS_DEFAULT_REGION: 'us-east-2' };
  let calls = 0;
  assert.throws(() => publishImage({ ...env, CODEBUILD_BUILD_SUCCEEDING: '0' }, () => { calls++; }), /not_publishable/);
  assert.equal(calls, 0);
  assert.throws(() => publicationInput({ ...env, RENDERER_IMAGE_TAG: 'latest' }), /tag_mismatch/);
  const receipt = publishImage(env, (binary, args) => {
    calls++;
    if (binary === 'docker') { assert.deepEqual(args.slice(0, 1), ['push']); return ''; }
    assert.equal(binary, 'aws');
    return JSON.stringify({ imageDetails: [{ imageDigest: 'sha256:' + 'b'.repeat(64), imageTags: [env.RENDERER_IMAGE_TAG] }] });
  });
  assert.equal(calls, 2); assert.equal(receipt.build_tests_passed, true);
  assert.equal(receipt.deployed, false); assert.equal(receipt.runtime_admission_changed, false);
  assert.ok(receipt.image_uri.endsWith('@sha256:' + 'b'.repeat(64)));
});

test('base resolution checks exact official Node version and architecture and hands Docker an immutable digest', () => {
  const digest = 'node@sha256:' + 'c'.repeat(64);
  const image = { Architecture: 'amd64', Os: 'linux', RepoDigests: [digest], Config: { Env: ['NODE_VERSION=24.22.2'] } };
  const run = value => (binary, args) => {
    assert.equal(binary, 'docker');
    if (args[0] === 'pull') { assert.deepEqual(args, ['pull', '--platform', 'linux/amd64', NODE_TAG]); return ''; }
    return JSON.stringify([value]);
  };
  assert.equal(resolveBase(run(image)).image, digest);
  assert.throws(() => resolveBase(run({ ...image, Architecture: 'arm64' })), /architecture_invalid/);
  assert.throws(() => resolveBase(run({ ...image, RepoDigests: ['node:latest'] })), /digest_invalid/);
  assert.throws(() => resolveBase(run({ ...image, Config: { Env: ['NODE_VERSION=24.22.0'] } })), /version_invalid/);
});
