/* Real Next App Router/proxy/AppShell; isolated synthetic Auth/database, no hosted traffic. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '../../..');
const artifacts = process.env.PLATINUM_SHELL_ARTIFACTS || '/tmp/platinum-shell-next-qa';
const owner = '11111111-1111-4111-8111-111111111111';
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'shell-fixture@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
async function availablePort() { const server = http.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; }
async function until(check, timeout = 90000) { const started = Date.now(); while (!await check()) { if (Date.now() - started > timeout) throw Error('Timed out waiting for fixture state'); await delay(100); } }
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const port = await availablePort(), origin = 'http://127.0.0.1:' + port;
  let held = [], hold = false, next, browser, backendOrigin, nextLog = '';
  const requests = [], errors = [], checks = [];
  const profile = { id: owner, full_name: 'Shell Fixture', username: 'shellfixture', account_type: 'personal', avatar_url: null, is_verified: false, verified_tier: null, location: 'Cape Town', muted_words: [], links: [], account_labels: {}, bio: '', banner_url: null, created_at: '2026-01-01T00:00:00Z' };
  const backend = http.createServer((req, res) => {
    const url = new URL(req.url, backendOrigin || 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname, select: url.searchParams.get('select'), at: Date.now() });
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range'); res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.end(); return; }
    const finish = data => { if (!res.destroyed) res.end(JSON.stringify(data)); };
    if (url.pathname === '/auth/v1/user') { finish(user); return; }
    if (url.pathname.startsWith('/auth/v1/')) { finish({}); return; }
    if (url.pathname === '/rest/v1/profiles') {
      const one = String(req.headers.accept || '').includes('vnd.pgrst.object');
      const data = one ? profile : [profile];
      if (hold && url.searchParams.get('select') === 'full_name,username,account_type,avatar_url,is_verified,verified_tier') { held.push(() => finish(data)); return; }
      finish(data); return;
    }
    if (req.method === 'HEAD') { res.setHeader('Content-Range', '0-0/0'); res.end(); return; }
    if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) { finish([]); return; }
    res.statusCode = 404; finish({ error: 'Synthetic fixture has no such endpoint' });
  });
  backend.on('upgrade', (_request, socket) => socket.destroy());
  const backendPort = await listen(backend); backendOrigin = 'http://127.0.0.1:' + backendPort;
  // Deliberately unusable as an image: the passive fallback must omit it.
  profile.avatar_url = backendOrigin + '/storage/v1/object/sign/avatars/expired.png?token=expired-fixture';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: owner, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), session_id: 'shell-fixture-session-one' }) + '.synthetic-signature';
  const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user };
  const release = () => { hold = false; const work = held; held = []; work.forEach(finish => finish()); };
  try {
    next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: path.join(root, 'web'), env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: backendOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key', NEXT_PUBLIC_SITE_URL: origin }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    next.stdout.on('data', value => { nextLog += value; }); next.stderr.on('data', value => { nextLog += value; });
    await until(() => nextLog.includes('Ready in') || next.exitCode !== null);
    assert.equal(next.exitCode, null, nextLog.slice(-3000));
    browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || '/tmp/platinum-gate-chrome/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + encode(session), url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/jobs', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('heading', { name: 'No matching roles', exact: true }).waitFor({ timeout: 120000 });
    await page.getByRole('link', { name: 'Profile', exact: true }).first().waitFor();
    await delay(500);
    hold = true;
    await page.evaluate(() => {
      window.shellProbe = { started: performance.now(), frames: [], active: true };
      const frame = () => { const p = window.shellProbe; if (!p.active) return; const root = document.querySelector('[data-navigation-loading]'); const chrome = [...document.querySelectorAll('[data-app-chrome]')].filter(node => node.getClientRects().length && node.getBoundingClientRect().width > 0); p.frames.push({ at: performance.now() - p.started, fallback: root?.getAttribute('data-navigation-loading') || null, chrome: chrome.length, path: location.pathname }); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    });
    await page.getByRole('link', { name: 'Profile', exact: true }).first().click();
    await until(() => held.length > 0);
    const pending = page.locator('[data-navigation-loading="verified"]'); await pending.waitFor({ timeout: 30000 });
    assert.equal(await pending.locator('input,textarea,button').count(), 0);
    assert.equal(await pending.locator('img[src*="token="]').count(), 0);
    await pending.getByRole('link', { name: 'Jobs', exact: true }).first().waitFor();
    const counts = () => requests.filter(row => row.path === '/rest/v1/notifications').length;
    await delay(300); const unreadBefore = counts(); await delay(350); assert.equal(counts(), unreadBefore);
    const frames = await page.evaluate(() => { window.shellProbe.active = false; return window.shellProbe.frames; });
    const loadingFrames = frames.filter(frame => frame.fallback === 'verified');
    assert.ok(loadingFrames.length >= 5); assert.ok(loadingFrames.every(frame => frame.chrome >= 2));
    assert.ok(frames.every(frame => frame.chrome >= 2), 'Navigation remains visible in every sampled frame, including the handoff before the verified fallback.');
    await page.screenshot({ path: path.join(artifacts, 'held-profile-expanded.png') });
    checks.push({ name: 'cold Jobs to own Profile retains visible passive navigation while actual server AppShell profile response is held', passed: true, heldResponses: held.length, observedFrames: loadingFrames.length, totalTransitionFrames: frames.length, framesWithoutChrome: frames.filter(frame => frame.chrome < 2).length, extraUnreadRequests: counts() - unreadBefore, editableInputs: 0, signedAvatarLocators: 0 });
    await pending.getByRole('link', { name: 'Jobs', exact: true }).first().click();
    await page.waitForURL(origin + '/jobs'); release();
    await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
    checks.push({ name: 'passive navigation interrupts the held route and late Profile completion does not replace Jobs', passed: true });
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    hold = true;
    await page.getByRole('link', { name: /^Notifications(?:, \d+ unread)?$/ }).first().click();
    await until(() => held.length > 0); await pending.waitFor({ timeout: 30000 });
    const geometry = await pending.evaluate(node => {
      const sidebar = node.querySelector('aside').getBoundingClientRect(), main = node.querySelector('main').getBoundingClientRect();
      return { sidebarWidth: sidebar.width, sidebarRight: sidebar.right, mainLeft: main.left };
    });
    assert.equal(geometry.sidebarWidth, 76); assert.ok(geometry.mainLeft >= geometry.sidebarRight);
    await page.screenshot({ path: path.join(artifacts, 'held-notifications-collapsed.png') }); release();
    await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
    checks.push({ name: 'collapsed sidebar and content geometry stay aligned during a real cold Notifications transition', passed: true, ...geometry });
    assert.deepEqual(errors, []);
    const receipt = { checkedAt: new Date().toISOString(), scope: 'Real Next dev App Router, production proxy/getServerViewer/AppShell/root loading/Jobs/Profile/Notifications modules; synthetic local Supabase HTTP Auth/database. No Next routing adapter and no hosted requests.', runtime: await browser.version(), checks, frames, browserErrors: errors, limits: ['Development compilation and localhost transport prevent production latency claims.', 'This proves visible navigation during held server response, not persistent DOM, GPU paint or faster network.', 'Auth/account replacement is covered by focused helper and actual-recorder tests, not a hosted account switch in this run.'] };
    await fs.writeFile(path.join(artifacts, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ checks, browserErrors: errors, artifacts }, null, 2) + '\n');
  } finally {
    release(); await browser?.close(); next?.kill('SIGTERM'); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
    await fs.writeFile(path.join(artifacts, 'next.log'), nextLog);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
