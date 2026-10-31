const test = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness } = require('./helpers/account-component-harness.cjs');
async function screen(options) { const h = accountHarness(options); h.mount(h.load('app/settings/two-factor/page.tsx').default); await h.flush(); return h; }

test('authenticator setup renders the provider SVG data URL and confirms challenge before enabling', async () => {
  const h = await screen(); await h.button('Turn on').props.onClick(); h.render();
  const qr = h.nodes.find(n => n.type === 'img'); assert.match(qr.props.src, /^data:image\/svg\+xml;/); assert.equal(qr.props.unoptimized, true); assert.equal(qr.props.dangerouslySetInnerHTML, undefined);
  assert.equal(h.button('Confirm and turn on').props.disabled, true); h.input('Authenticator code', '12a3456');
  await h.button('Confirm and turn on').props.onClick(); await h.flush();
  assert.match(h.text, /Two-factor authentication is on/); assert.ok(h.button('Remove authenticator'));
  const challenge = h.calls.find(c => c.name === 'challenge'), verify = h.calls.find(c => c.name === 'verify');
  assert.equal(challenge.args.factorId, verify.args.factorId); assert.equal(verify.args.code, '123456'); assert.match(verify.args.challengeId, /^challenge-/); h.dispose();
});

test('factor read failure stays explicit and cannot be presented as two-factor protection being off', async () => {
  const h = accountHarness(); h.override('listFactors', async () => ({ data: null, error: { message: 'Provider unavailable' } }));
  h.mount(h.load('app/settings/two-factor/page.tsx').default); await h.flush();
  assert.equal(h.button('Turn on'), undefined); const failure = h.nodes.find(n => n.type === 'ErrorState'); assert.match(failure.props.title, /Provider unavailable/);
  h.override('listFactors', null); failure.props.onRetry(); await h.flush(); assert.ok(h.button('Turn on')); h.dispose();
});

test('cancel setup removes only its own unfinished factor and failed removal remains retryable', async () => {
  const h = await screen({ factors: [{ id: 'external', status: 'unverified', friendly_name: 'Other application' }, { id: 'interrupted', status: 'unverified', friendly_name: 'Platinum Circles' }] });
  await h.button('Turn on').props.onClick(); h.render(); assert.deepEqual(h.calls.filter(c => c.name === 'unenroll').map(c => c.args.factorId), ['interrupted']);
  h.override('unenroll', async () => ({ error: { message: 'Interrupted removal' } })); await h.button('Cancel').props.onClick(); h.render();
  assert.match(h.text, /Interrupted removal/); assert.ok(h.button('Confirm and turn on'));
  h.override('unenroll', null); await h.button('Cancel').props.onClick(); await h.flush(); assert.match(h.text, /Setup cancelled/); assert.ok(h.button('Turn on')); h.dispose();
});

test('removing a verified authenticator requires successful challenge and code verification', async () => {
  const h = await screen({ factors: [{ id: 'existing', status: 'verified' }] });
  h.override('verify', async () => ({ error: { message: 'Invalid code' } })); h.button('Remove authenticator').props.onClick(); await h.flush();
  assert.match(h.text, /Invalid code/); assert.equal(h.calls.some(c => c.name === 'unenroll'), false); assert.ok(h.button('Remove authenticator'));
  h.override('verify', null); h.button('Remove authenticator').props.onClick(); await h.flush(); assert.match(h.text, /Authenticator removed/); assert.ok(h.button('Turn on')); h.dispose();
});

test('account changes discard a pending enrollment response and never reveal its secret to the new viewer', async () => {
  const h = await screen(); let complete;
  h.override('enroll', () => new Promise(resolve => { complete = resolve; })); const pending = h.button('Turn on').props.onClick(); await h.flush();
  h.auth('account-b'); await h.flush(); complete({ data: { id: 'old-factor', totp: { secret: 'ACCOUNT-A-SECRET', qr_code: 'data:image/svg+xml,old' } }, error: null }); await pending; await h.flush();
  assert.doesNotMatch(h.text, /ACCOUNT-A-SECRET/); assert.equal(h.nodes.some(n => n.props?.src === 'data:image/svg+xml,old'), false); assert.ok(h.button('Turn on')); h.dispose();
});
