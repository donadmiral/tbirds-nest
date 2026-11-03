import { readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('hex');
const validPath = name => typeof name === 'string' && /^(?:workers\/live-social\/(?:test\/)?[a-z0-9.-]+|workers\/live-social\/Dockerfile|infrastructure\/live-social\/(?:verify-source\.mjs|image-receipt\.mjs|resolve-base\.mjs|buildspec\.yml))$/.test(name)
  && !name.includes('..') && !name.includes('/.env');
export async function verifySource(root, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw Error('source_digest_required');
  const bytes = await readFile(path.join(root, 'social-source-manifest.json'));
  if (bytes.length > 65536 || hash(bytes) !== expectedHash) throw Error('source_manifest_mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 10 || manifest.files.length > 30) throw Error('source_manifest_invalid');
  const expected = new Set(['social-source-manifest.json']);
  for (const file of manifest.files) {
    if (!validPath(file.path) || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 || '')
      || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 1048576) throw Error('source_entry_invalid');
    expected.add(file.path);
    const absolute = path.join(root, file.path), stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || hash(await readFile(absolute)) !== file.sha256) throw Error('source_file_mismatch');
  }
  async function walk(directory, relative = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = relative + item.name;
      if (item.isDirectory()) await walk(path.join(directory, item.name), name + '/');
      else if (!item.isFile() || !expected.has(name)) throw Error('source_unexpected_file');
    }
  }
  await walk(root);
  return { ok: true, manifest_sha256: expectedHash, file_count: manifest.files.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await verifySource(process.cwd(), process.env.EXPECTED_MANIFEST_SHA256)) + '\n'); }
  catch { process.stderr.write('{"ok":false,"error":"source_verification_failed"}\n'); process.exitCode = 1; }
}
