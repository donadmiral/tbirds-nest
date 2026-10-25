import {PGlite} from '@electric-sql/pglite';
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
