const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { customActionHarness, response, ACTOR, KEY, TARGET, FACTOR } = require('../helpers/customActionFixture.cjs');
const { compile } = require('./custom-controls-compile.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(ROOT, 'web/node_modules/playwright'));
const output = process.env.PLATINUM_CUSTOM_UI_OUTPUT || '/tmp/platinum-admin-custom-controls';
const artifacts = process.env.PLATINUM_CUSTOM_UI_ARTIFACTS || '/tmp/platinum-admin-custom-controls-evidence';
const records = [], checks = [], pageErrors = [];
const manifest = { version: 1, tracks: [{ id: 'track-1', revision: 'v1', title: 'Synthetic track', artist: 'Synthetic artist', durationSec: 20, assetRef: 'asset-1' }] };
const rpc = (call, name) => call.path === '/rest/v1/rpc/' + name;
async function invoke(input) {
  const recovery = ['requestPasswordReset', 'verifyRecoveryAuthenticator', 'updateRecoveryPassword'].includes(input.name);
  const isMfa = input.name === 'verifyRecoveryAuthenticator';
  const now = Math.floor(Date.now() / 1000);
  const h = customActionHarness({
    ...(recovery ? { claims: { amr: [{ method: 'recovery', timestamp: now }] } } : {}),
    factors: isMfa ? [FACTOR, TARGET].map(id => ({ id, factor_type: 'totp', status: 'verified', friendly_name: 'Synthetic authenticator' })) : [],
    ...(input.scenario === 'untrusted' ? { origin: 'https://untrusted.invalid' } : {}),
    respond: (call, context) => {
      if (rpc(call, 'admin_stage_music_catalogue')) return input.scenario === 'provider-error' ? response({ message: 'Synthetic rejection' }, 400)
        : input.scenario === 'unconfirmed' ? response(null) : response({ id: call.body.p_request, tracks: call.body.p_manifest.tracks.length, added: call.body.p_manifest.tracks.length, replayed: false, catalogEnabled: false });
      if (call.path === '/auth/v1/recover') return response(input.scenario === 'provider-error' ? { msg: 'Synthetic SMTP rejection' } : {}, input.scenario === 'provider-error' ? 503 : 200);
      if (call.path === '/auth/v1/user' && call.method === 'PUT') return response(context.user);
      if (call.path.endsWith('/verify') && input.scenario === 'provider-error') return response({ msg: 'Synthetic wrong code' }, 400);
      if (call.path === '/auth/v1/logout' && input.scenario === 'partial-revoke') return response({ msg: 'Synthetic revocation outage' }, 503);
      return undefined;
    },
  });
  const data = new FormData();
  for (const [name, value] of input.fields) data.append(name, typeof value === 'string' ? value : new File([value.content], value.name, { type: value.type }));
  const row = { action: input.name, scenario: input.scenario, fields: input.fields.map(([key, value]) => [key, /password|confirmation|code/.test(key) ? '[synthetic input omitted]' : value]), value: null, redirect: null, thrown: null, transport: [] };
  try {
    if (recovery && input.name !== 'requestPasswordReset') assert.equal(await h.load('lib/adminRecovery.ts').beginRecovery(h.session), true);
    if (input.name === 'stageMusicCatalogue') row.value = await h.load('app/music/actions.ts').stageMusicCatalogue(data);
    else if (recovery) row.value = await h.load('app/reset-password/actions.ts')[input.name](data);
    else if (input.name === 'reviewCreator') row.value = await h.load('app/payments/creators/actions.ts').reviewCreator(null, data);
    else throw new Error('Unplanned action rejected');
  } catch (error) { if (error.redirect) row.redirect = error.redirect; else row.thrown = error.message; }
  row.transport = h.calls.map(call => ({ method: call.method, path: call.path, ...(rpc(call, 'admin_stage_music_catalogue') ? { request: call.body.p_request, provider: call.body.p_provider, tracks: call.body.p_manifest.tracks.length, actor: call.body.p_actor } : {}) }));
  row.unhandled = h.unhandled.map(call => call.path); records.push(row); return row;
}
async function main() {
  fs.mkdirSync(artifacts, { recursive: true }); await compile(output);
  const server = http.createServer(async (request, result) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (['/fixture.js', '/fixture.css'].includes(url.pathname)) { result.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); result.end(fs.readFileSync(output + url.pathname)); return; }
      if (request.method === 'POST' && url.pathname === '/__custom_action') {
        let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 300000) throw new Error('Bounded fixture action exceeded'); }
        const input = JSON.parse(raw);
        if (input.scenario === 'transport-error') { result.writeHead(503); result.end(); return; }
        const row = await invoke(input); result.writeHead(200, { 'Content-Type': 'application/json' }); result.end(JSON.stringify(row)); return;
      }
      if (url.pathname === '/api/music/report') {
        const h = customActionHarness({ respond: call => rpc(call, 'admin_music_usage_report') ? response({ metric: 'server_operations_not_plays_or_royalties', rows: [] }) : undefined });
        const value = await h.load('app/api/music/report/route.ts').GET(new Request('https://admin-action.example.invalid' + url.pathname + url.search));
        records.push({ action: 'GET music report', query: Object.fromEntries(url.searchParams), status: value.status, transport: h.calls.map(call => ({ method: call.method, path: call.path })) });
        result.writeHead(value.status, Object.fromEntries(value.headers)); result.end(Buffer.from(await value.arrayBuffer())); return;
      }
      result.writeHead(200, { 'Content-Type': 'text/html' });
      result.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Actual admin control audit</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } catch (error) { result.writeHead(500, { 'Content-Type': 'application/json' }); result.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => pageErrors.push(error.message));
    async function open(params) { await page.goto(origin + '/?' + new URLSearchParams(params)); await page.getByRole('heading', { name: 'Actual admin controls · synthetic actions' }).waitFor(); }
    async function check(name, run) {
      const before = records.length;
      try { await run(); checks.push({ name, status: 'passed', actionRecords: records.slice(before) }); }
      catch (error) { const file = 'failure-' + (checks.length + 1) + '.png'; await page.screenshot({ path: path.join(artifacts, file), fullPage: true }).catch(() => {}); checks.push({ name, status: 'failed', error: error.message, screenshot: file, actionRecords: records.slice(before) }); }
      console.log(checks.at(-1).status.toUpperCase(), checks.at(-1).name);
    }
    const fillManifest = async () => {
      await page.getByRole('combobox', { name: /^Provider\b/ }).selectOption('awaiting');
      await page.getByLabel('JSON manifest', { exact: true }).setInputFiles({ name: 'manifest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) });
    };
    await check('Operations absent or unknown contract shows Retry and no staging controls', async () => {
      for (const version of ['missing', '99']) {
        await open({ area: 'operations', version }); const retry = page.getByRole('link', { name: 'Retry operations status' }); await retry.waitFor();
        assert.equal(await page.getByRole('button').count(), 0); assert.equal(await retry.getAttribute('href'), '/music');
        await retry.click(); await page.waitForURL(origin + '/music');
      }
    });
    await check('Operations cannot stage without an eligible provider', async () => {
      await open({ area: 'operations', providers: 'none' }); assert.equal(await page.getByRole('combobox', { name: /^Provider\b/ }).isDisabled(), true); assert.equal(await page.getByLabel('JSON manifest', { exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: 'Stage catalogue', exact: true }).isDisabled(), true);
    });
    await check('Operations eligible options, manifest disclosure and required-file validation use actual controls', async () => {
      await open({ area: 'operations' }); assert.deepEqual(await page.getByRole('combobox', { name: /^Provider\b/ }).locator('option').allTextContents(), ['Choose a provider', 'Awaiting provider', 'Licensed provider']);
      await page.getByText('Manifest format', { exact: true }).click(); await page.locator('pre').waitFor();
      assert.match(await page.locator('pre').innerText(), /provider-track-123/);
      await page.getByRole('combobox', { name: /^Provider\b/ }).selectOption('awaiting'); await page.getByRole('button', { name: 'Stage catalogue', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.events.length), 0);
    });
    await check('Operations file submission reaches the actual action with its UUID and keeps catalogue playback off', async () => {
      await fillManifest(); const id = await page.locator('input[name="requestId"]').inputValue();
      await page.getByRole('button', { name: 'Stage catalogue', exact: true }).click(); await page.waitForFunction(() => window.__CUSTOM_STATE__.events.length === 1);
      const record = records.at(-1); assert.equal(record.redirect, '/music?result=staged'); assert.equal(record.transport.find(call => call.path.endsWith('admin_stage_music_catalogue')).request, id); assert.equal(record.transport.find(call => call.path.endsWith('admin_stage_music_catalogue')).actor, ACTOR);
      assert.match(await page.locator('main').innerText(), /Playback: Disabled/);
    });
    for (const scenario of ['provider-error', 'unconfirmed']) await check(`Operations ${scenario} never claims a staged catalogue`, async () => {
      await open({ area: 'operations', scenario }); await fillManifest(); await page.getByRole('button', { name: 'Stage catalogue', exact: true }).click();
      await page.waitForFunction(() => window.__CUSTOM_STATE__.events.length === 1); assert.equal(records.at(-1).redirect, '/music?result=catalogue-failed');
    });
    await check('Operations date form downloads the actual bounded CSV endpoint', async () => {
      await open({ area: 'operations' }); await page.getByLabel('Start date (UTC)', { exact: true }).fill('2026-10-01'); await page.getByLabel('End date, exclusive (UTC)', { exact: true }).fill('2026-10-31');
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download operations CSV', exact: true }).click(); const value = await download;
      assert.match(value.suggestedFilename(), /\.csv$/); assert.equal(await value.failure(), null); assert.equal(records.at(-1).status, 200); assert.deepEqual(records.at(-1).query, { start: '2026-10-01', end: '2026-10-31' });
    });

    await check('Recovery request rejects invalid email through native form constraints', async () => {
      await open({ area: 'recovery', mode: 'request' }); await page.getByLabel('Staff email').fill('bad email'); await page.getByRole('button', { name: 'Send reset link' }).click(); assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.events.length), 0);
    });
    await check('Recovery request success and SMTP error present identical non-enumerating feedback', async () => {
      const messages = [];
      for (const scenario of ['ok', 'provider-error']) {
        await open({ area: 'recovery', mode: 'request', scenario }); await page.getByLabel('Staff email').fill('synthetic-staff@example.invalid'); await page.getByRole('button', { name: 'Send reset link' }).click();
        await page.getByRole('status').waitFor(); messages.push(await page.getByRole('status').innerText()); const back = page.getByRole('link', { name: 'Back to sign in' });
        assert.equal(await back.getAttribute('href'), '/'); await back.click(); await page.waitForURL(origin + '/');
      }
      assert.equal(messages[0], messages[1]); assert.match(messages[0], /If an account uses that email/);
    });
    await check('Recovery thrown transport preserves input, releases busy state and permits an explicit retry', async () => {
      await open({ area: 'recovery', mode: 'request', scenario: 'transport-error' }); await page.getByLabel('Staff email').fill('synthetic-staff@example.invalid'); await page.getByRole('button', { name: 'Send reset link' }).click();
      await page.getByRole('alert').waitFor(); assert.equal(await page.getByLabel('Staff email').inputValue(), 'synthetic-staff@example.invalid'); assert.equal(await page.getByRole('button', { name: 'Send reset link' }).isDisabled(), false);
      await page.evaluate(() => { window.__CUSTOM_STATE__.scenario = 'ok'; }); await page.getByRole('button', { name: 'Send reset link' }).click(); await page.getByRole('status').waitFor();
    });
    await check('Recovery pending guard blocks duplicate submissions and disables every form field', async () => {
      await open({ area: 'recovery', mode: 'request' }); let release, arrived;
      const pending = new Promise(resolve => { release = resolve; }), intercepted = new Promise(resolve => { arrived = resolve; });
      const hold = async route => { arrived(); await pending; await route.continue(); };
      await page.route('**/__custom_action', hold); await page.getByLabel('Staff email').fill('synthetic-staff@example.invalid');
      await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); }); await intercepted;
      assert.equal(await page.getByLabel('Staff email').isDisabled(), true); assert.equal(await page.getByRole('button', { name: 'Please wait…' }).isDisabled(), true);
      release(); await page.getByRole('status').waitFor(); await page.unroute('**/__custom_action', hold); assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.events.length), 1);
    });
    await check('Recovery MFA validates six digits, sends selected existing factor, then refreshes on verified receipt', async () => {
      await open({ area: 'recovery', mode: 'mfa' }); await page.getByLabel('Existing authenticator').selectOption(TARGET); await page.getByLabel('Six-digit code').fill('123'); await page.getByRole('button', { name: 'Verify authenticator' }).click(); assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.events.length), 0);
      await page.getByLabel('Six-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify authenticator' }).click(); await page.waitForFunction(() => window.__CUSTOM_STATE__.refreshes === 1);
      assert.equal(records.at(-1).value.success, true); assert.ok(records.at(-1).transport.some(call => call.path === '/auth/v1/factors/' + TARGET + '/verify')); assert.equal(await page.getByLabel('Six-digit code').inputValue(), '');
    });
    await check('Recovery rejected MFA keeps its input and displays an actionable error', async () => {
      await open({ area: 'recovery', mode: 'mfa', scenario: 'provider-error' }); await page.getByLabel('Six-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify authenticator' }).click(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /not accepted/); assert.equal(await page.getByLabel('Six-digit code').inputValue(), '123456'); assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.refreshes), 0);
    });
    await check('Recovery password mismatch keeps both values; confirmed retry clears the form', async () => {
      await open({ area: 'recovery', mode: 'password' }); await page.getByLabel('New password', { exact: true }).fill('synthetic new passphrase'); await page.getByLabel('Confirm new password').fill('synthetic other passphrase'); await page.getByRole('button', { name: 'Update password' }).click(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /do not match/);
      assert.equal(await page.getByLabel('New password', { exact: true }).inputValue(), 'synthetic new passphrase'); await page.getByLabel('Confirm new password').fill('synthetic new passphrase'); await page.getByRole('button', { name: 'Update password' }).click(); await page.getByRole('status').waitFor(); assert.match(await page.getByRole('status').innerText(), /Password updated/);
    });
    await check('Recovery partial global sign-out displays its limitation rather than full completion', async () => {
      await open({ area: 'recovery', mode: 'password', scenario: 'partial-revoke' }); await page.getByLabel('New password', { exact: true }).fill('synthetic new passphrase'); await page.getByLabel('Confirm new password').fill('synthetic new passphrase'); await page.getByRole('button', { name: 'Update password' }).click(); await page.getByRole('status').waitFor(); assert.match(await page.getByRole('status').innerText(), /sign-out could not be confirmed/);
    });

    await check('Dormant creator ReviewForm sends exact user/version/key but actual finance gate remains disabled', async () => {
      await open({ area: 'review', status: 'applied' }); assert.deepEqual(await page.getByLabel('Decision').locator('option').allTextContents(), ['Approve', 'Decline']);
      await page.getByLabel('Decision').selectOption('rejected'); await page.getByLabel('Reason shown to creator').fill('Synthetic complete reason'); await page.getByRole('button', { name: 'Save review' }).click(); await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(), /unavailable in this release/);
      const fields = Object.fromEntries(records.at(-1).fields); assert.equal(fields.user_id, TARGET); assert.equal(fields.updated_at, '2026-10-31T12:00:00.123456Z'); assert.equal(fields.command_key, KEY); assert.equal(fields.status, 'rejected'); assert.equal(records.at(-1).transport.some(call => call.path.includes('creator_finance_review')), false);
    });
    await check('Dormant creator status transitions expose only the appropriate decisions', async () => {
      for (const [status, labels] of [['approved', ['Pause monetization']], ['suspended', ['Approve']]]) { await open({ area: 'review', status }); assert.deepEqual(await page.getByLabel('Decision').locator('option').allTextContents(), labels); }
      await open({ area: 'review', status: 'rejected' }); assert.equal(await page.locator('form').count(), 0);
    });
    await check('Dormant creator form requires reason and prevents editing during a held submission', async () => {
      await open({ area: 'review', status: 'applied' }); await page.getByRole('button', { name: 'Save review' }).click(); assert.equal(await page.evaluate(() => window.__CUSTOM_STATE__.events.length), 0);
      let release, arrived; const wait = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { arrived = resolve; });
      const hold = async route => { arrived(); await wait; await route.continue(); }; await page.route('**/__custom_action', hold);
      await page.getByLabel('Reason shown to creator').fill('Required reason'); await page.getByRole('button', { name: 'Save review' }).click(); await start;
      assert.equal(await page.getByLabel('Decision').isDisabled(), true); assert.equal(await page.getByLabel('Reason shown to creator').isDisabled(), true); assert.equal(await page.getByRole('button', { name: 'Saving…' }).isDisabled(), true);
      release(); await page.getByRole('alert').waitFor(); await page.unroute('**/__custom_action', hold);
    });
    await page.setViewportSize({ width: 360, height: 844 });
    for (const area of ['operations', 'recovery', 'review']) await check(`${area} controls fit a 360px phone without horizontal page overflow`, async () => {
      await open({ area }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const controls = await page.locator('input:not([type="hidden"]),select,button').all();
      for (const control of controls) { const box = await control.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 361 && box.height >= 40); }
      await page.screenshot({ path: path.join(artifacts, area + '-360.png'), fullPage: true });
    });
    const receipt = { checkedAt: new Date().toISOString(), runtime: await browser.version(), counts: { checks: checks.length, passed: checks.filter(row => row.status === 'passed').length, failed: checks.filter(row => row.status === 'failed').length }, checks, pageErrors,
      limits: ['Actual three React components and compiled admin CSS; synthetic Next navigation/cookie/cache/provider adapters.', 'Actual server exports execute through installed admin SDK on loopback only; no real account, password, provider, email, payment or licensing write.', 'Operations server-component UUID generation uses WebCrypto in this isolated client fixture; server action redirects are observed and not claimed as Next RSC navigation acceptance.', 'Creator ReviewForm is deliberately mounted in isolation to verify dormant control behavior. Current production parent does not render it while finance operations are disabled.', 'A minimum 40px height is measured; this is control geometry evidence, not a universal 44px target claim.', 'Existing recovery and erasure action suites supply additional source-matched coverage separately.'] };
    fs.writeFileSync(path.join(artifacts, 'custom-controls-browser.json'), JSON.stringify(receipt, null, 2) + '\n');
    if (receipt.counts.failed || pageErrors.length) process.exitCode = 1;
    console.log(JSON.stringify(receipt.counts));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
