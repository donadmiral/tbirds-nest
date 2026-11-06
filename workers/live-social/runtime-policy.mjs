import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function runtimeFailureCode(error) {
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'inventory_permission_denied';
  const known = new Set(['runtime_identity_invalid', 'base_receipt_invalid', 'unneeded_runtime_component',
    'runtime_distribution_invalid', 'runtime_inventory_invalid', 'runtime_components_invalid']);
  return known.has(error?.message) ? error.message : 'runtime_inventory_unavailable';
}

export function runtimeInventory({ read = readFileSync, exists = existsSync, execute = execFileSync, runtime = process } = {}) {
  if (runtime.version !== 'v24.22.2' || runtime.platform !== 'linux' || runtime.arch !== 'x64'
    || typeof runtime.getuid !== 'function' || runtime.getuid() !== 1000) throw Error('runtime_identity_invalid');
  const base = JSON.parse(read('/usr/local/share/pc-live-social/base-image.json', 'utf8'));
  if (base.tag !== 'node:24.22.2-alpine3.24' || !/^node@sha256:[a-f0-9]{64}$/.test(base.image || '')
    || base.node_version !== '24.22.2' || base.architecture !== 'amd64') throw Error('base_receipt_invalid');
  for (const file of ['/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/yarn', '/usr/local/bin/corepack',
    '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffprobe', '/usr/local/bin/ffprobe',
    '/usr/bin/gcc', '/usr/bin/make', '/app/node_modules', '/app/workers/live-social/node_modules']) {
    if (exists(file)) throw Error('unneeded_runtime_component');
  }
  const alpine = String(read('/etc/alpine-release', 'utf8')).trim();
  if (!/^3\.24\.\d+$/.test(alpine)) throw Error('runtime_distribution_invalid');
  const packages = String(execute('apk', ['info', '-v'], { encoding: 'utf8', timeout: 10000, maxBuffer: 262144 }))
    .trim().split('\n').sort();
  if (!packages.length || packages.length > 100 || packages.some(line => !/^[a-zA-Z0-9._+:-]{1,180}$/.test(line))) throw Error('runtime_inventory_invalid');
  const components = Object.fromEntries(['node', 'openssl', 'undici', 'v8', 'uv'].map(name => [name, runtime.versions?.[name]]));
  if (Object.values(components).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9._+-]{1,80}$/.test(value))) throw Error('runtime_components_invalid');
  return { schema_version: 1, ok: true, service: 'live-social', node_version: runtime.version, platform: runtime.platform,
    architecture: runtime.arch, uid: 1000, alpine_version: alpine, base, packages, runtime_components: components,
    package_managers_removed: true, ffmpeg_present: false, application_dependencies: [], vulnerability_free_claim: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(runtimeInventory()) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ok:false,error:'social_runtime_policy_failed',reason:runtimeFailureCode(error)})+'\n'); process.exitCode = 1; }
}
