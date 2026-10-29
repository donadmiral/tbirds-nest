import {PGlite} from '@electric-sql/pglite';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCommunityGroupSuite} from './community-group-tests.mjs';

await import('./test-push-authorization.mjs');
const group = new PGlite();
try {
  const result = await runCommunityGroupSuite(group);
  console.log(JSON.stringify(result, null, 2));
} finally { await group.close(); }
await import('./test-combined-atomicity.mjs');
await import('./test-postflight.mjs');

await import('./test-admin-commands.mjs');
await import('./test-verification-integrity.mjs');
await import('./test-pending-migration-chain.mjs');

// These suites own node:test lifecycle hooks and full synthetic databases.
// Keep each process isolated so one suite cannot alter another suite's hooks.
for (const script of [
  './test-production-rollout-chain.mjs',
  './test-legacy-chat-media-compatibility.mjs',
  './test-legacy-public-media-snapshots.mjs',
]) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {stdio: 'inherit'});
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal || code})`)));
  });
}
