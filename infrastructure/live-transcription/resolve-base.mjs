import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NODE_TAG = 'node:24.22.2-alpine3.24';
export function resolveBase(run = execFileSync) {
  run('docker', ['pull', '--platform', 'linux/amd64', NODE_TAG], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180000 });
  const raw = run('docker', ['image', 'inspect', NODE_TAG], { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
  const images = JSON.parse(raw);
  if (images.length !== 1 || images[0].Architecture !== 'amd64' || images[0].Os !== 'linux') throw Error('base_architecture_invalid');
  const digests = (images[0].RepoDigests || []).filter(value => /^node@sha256:[a-f0-9]{64}$/.test(value));
  if (digests.length !== 1) throw Error('base_digest_invalid');
  const version = (images[0].Config?.Env || []).find(value => value.startsWith('NODE_VERSION='));
  if (version !== 'NODE_VERSION=24.22.2') throw Error('base_version_invalid');
  return { schema_version: 1, tag: NODE_TAG, image: digests[0], architecture: 'amd64', node_version: '24.22.2' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = resolveBase();
    writeFileSync('transcription-base-image.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(receipt.image + '\n');
  } catch { process.stderr.write('{"ok":false,"error":"transcription_base_verification_failed"}\n'); process.exitCode = 1; }
}
