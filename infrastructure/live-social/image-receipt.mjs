import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function publicationInput(env) {
  if (env.CODEBUILD_BUILD_SUCCEEDING !== '1' || !/^[a-f0-9]{64}$/.test(env.EXPECTED_MANIFEST_SHA256 || '')
    || !/^[0-9]{12}\.dkr\.ecr\.us-east-2\.amazonaws\.com\/[a-z0-9._/-]+$/.test(env.RENDERER_REPOSITORY_URI || '')
    || env.AWS_DEFAULT_REGION !== 'us-east-2') throw Error('build_not_publishable');
  const tag = 'social-source-' + env.EXPECTED_MANIFEST_SHA256.slice(0, 32);
  if (env.SOCIAL_IMAGE_TAG !== tag) throw Error('build_tag_mismatch');
  return { tag, uri: env.RENDERER_REPOSITORY_URI, repository: env.RENDERER_REPOSITORY_URI.split('/').slice(1).join('/'),
    manifest_sha256: env.EXPECTED_MANIFEST_SHA256 };
}
export function validateAcceptance(base, inventory, acceptance) {
  if (!/^node@sha256:[a-f0-9]{64}$/.test(base?.image || '') || base.node_version !== '24.22.2' || base.tag !== 'node:24.22.2-alpine3.24'
    || inventory?.ok !== true || inventory.node_version !== 'v24.22.2' || inventory.uid !== 1000
    || inventory.base?.image !== base.image || inventory.vulnerability_free_claim !== false || inventory.ffmpeg_present !== false
    || inventory.package_managers_removed !== true || !Array.isArray(inventory.application_dependencies) || inventory.application_dependencies.length
    || !Array.isArray(inventory.packages) || !inventory.packages.length || inventory.packages.length > 100
    || acceptance?.ok !== true || acceptance.base_image !== base.image || acceptance.actual_worker_flow_passed !== true
    || acceptance.base_metadata_owner_uid !== 0 || acceptance.base_metadata_mode !== '0444'
    || acceptance.private_scratch_permissions !== true || acceptance.scratch_cleanup_passed !== true
    || acceptance.provider_responses !== 'synthetic_offline_fixtures' || acceptance.hosted_provider_accepted !== false
    || acceptance.external_posts_created !== false) throw Error('image_acceptance_missing');
  return true;
}
export function publishImage(env, execute = execFileSync) {
  const value = publicationInput(env);
  execute('docker', ['push', value.uri + ':' + value.tag], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1048576, timeout: 180000 });
  const raw = execute('aws', ['ecr', 'describe-images', '--region', 'us-east-2', '--repository-name', value.repository,
    '--image-ids', 'imageTag=' + value.tag, '--output', 'json'], { encoding: 'utf8', maxBuffer: 1048576, timeout: 30000 });
  const record = JSON.parse(raw).imageDetails?.[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(record?.imageDigest || '') || !record.imageTags?.includes(value.tag)) throw Error('pushed_image_not_verified');
  return { schema_version: 1, event: 'social_image_published', manifest_sha256: value.manifest_sha256,
    image_digest: record.imageDigest, image_uri: value.uri + '@' + record.imageDigest,
    image_tag: value.tag, build_tests_passed: true, deployed: false, runtime_admission_changed: false,
    image_scan_required: true, image_scan_status: 'pending_owner_review' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = JSON.parse(readFileSync('social-base-image.json', 'utf8'));
    const inventory = JSON.parse(readFileSync('social-image-inventory.json', 'utf8'));
    const acceptance = JSON.parse(readFileSync('social-runtime-acceptance.json', 'utf8'));
    validateAcceptance(base, inventory, acceptance);
    process.stdout.write(JSON.stringify({ ...publishImage(process.env), base, inventory, acceptance }) + '\n');
  } catch { process.stderr.write('{"ok":false,"error":"social_image_publish_failed"}\n'); process.exitCode = 1; }
}
