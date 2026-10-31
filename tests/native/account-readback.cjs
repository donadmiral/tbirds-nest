const { OWNER } = require('./backend-fixture.cjs');

/** Runs only after the actual app navigation reaches the disposable capture route.
 * Reload the production account store from its real SecureStore adapter; never
 * report account IDs, storage keys, session tokens, values or error details. */
async function readSavedAccount({ authStore, accountsStore }) {
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
    || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
    throw new Error('Saved-account acceptance requires the isolated native QA fixture.');
  }
  const session = authStore.getState().session;
  if (session?.user?.id !== OWNER) throw new Error('Saved-account acceptance requires the synthetic owner.');
  await accountsStore.getState().init();
  const { accounts, currentId } = accountsStore.getState();
  const current = authStore.getState().session;
  const passed = accounts.length === 1 && accounts[0].id === session.user.id
    && accounts[0].refresh_token === session.refresh_token && currentId === session.user.id
    && current?.user?.id === session.user.id && current.refresh_token === session.refresh_token;
  return { passed, reloaded: true, accountCount: accounts.length };
}

module.exports = { readSavedAccount };
