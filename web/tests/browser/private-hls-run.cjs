/** Actual React viewers, legacy transport, hls.js, MSE and decoded pixels. Synthetic Auth and grant service only. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto');
const { chromium } = require('../../node_modules/playwright');
const { compile } = require('./ui-compile.cjs');
const root = path.resolve(__dirname, '../../..');
const output = process.env.PRIVATE_HLS_OUTPUT || '/tmp/platinum-private-hls-browser';
const evidence = process.env.PRIVATE_HLS_EVIDENCE || path.join(root, 'docs/quality/offline-adaptive-completion-20261105/private-hls-browser');
const apiOrigin = 'https://private-hls.synthetic.invalid', endpoint = apiOrigin + '/functions/v1/private-hls';
const ordinaryId = '10000000-0000-4000-8000-000000000001', limitedId = '10000000-0000-4000-8000-000000000002';
const leaseId = '10000000-0000-4000-8000-000000000003', bearer = 'Bearer synthetic-private-bearer';
const cases = [], failures = [], requests = [];
async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const adapter = path.join(__dirname, 'private-hls-adapter.tsx');
  await compile({ entry: path.join(__dirname, 'private-hls-fixture.tsx'), output,
    aliases: { '@/lib/supabase/client': adapter, [path.join(root, 'web/components/PrivateCameraGuard.tsx')]: adapter },
    environment: { NEXT_PUBLIC_SUPABASE_URL: apiOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-only', NEXT_PUBLIC_PRIVATE_HLS: 'true',
      NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED: 'false', NEXT_PUBLIC_LEGACY_LIMITED_MEDIA_ENABLED: 'true' },
    title: 'Private HLS decoded playback verification' });
  await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=8',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
    '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(output, 'seg%05d.ts'), path.join(output, 'index.m3u8')], { timeout: 20000 });
  await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-i', path.join(output, 'index.m3u8'), '-c', 'copy', '-movflags', '+faststart', path.join(output, 'original.mp4')], { timeout: 20000 });
  const original = await fs.readFile(path.join(output, 'original.mp4'));
  const playlist = await fs.readFile(path.join(output, 'index.m3u8'), 'utf8');
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    const name = /^\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(pathname) ? pathname.slice(1) : 'index.html';
    res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await fs.readFile(path.join(output, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const origin = 'http://127.0.0.1:' + server.address().port;
  let context, page;
  const scenarios = [];
  const check = async (name, action) => { try { await action(); cases.push(name); console.log('PASS', name); } catch (error) { failures.push(name + ': ' + error.message); throw error; } };
  const settled = async condition => {
    const deadline = Date.now() + 3000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(condition(), 'Transport close did not settle within three seconds');
  };
  const assetUrl = (grant, asset) => endpoint + '?' + new URLSearchParams({ messageId: grant.messageId, requestId: grant.requestId, sourceVersion: 'version_1', leaseId, asset });
  async function scenario({ failHls = false, deniedHls = false, seconds = 60 } = {}) {
    if (context) await context.close();
    context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
    const state = { grants: new Map(), views: 0, originalGets: 0, hlsCloses: 0, legacyCloses: 0, childGets: 0, failHls, deniedHls };
    scenarios.push(state);
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.origin !== apiOrigin) return route.abort();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'private, no-store, max-age=0' };
      const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      const authorization = request.headers().authorization;
      requests.push({ method: request.method(), path: url.pathname, asset: url.searchParams.get('asset'), authorized: authorization === bearer });
      assert.equal(url.href.includes('synthetic-private-bearer'), false);
      if (authorization !== bearer) return json({ error: 'sign_in_required' }, 401);
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      if (url.pathname === '/functions/v1/chat-media-sign') {
        assert.deepEqual(body.messageIds, [limitedId]); assert.equal(body.consume, true); assert.equal(body.delivery, 'no-store');
        state.views++;
        if (state.views > 1) return json({ error: 'viewing_ended' }, 410);
        const grant = { messageId: limitedId, requestId: body.requestId, expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), closed: false };
        state.grants.set(body.requestId, grant);
        return json({ urls: { [limitedId]: apiOrigin + '/functions/v1/limited-media-file?' + new URLSearchParams({ messageId: limitedId, requestId: grant.requestId }) },
          requestId: grant.requestId, mediaType: 'video', remaining: 0, expiresAt: grant.expiresAt });
      }
      if (url.pathname === '/functions/v1/limited-media-file') {
        const grant = state.grants.get(body?.requestId || url.searchParams.get('requestId'));
        if (body?.action === 'close') { if (grant) grant.closed = true; state.legacyCloses++; return json({ closed: true }); }
        if (!grant || grant.closed || Date.now() >= Date.parse(grant.expiresAt)) return json({}, 410);
        state.originalGets++; return route.fulfill({ status: 200, headers, contentType: 'video/mp4', body: original });
      }
      if (url.pathname === '/functions/v1/private-hls') {
        const requestId = body?.requestId || url.searchParams.get('requestId');
        let grant = state.grants.get(requestId);
        if (body?.action === 'close') { if (grant) grant.hlsClosed = true; state.hlsCloses++; return json({ closed: true }); }
        if (body?.action === 'open') {
          if (!grant && body.messageId === ordinaryId) { grant = { messageId: ordinaryId, requestId, expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), closed: false }; state.grants.set(requestId, grant); }
          if (!grant || grant.closed || grant.hlsClosed) return json({ ready: false });
          return json({ ready: true, requestId, hlsUrl: assetUrl(grant, 'master.m3u8'), sourceVersion: 'version_1', expiresAt: grant.expiresAt });
        }
        if (!grant || grant.closed || grant.hlsClosed || Date.now() >= Date.parse(grant.expiresAt)) return json({}, 410);
        assert.equal(url.searchParams.get('messageId'), grant.messageId); assert.equal(url.searchParams.get('sourceVersion'), 'version_1'); assert.equal(url.searchParams.get('leaseId'), leaseId);
        state.childGets++;
        if (state.deniedHls) return json({ error: 'viewing_ended' }, 410);
        if (state.failHls) return json({ error: 'synthetic_encoding_failure' }, 500);
        const asset = url.searchParams.get('asset');
        if (asset === 'master.m3u8') return route.fulfill({ status: 200, headers, contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=320x180,FRAME-RATE=24.000\n' + assetUrl(grant, 'r0/index.m3u8') + '\n' });
        if (asset === 'r0/index.m3u8') return route.fulfill({ status: 200, headers, contentType: 'application/vnd.apple.mpegurl', body: playlist.replace(/^seg\d{5}\.ts$/gm, name => assetUrl(grant, 'r0/' + name)) });
        if (/^r0\/seg\d{5}\.ts$/.test(asset || '')) return route.fulfill({ status: 200, headers, contentType: 'video/mp2t', body: await fs.readFile(path.join(output, asset.slice(3))) });
      }
      return json({ error: 'unexpected_request' }, 404);
    });
    await page.goto(origin); await page.waitForFunction(() => !!window.__privateHlsFixture);
    return state;
  }
  async function limitedVideo() {
    await page.getByRole('button', { name: 'Open limited viewer', exact: true }).click();
    await page.getByRole('button', { name: 'Open attachment', exact: true }).click();
    const video = page.locator('[data-private-content] video');
    await video.waitFor(); await page.waitForFunction(() => { const v = document.querySelector('[data-private-content] video'); return v && v.readyState >= 2 && v.videoWidth > 0; });
    return video;
  }
  async function redPixels(video) {
    const rgb = await video.evaluate(v => { const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const ctx = canvas.getContext('2d'); ctx.drawImage(v, 0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); });
    assert.ok(rgb[0] > 180 && rgb[1] < 70 && rgb[2] < 70, 'Real decoded red frame required'); return rgb;
  }
  try {
    await check('Ordinary HLS decodes after an explicit tap and closes on account change', async () => {
      const state = await scenario(); assert.equal(state.childGets, 0);
      await page.locator('[data-ordinary]').getByRole('button', { name: 'Play video', exact: true }).click();
      await page.waitForFunction(() => { const v = document.querySelector('[data-ordinary] video'); return v.readyState >= 2 && v.currentTime > 0; });
      await redPixels(page.locator('[data-ordinary] video')); assert.ok(state.childGets >= 3);
      await page.evaluate(() => window.__privateHlsFixture.account());
      await page.waitForFunction(() => !document.querySelector('[data-ordinary] video').getAttribute('src'));
      await page.waitForFunction(() => document.querySelector('[data-ordinary] video').paused);
      await settled(() => state.hlsCloses >= 1);
    });
    await check('Legacy one-view HLS decodes using one view and both transports close terminally', async () => {
      const state = await scenario(); const video = await limitedVideo(); await redPixels(video);
      assert.equal(state.views, 1); assert.equal(state.originalGets, 0); assert.ok(state.childGets >= 3);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-private-content]'));
      await settled(() => state.hlsCloses >= 1 && state.legacyCloses >= 1); assert.equal(state.views, 1);
    });
    await check('HLS failure falls back to the exact legacy original without consuming again', async () => {
      const state = await scenario({ failHls: true }); await redPixels(await limitedVideo());
      assert.equal(state.views, 1); assert.equal(state.originalGets, 1); assert.ok(state.hlsCloses >= 1);
    });
    await check('Revoked HLS authorization closes the limited view without original fallback', async () => {
      const state = await scenario({ deniedHls: true });
      await page.getByRole('button', { name: 'Open limited viewer', exact: true }).click();
      await page.getByRole('button', { name: 'Open attachment', exact: true }).click();
      await page.getByRole('heading', { name: 'View closed', exact: true }).waitFor();
      await settled(() => state.hlsCloses >= 1 && state.legacyCloses >= 1);
      assert.equal(state.views, 1); assert.equal(state.originalGets, 0);
      assert.equal(await page.locator('[data-private-content] video').count(), 0);
    });
    await check('Genuine client deadline removes private decoded and buffered content', async () => {
      const state = await scenario({ seconds: 6 }); await redPixels(await limitedVideo());
      await page.getByRole('heading', { name: 'View closed', exact: true }).waitFor({ timeout: 10000 });
      assert.equal(await page.locator('[data-private-content] video').count(), 0); assert.equal(state.views, 1);
    });
    await check('Background visibility closes the same limited view and all HLS requests', async () => {
      const state = await scenario(); await redPixels(await limitedVideo());
      await page.evaluate(() => window.__privateHlsFixture.hidden());
      await page.getByRole('heading', { name: 'View closed', exact: true }).waitFor();
      assert.equal(await page.locator('[data-private-content] video').count(), 0); assert.equal(state.views, 1);
    });
    assert.deepEqual(failures, []);
  } finally {
    if (page) await page.screenshot({ path: path.join(evidence, 'private-hls.png'), fullPage: true }).catch(() => {});
    const files = ['web/components/PrivateMediaViewer.tsx', 'web/components/ChatVideo.tsx', 'web/components/MessagesApp.tsx', 'web/lib/privateAdaptiveVideo.ts', 'shared/privateAdaptiveMedia.ts', 'shared/legacyLimitedMedia.ts', 'web/tests/browser/private-hls-run.cjs', 'web/tests/browser/private-hls-fixture.tsx', 'web/tests/browser/private-hls-adapter.tsx'];
    const hashes = Object.fromEntries(await Promise.all(files.map(async f => [f, createHash('sha256').update(await fs.readFile(path.join(root, f))).digest('hex')])));
    await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ passed: cases.length === 6 && failures.length === 0, scope: 'Actual React, legacy protocol, installed hls.js/MSE and decoded pixels. Synthetic auth/service. Hosted authorization is verified by the separate QA canary. Not physical-device acceptance.', cases, failures, runtime: await browser.version(), sourceSha256: hashes, requests,
      scenarios: scenarios.map(s => ({ views: s.views, originalGets: s.originalGets, hlsCloses: s.hlsCloses, legacyCloses: s.legacyCloses, childGets: s.childGets, failHls: s.failHls, deniedHls: s.deniedHls })) }, null, 2) + '\n');
    if (context) await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
