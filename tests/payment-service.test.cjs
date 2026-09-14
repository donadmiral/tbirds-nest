const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { createPaymentIntentStore, paymentOutcome } = require('../src/services/paymentIntent.ts');

// Execute the actual service with mocked native/auth/transport dependencies.
// No server, hosted project, token or real payment is used by this suite.
function serviceHarness({ body = {}, status = 200, userId = 'sender-a', native = true } = {}) {
  const requests = [];
  const storage = new Map();
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src/services/paymentsService.ts'), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const context = {
    module: { exports: {} }, console, AbortController, setTimeout, clearTimeout,
    Uint8Array, crypto: webcrypto, createPaymentIntentStore, paymentOutcome,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' } },
    require(name) {
      assert.equal(name, 'expo-local-authentication');
      if (!native) throw new Error('Native module not installed');
      return {
        hasHardwareAsync: async () => true,
        isEnrolledAsync: async () => true,
        authenticateAsync: async () => ({ success: true }),
      };
    },
    AsyncStorage: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => storage.set(key, value),
      removeItem: async key => storage.delete(key),
    },
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: userId }, access_token: 'synthetic-session' } } }) } },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    },
  };
  vm.runInNewContext(source + '\nmodule.exports = { paymentsService, BridgeError };', context);
  return { ...context.module.exports, requests };
}
const intent = {
  version: 1, ownerId: 'sender-a', recipientId: 'receiver-a', conversationId: 'chat-a',
  amount: 12.50, currency: 'USD', listingId: null,
  idempotencyKey: '0123456789abcdef0123456789abcdef', createdAt: '2026-09-10T00:00:00Z',
};

test('status lookup uses GET and the canonical local Edge Functions URL', async () => {
  const harness = serviceHarness({ body: { success: true, status: 'pending', pending: true } });
  const result = await harness.paymentsService.getPaymentStatus(intent);
  assert.equal(result.status, 'pending');
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, 'http://127.0.0.1:54321/functions/v1/crisp-bridge?action=payment-status&idempotency_key=' + intent.idempotencyKey);
  assert.equal(harness.requests[0].init.method ?? 'GET', 'GET');
  assert.equal(harness.requests[0].init.body, undefined);
});

test('only the explicit missing-record code permits a same-reference retry', async () => {
  const missing = serviceHarness({ status: 404, body: { success: false, found: false, code: 'PAYMENT_NOT_FOUND' } });
  assert.equal((await missing.paymentsService.getPaymentStatus(intent)).status, 'not_found');
  const routeMissing = serviceHarness({ status: 404, body: { error: 'Route unavailable' } });
  await assert.rejects(routeMissing.paymentsService.getPaymentStatus(intent), { status: 404 });
});

test('switching the signed-in account prevents payment and status requests', async () => {
  const harness = serviceHarness({ userId: 'different-sender' });
  await assert.rejects(harness.paymentsService.getPaymentStatus(intent), /account changed/);
  await assert.rejects(harness.paymentsService.sendMoney(intent), /account changed/);
  await assert.rejects(harness.paymentsService.linkAccount('ABCDEF12', intent.ownerId), /account changed/);
  assert.equal(harness.requests.length, 0);
});

test('a missing native confirmation module never silently bypasses authorisation', async () => {
  const harness = serviceHarness({ native: false });
  const result = await harness.paymentsService.sendMoney(intent);
  assert.equal(result.status, 'not_submitted');
  assert.equal(harness.requests.length, 0);
});

test('a pending payment acknowledgement remains pending and preserves the original request', async () => {
  const harness = serviceHarness({ status: 202, body: { success: true, status: 'pending', pending: true, payment_id: 'payment-a' } });
  const result = await harness.paymentsService.sendMoney(intent);
  assert.equal(result.status, 'pending');
  assert.equal(result.success, false);
  const sent = JSON.parse(harness.requests[0].init.body);
  assert.equal(sent.idempotency_key, intent.idempotencyKey);
  assert.equal(sent.amount, intent.amount);
  assert.equal(sent.recipient_id, intent.recipientId);
  assert.equal(sent.ownerId, undefined);
});

test('linking redeems an approval code and rejects an unconfirmed response', async () => {
  const harness = serviceHarness({ body: { success: true } });
  await harness.paymentsService.linkAccount(' abcdef12 ', 'sender-a');
  assert.equal(harness.requests[0].url.endsWith('?action=link'), true);
  assert.deepEqual(JSON.parse(harness.requests[0].init.body), { code: 'ABCDEF12' });
  assert.equal(harness.paymentsService.sendOtp, undefined);
  assert.equal(harness.paymentsService.linkWithSignIn, undefined);
  const rejected = serviceHarness({ body: { success: false, error: 'Expired code' } });
  await assert.rejects(rejected.paymentsService.linkAccount('ABCDEF12', 'sender-a'), /Expired code/);
});
