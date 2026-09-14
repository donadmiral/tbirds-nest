const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentIntentStore, paymentOutcome } = require('../src/services/paymentIntent.ts');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
  };
}
const scope = { ownerId: 'sender-a', recipientId: 'recipient-a', conversationId: 'chat-a' };
const params = { ...scope, amount: 12.50, currency: 'USD', listingId: 'listing-a' };
const reference = '0123456789abcdef0123456789abcdef';

test('closing and restarting the client restores the same reference and exact payload', async () => {
  const storage = memoryStorage();
  const first = createPaymentIntentStore(storage, () => reference);
  const saved = await first.prepare(params);
  const reopened = createPaymentIntentStore(storage, () => { throw new Error('must not make a new key'); });
  assert.deepEqual(await reopened.load(scope), saved);
  assert.deepEqual(await reopened.prepare({ ...params, amount: 98, listingId: 'different' }), saved);
});

test('simultaneous taps reuse one persisted identity rather than racing two payments', async () => {
  const storage = memoryStorage();
  let created = 0;
  const store = createPaymentIntentStore(storage, () => { created++; return reference; });
  const [a, b] = await Promise.all([store.prepare(params), store.prepare({ ...params, amount: 20 })]);
  assert.equal(created, 1);
  assert.equal(storage.data.size, 1);
  assert.deepEqual(a, b);
});

test('recovery is isolated by signed-in user, conversation and recipient', async () => {
  const storage = memoryStorage();
  const store = createPaymentIntentStore(storage, () => reference);
  await store.prepare(params);
  assert.equal(await store.load({ ...scope, ownerId: 'sender-b' }), null);
  assert.equal(await store.load({ ...scope, conversationId: 'chat-b' }), null);
  assert.equal(await store.load({ ...scope, recipientId: 'recipient-b' }), null);
});

test('corrupt or mismatched saved state blocks a new identity and is never discarded', async () => {
  const storage = memoryStorage();
  let created = 0;
  const store = createPaymentIntentStore(storage, () => { created++; return reference; });
  await store.prepare(params);
  const key = [...storage.data.keys()][0];
  storage.data.set(key, '{corrupt');
  await assert.rejects(store.prepare(params), /needs review/);
  assert.equal(created, 1);
  assert.equal(storage.data.get(key), '{corrupt');
  storage.data.set(key, JSON.stringify({ version: 1, ...params, ownerId: 'someone-else' }));
  await assert.rejects(store.load(scope), /needs review/);
});

test('a storage failure prevents preparing a payment for submission', async () => {
  const storage = memoryStorage();
  storage.setItem = async () => { throw new Error('disk full'); };
  const store = createPaymentIntentStore(storage, () => reference);
  await assert.rejects(store.prepare(params), /disk full/);
  assert.equal(storage.data.size, 0);
});

test('old cleanup cannot erase a newer identity', async () => {
  const storage = memoryStorage();
  const store = createPaymentIntentStore(storage, () => reference);
  const saved = await store.prepare(params);
  await store.clear({ ...saved, idempotencyKey: 'old-identity-12345678' });
  assert.deepEqual(await store.load(scope), saved);
  await store.clear(saved);
  assert.equal(await store.load(scope), null);
});

test('stored recovery data excludes credentials, email, notes and arbitrary fields', async () => {
  const storage = memoryStorage();
  const store = createPaymentIntentStore(storage, () => reference);
  await store.prepare({ ...params, access_token: 'secret', email: 'private@example.test', note: 'private' });
  const saved = [...storage.data.values()][0];
  assert.equal(saved.includes('secret'), false);
  assert.equal(saved.includes('private'), false);
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), [
    'version', 'ownerId', 'recipientId', 'conversationId', 'idempotencyKey',
    'amount', 'currency', 'listingId', 'createdAt',
  ].sort());
});

test('an enqueue acknowledgement, malformed response or unknown error is never completion', () => {
  for (const body of [null, {}, { success: true }, { success: true, status: 'completed' },
    { success: true, status: 'pending', pending: true, tx_id: 'possible' },
    { success: false, error: 'timeout' }, { found: false }]) {
    const result = paymentOutcome(body);
    assert.equal(result.status, 'pending');
    assert.equal(result.success, false);
    assert.equal(result.pending, true);
  }
});

test('only confirmed transaction references or explicit terminal failure settle the UI', () => {
  const complete = paymentOutcome({ success: true, status: 'completed', tx_id: 'tx-1', currency: 'USD' });
  assert.equal(complete.status, 'completed');
  assert.equal(complete.tx_id, 'tx-1');
  assert.equal(complete.pending, false);
  const failed = paymentOutcome({ success: true, status: 'failed', error: 'Declined' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.success, false);
});
