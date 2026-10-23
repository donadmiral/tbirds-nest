const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { createPaymentIntentStore, paymentOutcome } = require('../src/services/paymentIntent.ts');
const { providerIssue } = require('../shared/payments/providerStatus.ts');

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
    Uint8Array, crypto: webcrypto, createPaymentIntentStore, paymentOutcome, providerIssue,
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
  await assert.rejects(harness.paymentsService.getLinkStatus(intent.ownerId), /account changed/);
  await assert.rejects(harness.paymentsService.getBalance(intent.ownerId), /account changed/);
  await assert.rejects(harness.paymentsService.peerLinked('receiver-a', intent.ownerId), /account changed/);
  await assert.rejects(harness.paymentsService.unlink(intent.ownerId), /account changed/);
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

test('connection status accepts only an explicit successful boolean answer', async () => {
  for (const body of [{}, { success: false }, { success: true }, { success: true, linked: 'false' }]) {
    await assert.rejects(serviceHarness({ body }).paymentsService.getLinkStatus('sender-a'), { kind: 'invalid-response' });
  }
  for (const linked of [true, false]) {
    const result = await serviceHarness({ body: { success: true, linked } }).paymentsService.getLinkStatus('sender-a');
    assert.equal(result.linked, linked);
  }
});

test('recipient status distinguishes a confirmed disconnection from an outage', async () => {
  assert.equal(await serviceHarness({ body: { linked: false } }).paymentsService.peerLinked('receiver-a', 'sender-a'), false);
  await assert.rejects(serviceHarness({ status: 503, body: { error: 'Unavailable' } }).paymentsService.peerLinked('receiver-a', 'sender-a'), { status: 503 });
  for (const body of [{}, { linked: 'false' }, { success: false, linked: false }]) {
    await assert.rejects(serviceHarness({ body }).paymentsService.peerLinked('receiver-a', 'sender-a'), { kind: 'invalid-response' });
  }
});

test('unlink requires confirmed success and preserves the authenticated account boundary', async () => {
  for (const body of [{}, { success: false }, { success: 'true' }]) {
    await assert.rejects(serviceHarness({ body }).paymentsService.unlink('sender-a'), { kind: 'invalid-response' });
  }
  const confirmed = serviceHarness({ body: { success: true } });
  await confirmed.paymentsService.unlink('sender-a');
  assert.equal(confirmed.requests[0].init.method, 'POST');
  assert.equal(confirmed.requests[0].url.endsWith('?action=unlink'), true);
  const emptyOwner = serviceHarness({ body: { success: true } });
  await assert.rejects(emptyOwner.paymentsService.unlink(''), { kind: 'auth' });
  assert.equal(emptyOwner.requests.length, 0);
});

test('wallet reads never invent zero balance or a disconnected account from incomplete data', async () => {
  for (const body of [{}, { success: true }, { success: true, linked: true }, { success: true, linked: true, currency: 'ZWG', balance: 10, available: 10 }, { success: true, linked: true, currency: 'USD', balance: 10, available: null }]) {
    await assert.rejects(serviceHarness({ body }).paymentsService.getBalance('sender-a'), { kind: 'invalid-response' });
  }
  assert.equal((await serviceHarness({ body: { success: true, linked: false } }).paymentsService.getBalance('sender-a')).linked, false);
  const confirmed = serviceHarness({ body: { success: true, linked: true, currency: 'USD', balance: 10, available: 8 } });
  assert.equal((await confirmed.paymentsService.getBalance('sender-a')).available, 8);
});

test('provider permission errors identify unavailable linking without blaming the approval code', async () => {
  const h = serviceHarness({status:403, body:{success:false,error:'KEY_PERMISSION_DENIED',capability:'links'}});
  await assert.rejects(h.paymentsService.linkAccount('ABCDEF12','sender-a'), error => {
    assert.equal(error.code, 'KEY_PERMISSION_DENIED');
    assert.equal(error.kind, 'configuration');
    assert.match(error.message, /Connecting or disconnecting IntoBank is temporarily unavailable/);
    assert.doesNotMatch(error.message, /KEY_PERMISSION|invalid code|expired/i);
    return true;
  });
  assert.equal(h.requests.length, 1);
});

test('bank approval failures remain exceptions, never completed or safe-to-repeat payments', async () => {
  for (const code of ['BANK_PAYMENT_REQUIRED','LIVE_BANK_INTEGRATION_NOT_APPROVED']) {
    const h=serviceHarness({status:409,body:{success:false,error:code}});
    await assert.rejects(h.paymentsService.sendMoney(intent), error => {
      assert.equal(error.code,code); assert.equal(error.kind,'configuration');
      assert.match(error.message,/approved|enabled/); return true;
    });
    assert.equal(h.requests.length,1);
  }
});

test('a missing environment configuration gives setup guidance without exposing the server error',async()=>{
  const h=serviceHarness({status:503,body:{success:false,code:'CRISP_NOT_CONFIGURED',error:'private-server-detail'}});
  await assert.rejects(h.paymentsService.getLinkStatus('sender-a'),error=>{
    assert.equal(error.kind,'configuration');assert.equal(error.code,'CRISP_NOT_CONFIGURED');
    assert.match(error.message,/not set up for this app environment/);assert.doesNotMatch(error.message,/private-server-detail/);return true;
  });
});
