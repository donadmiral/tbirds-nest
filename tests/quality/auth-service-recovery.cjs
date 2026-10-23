const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(options = {}) {
  const requests = [];
  const logs = [];
  const supabase = {
    auth: {
      verifyOtp: async (input) => {
        requests.push(input);
        return { error: options.error || (input.type !== 'recovery' ? new Error('Wrong code purpose') : null) };
      },
      signUp: async () => ({ data: { user: null, session: null }, error: options.error || null }),
      resend: async () => ({ error: null }),
      signInWithPassword: async (input) => { requests.push(input); return { data: {}, error: null }; },
    },
  };
  const modules = {
    './supabase': { supabase },
    './mediaService': {},
    '../utils/isAsuEmail': { isAsuEmail: () => false },
  };
  const context = { exports: {}, console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) }, require: name => {
    if (!(name in modules)) throw new Error('Unexpected dependency: ' + name);
    return modules[name];
  } };
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/authService.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { service: context.exports.authService, requests, logs };
}

test('password reset verifies the recovery code purpose, not a sign-in code', async () => {
  const h = harness();
  await h.service.verifyResetCode('qa@example.test', '12345678');
  assert.equal(h.requests[0].type, 'recovery');
  assert.equal(h.requests[0].email, 'qa@example.test');
  assert.equal(h.requests[0].token, '12345678');
});

test('a rejected recovery code is surfaced without pretending the reset succeeded', async () => {
  const error = new Error('Token has expired');
  const h = harness({ error });
  await assert.rejects(h.service.verifyResetCode('qa@example.test', '12345678'), e => e === error);
});

test('sign-up and resend do not write account identifiers or redirect capabilities to logs', async () => {
  const h = harness();
  await h.service.signUp('private@example.test', 'private-password', 'Private Person', 'platinum-circles-qa://auth/callback?code=private-code');
  await h.service.resendVerification('private@example.test');
  assert.equal(h.logs.length, 0);
});

test('provider sign-up errors are returned without being copied into logs', async () => {
  const error = new Error('Private provider response');
  const h = harness({ error });
  await assert.rejects(h.service.signUp('private@example.test', 'private-password', 'Person'), e => e === error);
  assert.equal(h.logs.length, 0);
});

test('password characters including surrounding spaces are preserved on sign-in', async () => {
  const h = harness();
  await h.service.signIn('qa@example.test', ' spaces matter ');
  assert.equal(h.requests[0].password, ' spaces matter ');
});
