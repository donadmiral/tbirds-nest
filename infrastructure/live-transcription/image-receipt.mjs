import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function publicationInput(env) {
  if (env.CODEBUILD_BUILD_SUCCEEDING !== '1' || !/^[a-f0-9]{64}$/.test(env.EXPECTED_MANIFEST_SHA256 || '')
    || !/^[0-9]{12}\.dkr\.ecr\.us-east-2\.amazonaws\.com\/[a-z0-9._/-]+$/.test(env.ASR_REPOSITORY_URI || '')
    || env.AWS_DEFAULT_REGION !== 'us-east-2') throw Error('build_not_publishable');
  const tag = 'asr-source-' + env.EXPECTED_MANIFEST_SHA256.slice(0, 32);
  if (env.ASR_IMAGE_TAG !== tag) throw Error('build_tag_mismatch');
  return { tag, uri: env.ASR_REPOSITORY_URI, repository: env.ASR_REPOSITORY_URI.split('/').slice(1).join('/'),
    manifest_sha256: env.EXPECTED_MANIFEST_SHA256 };
}
export function publishImage(env, execute = execFileSync) {
  const value = publicationInput(env);
  execute('docker', ['push', value.uri + ':' + value.tag], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1048576 });
  const raw = execute('aws', ['ecr', 'describe-images', '--region', 'us-east-2', '--repository-name', value.repository,
    '--image-ids', 'imageTag=' + value.tag, '--output', 'json'], { encoding: 'utf8', maxBuffer: 1048576 });
  const record = JSON.parse(raw).imageDetails?.[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(record?.imageDigest || '') || !record.imageTags?.includes(value.tag)) throw Error('pushed_image_not_verified');
  return { schema_version: 1, event: 'transcription_image_published', manifest_sha256: value.manifest_sha256,
    image_digest: record.imageDigest, image_uri: value.uri + '@' + record.imageDigest,
    image_tag: value.tag, build_tests_passed: true, deployed: false, runtime_admission_changed: false };
}
export function validateAcceptance(base,inventory,acceptance){
  if (inventory.ok !== true || inventory.ffmpeg_version !== '9.0.2' || inventory.base?.image !== base.image || inventory.vulnerability_free_claim !== false
    || acceptance.audio?.ok !== true || acceptance.audio?.source_sha256 !== '6921fe4c44361a62d42049b8d4eafdfedf9836a24db1dbb5c2921f9ef73bd293'
    || acceptance.hosted_transcription_accepted !== false || acceptance.encoder?.base?.image !== base.image
    || acceptance.runtime_uid !== 1000 || acceptance.base_metadata_owner_uid !== 0 || acceptance.base_metadata_mode !== '0444') throw Error('image_acceptance_missing');
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = JSON.parse(readFileSync('transcription-base-image.json', 'utf8'));
    if (!/^node@sha256:[a-f0-9]{64}$/.test(base.image) || base.node_version !== '24.22.2') throw Error('base_receipt_invalid');
    const inventory = JSON.parse(readFileSync('asr-image-inventory.json','utf8'));
    const acceptance = JSON.parse(readFileSync('asr-audio-acceptance.json','utf8'));
    validateAcceptance(base,inventory,acceptance);
    process.stdout.write(JSON.stringify({ ...publishImage(process.env), base, inventory, audio_acceptance: acceptance.audio,
      runtime_uid:acceptance.runtime_uid,base_metadata_owner_uid:acceptance.base_metadata_owner_uid,base_metadata_mode:acceptance.base_metadata_mode,
      hosted_transcription_accepted: false, image_scan_required: true }) + '\n');
  }
  catch { process.stderr.write('{"ok":false,"error":"transcription_image_publish_failed"}\n'); process.exitCode = 1; }
}
