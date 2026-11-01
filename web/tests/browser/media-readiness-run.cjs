/** Actual DOM/media elements; synthetic services and no-store local video bytes. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { chromium } = require('../../node_modules/playwright');
const { compile } = require('./ui-compile.cjs');
const root = path.resolve(__dirname, '../../..');
const output = process.env.MEDIA_READINESS_OUTPUT || '/tmp/platinum-web-media-readiness';
const evidence = process.env.MEDIA_READINESS_EVIDENCE || path.join(root, 'docs/quality/web-admin-media-parity-20261101/feed-browser');
const cases = [], failures = [], requests = [], held = [];
let holdB = true;
async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const adapter = path.join(__dirname, 'media-readiness-adapter.ts');
  await compile({ entry: path.join(__dirname, 'media-readiness-fixture.tsx'), output,
    aliases: { '@/lib/supabase/client': adapter, [path.join(root, 'web/lib/supabase/client.ts')]: adapter,
      '@/lib/contentMedia': adapter, [path.join(root, 'web/lib/contentMedia.ts')]: adapter }, title: 'Media readiness verification' });
  for (const color of ['red', 'blue']) await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x120:r=24`,
    '-t', '4', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, color + '.mp4')], { timeout: 20000 });
  const red = await fs.readFile(path.join(output, 'red.mp4')), blue = await fs.readFile(path.join(output, 'blue.mp4'));
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.includes('/storage/')) { failures.push('Canonical private URL requested: ' + pathname); res.writeHead(403); res.end(); return; }
    if (pathname.endsWith('.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="${pathname.endsWith('b.svg') ? 'blue' : 'red'}"/><text x="20" y="40" fill="white">Source cover</text></svg>`); return;
    }
    if (pathname.endsWith('.mp4')) {
      const bytes = pathname.endsWith('/b.mp4') ? blue : red;
      requests.push({ path: pathname, range: req.headers.range || null });
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }); res.end(); return; }
      const send = () => { if (res.destroyed) return; res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }); res.end(bytes.subarray(start, end + 1)); };
      if (holdB && pathname.endsWith('/b.mp4')) held.push(send); else send(); return;
    }
    const name = pathname === '/fixture.js' ? 'fixture.js' : pathname === '/fixture.css' ? 'fixture.css' : 'index.html';
    res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await fs.readFile(path.join(output, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const check = async (name, action) => { try { await action(); cases.push(name); console.log('PASS', name); } catch (error) { failures.push(name + ': ' + error.message); throw error; } };
  try {
    await page.goto(origin); await page.waitForFunction(() => !!window.__mediaFixture);
    await check('Actual warm elements are bounded to two without autoplay or detached decoders', async () => {
      await page.waitForFunction(() => document.querySelectorAll('video[src]').length > 0);
      assert.ok(await page.locator('video[src]').count() <= 2);
      assert.equal(await page.locator('video').evaluateAll(nodes => nodes.filter(node => !node.paused).length), 0);
    });
    await check('Metadata refresh retains the exact video DOM node and capability URL', async () => {
      await page.locator('[data-feed-video] video').evaluate(node => { window.__beforeVideo = node; window.__beforeUrl = node.getAttribute('src'); });
      await page.evaluate(() => window.__mediaFixture.refresh());
      assert.equal(await page.locator('[data-count]').textContent(), '1');
      assert.equal(await page.locator('[data-feed-video] video').evaluate(node => node === window.__beforeVideo && node.getAttribute('src') === window.__beforeUrl), true);
    });
    await check('A slow replacement keeps only its own poster, then reveals its actual blue frame', async () => {
      await page.evaluate(() => window.__mediaFixture.switch('b'));
      await page.waitForFunction(() => document.querySelector('[data-feed-video] [data-video-poster] img')?.getAttribute('src')?.includes('/b.svg'));
      assert.equal(await page.locator('[data-feed-video] video').evaluate(node => node === window.__beforeVideo), false);
      assert.equal(await page.evaluate(() => window.__beforeVideo.getAttribute('src')), null);
      assert.equal(await page.locator('[data-moment-overlay]').count(), 0);
      holdB = false; held.splice(0).forEach(send => send());
      await page.locator('[data-feed-video]').getByRole('button', { name: 'Play video', exact: true }).first().click();
      await page.waitForFunction(() => !document.querySelector('[data-feed-video] [data-video-poster]'));
      const rgb = await page.locator('[data-feed-video] video').evaluate(video => {
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      });
      assert.ok(rgb[2] > 150 && rgb[0] < 80, 'The decoded frame belongs to source B');
      assert.equal(await page.locator('[data-moment-overlay]').count(), 1);
    });
    await check('Source text appears before grants/author; media does not wait for an author', async () => {
      await page.getByText('Authorized source a', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-source-preview] img').count(), 0);
      await page.evaluate(() => window.__mediaFixture.grant());
      await page.locator('[data-source-preview] img').waitFor();
      await page.getByText('Author pending', { exact: true }).waitFor();
      assert.match(await page.locator('[data-source-preview] img').getAttribute('src'), /\/a.svg/);
      await page.evaluate(() => window.__mediaFixture.authors());
      await page.getByText('Author author-a', { exact: true }).waitFor();
      assert.match(await page.locator('[data-source-preview] img').getAttribute('src'), /\/a.svg/);
    });
    await check('Data saver releases speculative buffers without interrupting explicit playback', async () => {
      await page.evaluate(() => window.__mediaFixture.dataSaver(true));
      await page.waitForFunction(() => document.querySelectorAll('[data-warm-video] video[src]').length === 0);
      assert.equal(await page.locator('[data-feed-video] video').evaluate(video => video.paused), false);
    });
    await check('Visibility suspension removes ordinary sources from actual video DOM nodes', async () => {
      await page.evaluate(() => window.__mediaFixture.visibility(true));
      await page.waitForFunction(() => document.querySelectorAll('video[src]').length === 0);
      assert.equal(await page.locator('video').evaluateAll(nodes => nodes.filter(node => !node.paused).length), 0);
      await page.evaluate(() => window.__mediaFixture.visibility(false));
      assert.equal(await page.locator('video[src]').count(), 0);
      await page.locator('[data-feed-video]').getByRole('button', { name: 'Play video', exact: true }).first().click();
      await page.waitForFunction(() => !document.querySelector('[data-feed-video] video').paused);
      assert.equal(await page.locator('[data-warm-video] video[src]').count(), 0);
      await page.locator('[data-feed-video]').getByRole('button', { name: 'Pause video', exact: true }).click();
      await page.evaluate(() => window.__mediaFixture.dataSaver(false));
      await page.waitForFunction(() => document.querySelectorAll('video[src]').length > 0);
      assert.ok(await page.locator('video[src]').count() <= 2);
    });
    await check('A to B to A session changes cannot restart an old player or restore a stale grant', async () => {
      await page.evaluate(() => { window.__mediaFixture.hold(); window.__mediaFixture.source('b'); });
      await page.getByText('Authorized source b', { exact: true }).waitFor();
      await page.evaluate(() => { window.__mediaFixture.session('fixture-b', 2); window.__mediaFixture.session('fixture-a', 3); window.__mediaFixture.source('a'); window.__mediaFixture.grant(); window.__mediaFixture.authors(); });
      await page.getByText('Authorized source a', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-source-preview] img')?.getAttribute('src')?.includes('/a.svg'));
      assert.equal(await page.locator('video[src]').count(), 0);
      await page.locator('[data-feed-video]').getByRole('button', { name: 'Play video', exact: true }).first().click();
      assert.equal(await page.locator('video[src]').count(), 0);
    });
    assert.deepEqual(failures, []);
  } finally {
    await page.screenshot({ path: path.join(evidence, 'media-readiness.png'), fullPage: true }).catch(() => {});
    const sourceFiles = ['web/components/VideoPlayer.tsx', 'web/components/PostCaption.tsx', 'web/components/SharedPostThumbnail.tsx',
      'web/lib/videoReadiness.ts', 'web/lib/mediaPrefs.ts', 'web/lib/homeFeedController.ts', 'web/lib/useSharedPostPreview.ts', 'web/lib/navigationCache.ts',
      'shared/navigationCache.ts', 'shared/feedMedia.ts', 'shared/feedMediaReuse.ts', 'shared/contentMedia.ts',
      'web/tests/browser/media-readiness-adapter.ts', 'web/tests/browser/media-readiness-fixture.tsx', 'web/tests/browser/media-readiness-run.cjs'];
    const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
    await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ scope: 'Actual React components and HTML video decoding over local no-store HTTP; synthetic Auth/grant/visibility inputs. Not hosted backend or physical-device acceptance.', runtime: await browser.version(), sourceSha256, cases, failures, requests }, null, 2) + '\n');
    held.splice(0).forEach(send => send()); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
