/** Real Chrome, real admin media components, synthetic local HTTP media only. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium } = require('../../../web/node_modules/playwright');
const output = process.env.PLATINUM_UI_OUTPUT || '/tmp/platinum-admin-media-readiness';
const artifacts = process.env.PLATINUM_UI_ARTIFACTS || '/tmp/platinum-admin-media-readiness-artifacts';
const executablePath = process.env.PLATINUM_CHROMIUM;
if (!executablePath) throw new Error('PLATINUM_CHROMIUM must identify the verified browser binary.');
const checks = [], errors = [], requests = [];
let idlePreview;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, action) { await action(); checks.push({ name, passed: true }); console.log('PASS', name); }

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  // Reproducible synthetic pixels; no committed binary or user media. The CI
  // browser lane already provides FFmpeg for the other media fixtures.
  const videoPath = path.join(output, 'media-readiness.mp4');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x224488:s=160x90:r=24:d=1', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', videoPath], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || 'FFmpeg is required to generate the synthetic video.');
  const [videoBytes, posterA, posterB] = await Promise.all([
    fs.readFile(videoPath),
    fs.readFile(path.join(output, 'logo.png')), fs.readFile(path.join(output, 'pearl.png')),
  ]);
  let releaseA, retryReads = 0;
  const heldA = new Promise(resolve => { releaseA = resolve; });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push(pathname);
    try {
      if (pathname.startsWith('/media/')) {
        if (pathname === '/media/video-a.mp4') await heldA;
        if (res.destroyed) return;
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1;
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` } : {}) });
        res.end(videoBytes.subarray(start, end + 1)); return;
      }
      if (pathname === '/poster-a.png' || pathname === '/poster-b.png' || pathname === '/retry-image.png') {
        if (pathname === '/retry-image.png' && ++retryReads === 1) { res.writeHead(503, { 'Cache-Control': 'no-store' }); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }); res.end(pathname === '/poster-a.png' ? posterA : posterB); return;
      }
      const file = ['/fixture.js', '/fixture.css'].includes(pathname) ? pathname.slice(1) : 'index.html';
      const bytes = await fs.readFile(path.join(output, file));
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(bytes);
    } catch { if (!res.destroyed) { res.writeHead(500); res.end(); } }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Admin media readiness fixture' }).waitFor();
    const selected = page.getByRole('region', { name: 'Selected media' });
    await check('24 video tiles display posters or explicit video fallbacks without creating players or fetching video bytes', async () => {
      const tiles = page.getByRole('region', { name: 'Video tiles' });
      assert.equal(await tiles.locator('video').count(), 0);
      assert.equal(await tiles.getByRole('img', { name: 'Video preview', exact: true }).count(), 12);
      assert.equal(requests.some(url => url.startsWith('/media/tile-')), false);
    });
    await check('a late record A response cannot replace record B or its matching poster', async () => {
      await selected.getByAltText('Selected video cover').waitFor();
      assert.match(await selected.getByAltText('Selected video cover').getAttribute('src'), /poster-a\.png$/);
      await page.getByRole('button', { name: 'Review record B', exact: true }).click();
      assert.match(await selected.locator('video').getAttribute('src'), /video-b\.mp4$/);
      assert.match(await selected.getByAltText('Selected video cover').getAttribute('src'), /poster-b\.png$/);
      releaseA(); await pause(80);
      assert.match(await selected.locator('video').getAttribute('src'), /video-b\.mp4$/);
      assert.equal(await selected.locator('video').count(), 1);
    });
    await check('trimmed video reveals decoded frames and preserves one player, buffered bytes and position through expand and close', async () => {
      const video = selected.locator('video');
      await page.waitForFunction(() => { const v = document.querySelector('[aria-label="Selected media"] video'); return v && v.readyState >= 4 && !v.seeking && v.currentTime >= .15; });
      await selected.getByRole('button', { name: 'Play video preview', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Selected media"] img[alt="Selected video cover"]'));
      await selected.getByRole('button', { name: 'Pause video preview', exact: true }).click();
      await video.evaluate(element => { element.__samePlayer = true; });
      const before = await video.evaluate(element => ({ position: element.currentTime, buffered: element.buffered.end(element.buffered.length - 1) }));
      assert.ok(before.position >= .15 && before.position <= .95);
      const count = requests.filter(url => url === '/media/video-b.mp4').length;
      await selected.getByRole('button', { name: 'Full screen', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Full screen media review', exact: true });
      await modal.waitFor();
      assert.equal(await modal.locator('video').evaluate(element => element.__samePlayer), true);
      assert.equal(await page.locator('video').count(), 1);
      await modal.getByRole('button', { name: 'Close full screen media', exact: true }).click();
      await modal.waitFor({ state: 'hidden' }); await pause(80);
      const after = await video.evaluate(element => ({ same: element.__samePlayer, position: element.currentTime, buffered: element.buffered.end(element.buffered.length - 1) }));
      assert.equal(after.same, true); assert.equal(after.position, before.position); assert.ok(after.buffered >= before.buffered);
      assert.equal(requests.filter(url => url === '/media/video-b.mp4').length, count, 'Expanding or closing cannot refetch the private video');
    });
    await check('a fully buffered untrimmed preview stays paused beyond its startup deadline and plays on the first later click', async () => {
      await page.getByRole('button', { name: 'Review untrimmed record', exact: true }).click();
      const video = selected.locator('video');
      await page.waitForFunction(() => { const v = document.querySelector('[aria-label="Selected media"] video'); return v && v.readyState === 4 && !v.seeking && v.paused; });
      await video.evaluate(element => { element.__idlePlayer = true; });
      const count = requests.filter(url => url === '/media/video-c.mp4').length;
      // Intentionally exceed the production 15s loading deadline while staff
      // read a record. No synthetic media events or shortened timer here.
      await pause(16_000);
      assert.equal(await video.count(), 1);
      idlePreview = await video.evaluate(element => ({ samePlayer: element.__idlePlayer === true, readyState: element.readyState, paused: element.paused, currentTime: element.currentTime, mediaError: element.error?.code ?? null, idleMilliseconds: 16_000 }));
      assert.equal(idlePreview.samePlayer, true); assert.equal(idlePreview.readyState, 4); assert.equal(idlePreview.paused, true); assert.equal(idlePreview.currentTime, 0); assert.equal(idlePreview.mediaError, null);
      assert.equal(requests.filter(url => url === '/media/video-c.mp4').length, count, 'Waiting to press Play cannot refetch the private video');
      await selected.getByAltText('Selected video cover').waitFor();
      await selected.getByRole('button', { name: 'Play video preview', exact: true }).click();
      await page.waitForFunction(() => { const v = document.querySelector('[aria-label="Selected media"] video'); return v && !v.paused && v.currentTime > 0 && !document.querySelector('[aria-label="Selected media"] img[alt="Selected video cover"]'); });
      await selected.getByRole('button', { name: 'Pause video preview', exact: true }).click();
      assert.equal(await selected.getByRole('button', { name: 'Reload media preview', exact: true }).count(), 0);
    });
    await check('a failed photo has an explicit retry that reloads only that source', async () => {
      const photo = page.getByRole('region', { name: 'Retriable photo' });
      await photo.getByRole('button', { name: 'Reload media preview', exact: true }).click();
      await photo.getByAltText('Content preview').waitFor();
      await page.waitForFunction(() => { const image = document.querySelector('[aria-label="Retriable photo"] img'); return image && image.complete && image.naturalWidth > 0; });
      assert.equal(retryReads, 2);
      assert.equal(await photo.getByRole('button', { name: 'Reload media preview', exact: true }).count(), 0);
    });
    await check('gallery attachment changes, Escape and record removal clean up modal state without stale media', async () => {
      await selected.getByRole('button', { name: 'Next attachment', exact: true }).click();
      const trigger = selected.getByRole('button', { name: 'Open photo in full screen', exact: true });
      await trigger.click(); await page.getByRole('dialog', { name: 'Full screen media review' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('video').count(), 0);
      await trigger.click();
      await page.getByRole('button', { name: 'Remove selected media', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
      assert.equal(await page.getByRole('dialog', { name: 'Full screen media review' }).count(), 0);
      assert.equal(await selected.locator('img').count(), 0);
    });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifacts, 'admin-media-readiness.png'), fullPage: true });
    const receipt = { checkedAt: new Date().toISOString(), runtime: await browser.version(), scope: 'Actual admin media components, synthetic same-origin no-store media. Not authenticated hosted acceptance.', checks, browserErrors: errors, tileVideoRequests: requests.filter(url => url.startsWith('/media/tile-')).length, idlePreview };
    await fs.writeFile(path.join(artifacts, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ passed: checks.length, browserErrors: errors.length, artifacts }));
  } catch (error) {
    await fs.writeFile(path.join(artifacts, 'browser-failure.json'), JSON.stringify({ checks, browserErrors: errors, failure: String(error) }, null, 2) + '\n');
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { releaseA(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
