import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXISTING_KEY_ARN, VAULT_KEY_ID, integrationCredentialsTemplate } from '../credentials-template.mjs';

function alphabet(generation) {
  const groups = [generation.ExcludeUppercase ? '' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    generation.ExcludeLowercase ? '' : 'abcdefghijklmnopqrstuvwxyz', generation.ExcludeNumbers ? '' : '0123456789'];
  assert.equal(generation.ExcludePunctuation, true); assert.equal(generation.IncludeSpace, false);
  return groups.join('').split('').filter(character => !(generation.ExcludeCharacters || '').includes(character)).sort().join('');
}
test('credentials stack creates exactly four retained secrets with the existing CMK and no other resources', async () => {
  const template = integrationCredentialsTemplate(), resources = Object.values(template.Resources);
  assert.equal(resources.length, 4);
  for (const resource of resources) {
    assert.equal(resource.Type, 'AWS::SecretsManager::Secret');
    assert.equal(resource.DeletionPolicy, 'Retain'); assert.equal(resource.UpdateReplacePolicy, 'Retain');
    assert.equal(resource.Properties.KmsKeyId, EXISTING_KEY_ARN);
    assert.equal(Object.hasOwn(resource.Properties, 'SecretString'), false);
    assert.equal(Object.hasOwn(resource.Properties, 'ReplicaRegions'), false);
  }
  assert.equal(template.Parameters, undefined);
  assert.deepEqual(template, JSON.parse(await readFile(new URL('../credentials-cloudformation.json', import.meta.url), 'utf8')));
});
test('worker and queue generation uses independent 64-character alphanumeric secrets without embedded values', () => {
  const template = integrationCredentialsTemplate();
  const names = new Set();
  for (const key of ['TranscriptionWorker', 'TranscriptionQueue', 'SocialWorker']) {
    const properties = template.Resources[key].Properties, generation = properties.GenerateSecretString;
    assert.equal(generation.PasswordLength, 64); assert.equal(generation.RequireEachIncludedType, false);
    assert.equal(alphabet(generation), '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
    assert.equal(generation.GenerateStringKey, undefined); assert.equal(generation.SecretStringTemplate, undefined);
    names.add(properties.Name['Fn::Sub']);
  }
  assert.equal(names.size, 3);
});
test('vault generation preserves the full 256-bit hex space without per-class forcing', () => {
  const generation = integrationCredentialsTemplate().Resources.OAuthVaultSeed.Properties.GenerateSecretString;
  assert.equal(generation.PasswordLength, 64);
  assert.equal(generation.ExcludeUppercase, true); assert.equal(generation.ExcludePunctuation, true);
  assert.equal(generation.ExcludeCharacters, 'ghijklmnopqrstuvwxyz');
  assert.equal(generation.RequireEachIncludedType, false);
  assert.equal(alphabet(generation), '0123456789abcdef');
  assert.equal(generation.PasswordLength * Math.log2(alphabet(generation).length), 256);
  assert.equal(VAULT_KEY_ID, 'live20261103');
});
test('outputs expose only resource ARNs and fixed encoding metadata, with no secret-value references', () => {
  const template = integrationCredentialsTemplate(), outputs = template.Outputs;
  assert.deepEqual(Object.keys(outputs).sort(), ['OAuthVaultSeedSecretArn', 'SocialWorkerSecretArn', 'TranscriptionQueueSecretArn',
    'TranscriptionWorkerSecretArn', 'VaultKeyId', 'VaultSeedEncoding', 'WorkerCredentialEncoding'].sort());
  for (const [name, output] of Object.entries(outputs)) {
    if (name.endsWith('SecretArn')) assert.equal(template.Resources[output.Value.Ref].Type, 'AWS::SecretsManager::Secret');
    else assert.equal(typeof output.Value, 'string');
  }
  const source = JSON.stringify(template);
  assert.equal(source.includes('resolve:secretsmanager'), false);
  assert.equal(source.includes('GetSecretValue'), false);
  assert.equal(source.includes('AWS::IAM::'), false);
  assert.equal(source.includes('AWS::KMS::Key'), false);
});
