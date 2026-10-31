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
  {script: './test-admin-completion-chain.mjs'},
  {script: './test-qa-admin-completion-chain.mjs'},
  {script: './test-account-storage-erasure-chain.mjs'},
  {script: './test-private-media-cutover-chain.mjs'},
  {script: './test-bounded-media-delivery-chain.mjs'},
  {script: './test-bounded-media-delivery-chain.mjs',env:{PLATINUM_QA_MEDIA_UPGRADE:'1'}},
  {script: './test-database-hardening-chain.mjs'},
  {script: './test-database-hardening-chain.mjs',env:{PLATINUM_QA_DATABASE_HARDENING:'1'}},
  {script: './test-erasure-operator-chain.mjs'},
  {script: './test-erasure-operator-chain.mjs',env:{PLATINUM_QA_ERASURE_OPERATOR:'1'}},
  {script: './test-staff-social-shells-chain.mjs'},
  {script: './test-staff-social-shells-chain.mjs',env:{PLATINUM_QA_STAFF_SHELLS:'1'}},
  {script: './test-studio-workflow-chain.mjs'},
  {script: './test-studio-workflow-chain.mjs',env:{PLATINUM_QA_STUDIO_WORKFLOWS:'1'}},
  {script: './test-business-auth-chain.mjs'},
  {script: './test-business-auth-chain.mjs',env:{PLATINUM_QA_BUSINESS_AUTH:'1'}},
  {script: './test-notification-preferences.mjs'},
  {script: './test-notification-preferences.mjs',env:{NOTIFICATION_BUSINESS_FIXTURE:'1'}},
  {script: './test-offer-response-serialization.mjs'},
  {script: './test-original-music-library.mjs'},
  {script: './test-original-music-library.mjs',env:{MUSIC_FIXTURE_PREEXISTING:'1'}},
  {script: './test-original-music-library.mjs',env:{MUSIC_PIPELINE_FIXTURE:'1'}},
  {script: './test-music-operations.mjs'},
  {script: './test-licensed-catalogue.mjs'},
  {script: './test-business-music-integration.mjs'},
  {script: './test-business-music-integration.mjs',env:{PLATINUM_QA_BUSINESS_AUTH:'1'}},
  {script: './test-link-preview-chain.mjs',env:{PLATINUM_CURRENT_PRODUCTION_LINK_PREVIEW:'1'}},
  {script: './test-link-preview-chain.mjs'},
  {script: './test-link-preview-chain.mjs',env:{PLATINUM_QA_LINK_PREVIEW:'1'}},
  {script: '../../../tests/link-preview.test.cjs'},
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
