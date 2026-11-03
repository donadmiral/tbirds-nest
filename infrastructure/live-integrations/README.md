# Live integration credentials

[credentials-cloudformation.json](credentials-cloudformation.json) creates **four retained Secrets Manager resources only**, in **us-east-2**. It uses the existing bootstrap key:

```text
arn:aws:kms:us-east-2:518317808503:key/c0502962-cac0-4244-b722-31dfa2fa8fed
```

| Stack output | Generated AWS value | Application destination |
| --- | --- | --- |
| `TranscriptionWorkerSecretArn` | 64 alphanumeric characters | `LIVE_TRANSCRIPTION_WORKER_SECRET` |
| `TranscriptionQueueSecretArn` | Independent 64 alphanumeric characters | `LIVE_TRANSCRIPTION_QUEUE_SECRET` |
| `SocialWorkerSecretArn` | Independent 64 alphanumeric characters | `LIVE_SOCIAL_WORKER_SECRET` |
| `OAuthVaultSeedSecretArn` | 64 lowercase hex characters, representing 32 bytes | Base64url key inside `LIVE_INTEGRATION_VAULT_KEYS`; active ID in `LIVE_INTEGRATION_VAULT_KEY_ID` |

The vault generator's permitted alphabet is exactly `0123456789abcdef`. It disables per-character-class requirements, preserving all possible 32-byte values. Workers and queue readers receive separate generated bearers. CloudFormation outputs expose only exact secret ARNs and fixed encoding metadata.

## Deploy and install

Generate and inspect the template, then use a reviewed CloudFormation change set in the existing account and region. Suggested stack name: `platinum-live-integration-credentials-production`. This template does not need an IAM capability acknowledgement because it contains no IAM resources. It creates no encryption key, role, policy, task, provider app credential or integration admission change.

```sh
node infrastructure/live-integrations/credentials-template.mjs
node --test infrastructure/live-integrations/test/*.test.mjs
PYTHONPATH=/tmp/platinum-live-cfnlint /tmp/platinum-live-cfnlint/bin/cfn-lint infrastructure/live-integrations/credentials-cloudformation.json -r us-east-2
```

After `CREATE_COMPLETE`, read only the four output ARNs and verify each resource's KMS key identifier matches the existing key. Secret retrieval and application installation are a separate authorized operator action; the generator and tests do not retrieve or create values locally.

Use the approved private transfer path for each exact ARN. Keep retrieved strings in protected memory or the established protected operator environment. Do not print values, place them in shell arguments, include them in receipts, or save them in this repository. Validate each worker/queue value against `^[A-Za-z0-9]{64}$` and install its exact bytes in the corresponding production Supabase secret. Do not substitute a worker credential for a queue credential.

For the OAuth seed, validate `^[a-f0-9]{64}$`, decode hexadecimal to **exactly 32 bytes**, then encode those bytes as **unpadded base64url**. The encoded key is 43 characters. Construct the vault JSON with the key ID **`live20261103`**, and install that JSON as `LIVE_INTEGRATION_VAULT_KEYS`. Install the literal ID `live20261103` as `LIVE_INTEGRATION_VAULT_KEY_ID`. The raw hex seed remains encrypted in AWS; the application receives its equivalent base64url key. This is encryption-key provisioning, not OAuth consent or provider client setup.

## Private digest verification

For each worker/queue bearer, compute SHA-256 over the exact AWS string's UTF-8 bytes and compare with the digest of the installed Supabase value. Use the established private metadata/digest check. Record only the destination name, secret ARN/version metadata and a boolean match result.

For the vault, **do not compare the hex string's text digest with the JSON's digest**: those encodings differ. Privately verify that decoding the JSON's `live20261103` base64url value yields the same 32 bytes as the AWS hex seed, using a constant-time comparison. Then compare SHA-256 of the **exact serialized vault JSON installed** with Supabase's secret metadata digest. Verify the active-key-ID digest separately. Record match booleans and encoding lengths, never values.

Once the paired credentials match, verify ordinary user tokens and the wrong worker/queue credential are rejected, while the correctly scoped endpoint accepts its intended idle operation. Keep provider/publishing/transcription admission off until its separate runtime and provider acceptance. These credentials confer no app audit, creator consent, production throughput or capacity evidence.

## Consumers and updates

The transcription and social task templates take the corresponding exact worker secret ARN and this existing KMS key ARN. Their separate reviewed policies control access; this credentials stack grants none. The shared launcher receives only the transcription queue secret ARN and existing key ARN for its optional lane. The OAuth vault seed is not an ECS worker credential.

Changing `GenerateSecretString` creates a new secret version. Treat such a change as an explicit rotation requiring a coordinated matching application update. Preserve prior vault keys needed to decrypt existing ciphertext during a planned rotation; do not overwrite a populated vault map blindly. Do not configure independent AWS-side bearer rotation that leaves Supabase with an old value. `Retain` on deletion and replacement preserves credential recovery and may retain storage charges; removing the stack does not erase the secrets.

Primary references: [CloudFormation generated secret properties](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-secretsmanager-secret-generatesecretstring.html), [CloudFormation secret resource and update behavior](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html). Hosted installation and authentication outcomes belong in the operator's release receipts.
