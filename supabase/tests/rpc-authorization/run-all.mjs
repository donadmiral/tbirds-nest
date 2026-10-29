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
for (const {script, env = {}} of [
  {script: './test-production-rollout-chain.mjs'},
  {script: './test-parity-release-chain.mjs'},
  {script: './test-app-quality-hiring-chain.mjs'},
  {script: './test-admin-support-review-chain.mjs'},
  {script: './test-legacy-chat-media-compatibility.mjs'},
  {script: './test-legacy-public-media-snapshots.mjs'},
  {script: './test-memory-book-visual-presentation.mjs'},
  {script: '../content-media-db.test.cjs', env: {PLATINUM_VISUAL_RELEASE: '1'}},
  {script: '../story-mention-reshare-db.test.cjs', env: {PLATINUM_VISUAL_RELEASE: '1'}},
  {script: '../discover-media-projections.test.cjs', env: {PLATINUM_VISUAL_RELEASE: '1'}},
  {script: '../../../tests/quality/chat-call-authorization.cjs'},
  {script: '../../../tests/quality/call-membership-recovery.cjs'},
]) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {stdio: 'inherit', env: {...process.env, ...env}});
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal || code})`)));
  });
}
