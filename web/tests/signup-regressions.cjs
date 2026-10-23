// Run: node web/tests/signup-regressions.cjs
// Compare the same checks against the pre-fix page: add --baseline.
// The pre-fix blob is shared by local and published histories. A shallow
// checkout must include that history (deepen it if the blob is unavailable).
// Exercises real component handlers without a browser, network, or real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');
const { AuthRetryableFetchError, isAuthRetryableFetchError } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '../..');
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'c5e0dbfc325dfc266438214629027d74c73b7aef'], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'web/app/signup/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const duplicate = { error: { message: 'User already registered' } };
const success = { error: null };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function harness({ signup = () => duplicate, resend = () => success } = {}) {
  const values = [];
  const calls = { signup: [], resend: [] };
  let slot = 0;
  const useState = (initial) => {
    const key = slot++;
    if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial;
    return [values[key], (value) => { values[key] = typeof value === 'function' ? value(values[key]) : value; }];
  };
  const client = { auth: {
    async signUp(args) { calls.signup.push(args); return signup(); },
    async resend(args) { calls.resend.push(args); return resend(); },
  } };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useState, useRef: (value) => useState(() => ({ current: value }))[0] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'Link' },
    '@supabase/supabase-js': { isAuthRetryableFetchError },
    '@/lib/supabase/client': { createClient: () => client },
  };
  const context = { exports: {}, window: { location: { origin: 'https://qa.example.test' } }, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  } };
  vm.runInNewContext(compiled, context, { filename: 'signup/page.tsx' });
  const render = () => { slot = 0; return context.exports.default(); };
  const nodes = (node) => !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = (node) => typeof node === 'string' ? node
    : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
  const input = (placeholder) => nodes(render()).find((node) => node.props?.placeholder === placeholder);
  const button = () => nodes(render()).find((node) => node.type === 'button');
  const heading = () => text(nodes(render()).find((node) => node.type === 'h1'));
  const error = () => text(nodes(render()).find((node) => node.props?.className === 'text-[13px] text-danger'));
  input('Full name').props.onChange({ target: { value: '  Test Person  ' } });
  input('Email').props.onChange({ target: { value: '  TEST@example.test  ' } });
  input('Password, at least 6 characters').props.onChange({ target: { value: 'synthetic-test-password' } });
  return { calls, input, button, heading, error, submit: () => button().props.onClick() };
}

test('a rejected resend keeps the form and inputs available without claiming success', async () => {
  const h = harness({ resend: () => ({ error: { message: 'Email rate limit exceeded' } }) });
  await h.submit();
  assert.equal(h.heading(), 'Create your account');
  assert.match(h.error(), /couldn't resend the verification email/i);
  assert.match(h.error(), /rate limit exceeded/i);
  assert.match(h.error(), /try again shortly/i);
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.input('Full name').props.value, '  Test Person  ');
  assert.equal(h.input('Email').props.value, '  TEST@example.test  ');
  assert.equal(h.input('Password, at least 6 characters').props.value, 'synthetic-test-password');
  assert.equal(h.calls.resend.length, 1);
});

test('an uncertain resend response is caught and releases the form for recovery', async () => {
  const h = harness({ resend: () => { throw new Error('Connection lost'); } });
  await h.submit();
  assert.equal(h.heading(), 'Create your account');
  assert.match(h.error(), /couldn't confirm/i);
  assert.match(h.error(), /check your inbox/i);
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.calls.resend.length, 1);
});

test('a returned retryable network error reports an unconfirmed outcome and releases the form', async () => {
  const h = harness({ resend: () => ({ error: new AuthRetryableFetchError('Connection lost', 0) }) });
  await h.submit();
  assert.equal(h.heading(), 'Create your account');
  assert.match(h.error(), /couldn't confirm/i);
  assert.match(h.error(), /check your inbox/i);
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.calls.resend.length, 1);
});

test('a manual retry clears the previous error and succeeds only after resend succeeds', async () => {
  let attempts = 0;
  const response = deferred();
  const h = harness({ resend: () => ++attempts === 1 ? { error: { message: 'Temporary failure' } } : response.promise });
  await h.submit();
  assert.equal(h.heading(), 'Create your account');
  const retry = h.submit();
  assert.equal(h.error(), '');
  assert.equal(h.button().props.disabled, true);
  response.resolve(success);
  await retry;
  assert.equal(h.heading(), 'Check your email');
  assert.equal(h.calls.signup.length, 2);
  assert.equal(h.calls.resend.length, 2);
});

test('a pending resend does not show success and retains the existing request contract', async () => {
  const response = deferred();
  const h = harness({ resend: () => response.promise });
  const pending = h.submit();
  await new Promise(setImmediate);
  assert.equal(h.heading(), 'Create your account');
  assert.equal(h.button().props.disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.resend)), [{
    type: 'signup', email: 'test@example.test', options: { emailRedirectTo: 'https://qa.example.test/login' },
  }]);
  response.resolve(success);
  await pending;
  assert.equal(h.heading(), 'Check your email');
});

test('a successful new signup still shows the email confirmation step without resend', async () => {
  const h = harness({ signup: () => success });
  await h.submit();
  assert.equal(h.heading(), 'Check your email');
  assert.equal(h.calls.resend.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.signup)), [{
    email: 'test@example.test', password: 'synthetic-test-password',
    options: { emailRedirectTo: 'https://qa.example.test/login', data: { full_name: 'Test Person', account_type: 'personal' } },
  }]);
});

test('an unrelated signup error still shows its message and never sends a resend request', async () => {
  const h = harness({ signup: () => ({ error: { message: 'Error sending confirmation email' } }) });
  await h.submit();
  assert.equal(h.heading(), 'Create your account');
  assert.equal(h.error(), 'Error sending confirmation email');
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.calls.resend.length, 0);
});
