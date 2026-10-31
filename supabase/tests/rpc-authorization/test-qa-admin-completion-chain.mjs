// Run the same authorization, replay, moderation, provisioning, and verification
// behavior cases against the exact inspected QA catalog plus its forward delta.
process.env.PLATINUM_QA_ADMIN_UPGRADE = '1';
await import('./test-admin-completion-chain.mjs');
