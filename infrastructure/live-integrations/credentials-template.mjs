import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const EXISTING_KEY_ARN = 'arn:aws:kms:us-east-2:518317808503:key/c0502962-cac0-4244-b722-31dfa2fa8fed';
export const VAULT_KEY_ID = 'live20261103';
const ref = name => ({ Ref: name });
const sub = value => ({ 'Fn::Sub': value });
const tags = [{ Key: 'Application', Value: 'PlatinumCircles' }, { Key: 'Purpose', Value: 'LiveIntegrationCredentials' }];
const alphanumeric = () => ({ PasswordLength: 64, ExcludePunctuation: true, IncludeSpace: false,
  ExcludeUppercase: false, ExcludeLowercase: false, ExcludeNumbers: false, RequireEachIncludedType: false });
const secret = (suffix, description, generation = alphanumeric()) => ({
  Type: 'AWS::SecretsManager::Secret', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain',
  Properties: { Name: sub('${AWS::StackName}/' + suffix), Description: description,
    KmsKeyId: EXISTING_KEY_ARN, GenerateSecretString: generation, Tags: tags },
});

/** Only four encrypted retained values. No retrieval, runtime role, key or admission change. */
export function integrationCredentialsTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Four retained Live integration credentials in us-east-2, encrypted with the existing bootstrap KMS key. No IAM, compute, provider credentials or admission changes.',
    Resources: {
      TranscriptionWorker: secret('transcription/worker', 'Dedicated Live transcription worker bearer; pair with LIVE_TRANSCRIPTION_WORKER_SECRET.'),
      TranscriptionQueue: secret('transcription/queue', 'Queue metadata only; pair with LIVE_TRANSCRIPTION_QUEUE_SECRET. Separate from worker authority.'),
      SocialWorker: secret('social/worker', 'Dedicated Live social worker bearer; pair with LIVE_SOCIAL_WORKER_SECRET.'),
      OAuthVaultSeed: secret('oauth/vault-seed', 'OAuth vault seed: 64 lowercase hexadecimal characters encoding 32 random bytes. Convert privately to unpadded base64url under key ID live20261103.', {
        PasswordLength: 64, ExcludeUppercase: true, ExcludeLowercase: false, ExcludeNumbers: false,
        ExcludePunctuation: true, IncludeSpace: false, ExcludeCharacters: 'ghijklmnopqrstuvwxyz', RequireEachIncludedType: false,
      }),
    },
    Outputs: {
      TranscriptionWorkerSecretArn: { Value: ref('TranscriptionWorker') },
      TranscriptionQueueSecretArn: { Value: ref('TranscriptionQueue') },
      SocialWorkerSecretArn: { Value: ref('SocialWorker') },
      OAuthVaultSeedSecretArn: { Value: ref('OAuthVaultSeed') },
      WorkerCredentialEncoding: { Value: '64 ASCII alphanumeric characters; install the exact string without whitespace or re-encoding.' },
      VaultSeedEncoding: { Value: '64 lowercase hex characters = 32 bytes; decode hex, encode unpadded base64url, place in LIVE_INTEGRATION_VAULT_KEYS JSON.' },
      VaultKeyId: { Value: VAULT_KEY_ID },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('./credentials-cloudformation.json', import.meta.url), JSON.stringify(integrationCredentialsTemplate(), null, 2) + '\n');
  process.stdout.write('Four-resource credentials template generated; no secret was generated or retrieved locally.\n');
}
