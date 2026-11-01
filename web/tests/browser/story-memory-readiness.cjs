/** Actual browser media/lifetime boundary; synthetic Auth/RPC and generated clips only. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { compile } = require('./ui-compile.cjs');
const root = path.resolve(__dirname, '../../..');
const output = process.env.STORY_MEMORY_QA_OUTPUT || '/tmp/platinum-story-memory-readiness', fixture = path.join(output, 'fixture');
fs.mkdirSync(fixture, { recursive: true });
const sourceFiles = ['web/components/StoryViewer.tsx', 'web/components/StoryMedia.tsx', 'web/lib/storyMediaReadiness.ts', 'web/lib/stories.ts', 'web/components/MemoryAlbum.tsx', 'web/lib/memoryAlbum.ts', 'web/lib/memoryReadiness.ts', 'web/components/memory/MemoryBookCover.tsx', 'web/components/memory/MemoryPageImage.tsx', 'web/components/memory/MemoryFilm.tsx', 'web/components/memory/MemoryFilm.module.css', 'web/tests/browser/story-memory-readiness-adapter.ts', 'web/tests/browser/story-memory-readiness-fixture.tsx', 'web/tests/browser/story-memory-readiness.cjs'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
const requests = [], colors = { a: 'red', b: 'blue', c: 'lime', d: 'yellow', background: 'white' };
for (const [name, color] of Object.entries(colors)) {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=180x320:r=15:d=3', '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=${color}:t=fill:enable='gte(t,0.35)'`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(fixture, `${name}.mp4`)], { encoding: 'utf8' });
  assert.equal(made.status, 0, 'Generated clip failed: ' + made.stderr);
}
const server = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://local').pathname;
  if (route.startsWith('/media/')) {
    const name = path.basename(route, '.mp4');
    if (!(name in colors)) { res.writeHead(404); res.end(); return; }
    const bytes = fs.readFileSync(path.join(fixture, name + '.mp4'));
    const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    const headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store, max-age=0', 'Accept-Ranges': 'bytes' };
    requests.push({ route, range: !!range });
    if (start > end || start >= bytes.length) { res.writeHead(416, headers); res.end(); return; }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers); res.end(bytes.subarray(start, end + 1)); return;
  }
  if (route === '/audio/platinum-memory-score.m4a') { res.writeHead(200, { 'Content-Type': 'audio/mp4' }); res.end(fs.readFileSync(path.join(root, 'web/public/audio/platinum-memory-score.m4a'))); return; }
  const file = path.resolve(fixture, route === '/' ? 'index.html' : route.slice(1));
  if (!file.startsWith(fixture + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(fs.readFileSync(file));
});
const count = letter => requests.filter(r => r.route === `/media/${letter}.mp4`).length;
const frameReady = async (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector); return node && node.readyState >= 2 && node.getAttribute('data-memory-frame-ready') === 'true';
}, selector);
const warmed = async (page, selector) => page.waitForFunction(selector => {
  const node = document.querySelector(selector); return node && node.readyState >= 3 && node.buffered.length && node.buffered.end(node.buffered.length - 1) >= 2.9;
}, selector);
const onePlaying = async (page, selector) => {
  const state = await page.locator(selector).evaluateAll(nodes => nodes.map(v => ({ paused: v.paused, muted: v.muted, src: new URL(v.src).pathname })));
  assert.ok(state.length <= 2, 'At most two local media players'); assert.ok(state.filter(v => !v.paused).length <= 1, 'Only the selected player advances'); return state;
};

(async () => {
  const before = hashes(), adapter = path.join(__dirname, 'story-memory-readiness-adapter.ts');
  await compile({ entry: path.join(__dirname, 'story-memory-readiness-fixture.tsx'), output: fixture,
    aliases: { '@/lib/supabase/client': adapter, [path.join(root, 'web/lib/supabase/client.ts')]: adapter }, title: 'Story and memory readiness verification' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.STORY_QA_CHROME || process.env.PLATINUM_CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const base = `http://127.0.0.1:${server.address().port}`, receipt = { browser: await browser.version(), scope: 'Actual web StoryViewer, MemoryAlbumView, MemoryFilm and cover components; synthetic Auth/RPC; generated same-origin no-store clips. No hosted account or hosted playback acceptance.', cases: [], firstRevealedFrames: [], consoleErrors: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.__readinessFrames = []; window.__ownerMismatches = [];
    const observed = new WeakSet();
    new MutationObserver(() => {
      for (const slot of document.querySelectorAll('[data-story-media-active="true"]')) {
        const owner = slot.closest('[data-story-owner]')?.getAttribute('data-story-owner');
        if (owner && owner !== slot.getAttribute('data-story-media-owner')) window.__ownerMismatches.push({ owner, mediaOwner: slot.getAttribute('data-story-media-owner') });
      }
      for (const video of document.querySelectorAll('video')) {
        const ready = video.dataset.memoryFrameReady === 'true' || video.closest('[data-story-frame-ready="true"]');
        if (!ready || observed.has(video) || !video.videoWidth) continue;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 2, 2);
        window.__readinessFrames.push({ source: new URL(video.currentSrc || video.src).pathname, time: video.currentTime, pixel: [...ctx.getImageData(1, 1, 1, 1).data] }); observed.add(video);
      }
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  const page = await context.newPage(); page.on('pageerror', error => receipt.consoleErrors.push(error.message));
  const collectFrames = async () => receipt.firstRevealedFrames.push(...await page.evaluate(() => window.__readinessFrames));
  try {
    await page.goto(base + '/?mode=cover'); await page.getByRole('img', { name: /Static video cover/ }).waitFor();
    assert.equal(await page.locator('[data-static-cover] video').count(), 0); assert.equal(requests.length, 0);
    receipt.cases.push({ name: 'Decorative video cover uses no video element, decoder or byte request', passed: true });

    await page.goto(base + '/?mode=story');
    await page.locator('[data-story-media-active="true"][data-story-frame-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Pause story', exact: true }).click();
    await warmed(page, '[data-story-media-active="false"] video');
    const warmStory = await page.locator('[data-story-media-active="false"] video').elementHandle(), beforeB = count('b');
    await page.getByTitle('Next', { exact: true }).click();
    await page.locator('[data-story-media-active="true"][data-story-frame-ready="true"]').waitFor();
    assert.equal(await page.evaluate(node => document.querySelector('[data-story-media-active="true"] video') === node, warmStory), true);
    assert.equal(count('b'), beforeB, 'Advancing must not issue a second no-store request for the warmed video');
    await onePlaying(page, '[data-story-media] video');
    receipt.cases.push({ name: 'Story handoff retains the warmed video node and its no-store bytes with one playing owner', passed: true });

    await page.getByRole('button', { name: 'Pause story', exact: true }).click();
    await page.evaluate(() => window.readinessFixture.hold('get_user_stories'));
    await page.getByTitle('Next', { exact: true }).click(); await page.getByTitle('Next', { exact: true }).click();
    await page.locator('[data-story-owner="dddddddd-dddd-4ddd-8ddd-dddddddddddd"]').waitFor();
    assert.equal(await page.locator('[data-story-media]').count(), 0, 'Previous owner media is absent during the new owner request');
    assert.equal(await page.getByText('Loading', { exact: true }).count(), 1);
    await page.evaluate(() => window.readinessFixture.release());
    await page.locator('[data-story-media-active="true"][data-story-frame-ready="true"]').waitFor();
    await page.getByRole('button', { name: 'Pause story', exact: true }).click();
    await page.evaluate(() => window.readinessFixture.hold('get_user_stories'));
    await page.getByTitle('Previous', { exact: true }).click();
    await page.locator('[data-story-owner="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]').waitFor();
    assert.equal(await page.locator('[data-story-media]').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__ownerMismatches), []);
    await page.evaluate(() => window.readinessFixture.release()); await page.locator('[data-story-media-active="true"][data-story-frame-ready="true"]').waitFor();
    await collectFrames(); receipt.cases.push({ name: 'Next and back across owners with held reads never pair an old source with the next header', passed: true });

    await page.goto(base + '/?mode=coexistence');
    await page.waitForFunction(() => document.querySelector('[data-background-video]')?.paused === false);
    await page.getByRole('button', { name: 'Open stories', exact: true }).click();
    await page.locator('[data-story-media-active="true"][data-story-frame-ready="true"]').waitFor();
    assert.equal(await page.locator('[data-background-video]').evaluate(video => video.paused), true);
    assert.equal(await page.locator('[data-story-media-active="true"] video').evaluate(video => video.paused), false);
    receipt.cases.push({ name: 'Opening stories stops an already-playing browser media consumer without pausing its own player', passed: true });

    await page.goto(base + '/?mode=book'); await page.getByRole('button', { name: 'Open book', exact: true }).waitFor();
    await warmed(page, '[data-memory-page="page-a"] video'); await warmed(page, '[data-memory-page="page-b"] video');
    const readerA = await page.locator('[data-memory-page="page-a"] video').elementHandle(), readerB = await page.locator('[data-memory-page="page-b"] video').elementHandle();
    await page.getByRole('button', { name: 'Open book', exact: true }).click(); await frameReady(page, '[data-memory-page-active="true"] video');
    assert.equal(await page.evaluate(node => document.querySelector('[data-memory-page-active="true"] video') === node, readerA), true);
    await page.locator('[data-memory-page-active="true"] video').evaluate(video => { video.pause(); video.currentTime = 1.5; });
    await page.waitForFunction(() => !document.querySelector('[data-memory-page-active="true"] video').seeking);
    const reads = await page.evaluate(() => window.readinessFixture.requests.filter(r => r.name === 'get_memory_book').length);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(reads => window.readinessFixture.requests.filter(r => r.name === 'get_memory_book').length > reads, reads);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(node => document.querySelector('[data-memory-page-active="true"] video') === node, readerA), true);
    assert.ok(Math.abs(await page.locator('[data-memory-page-active="true"] video').evaluate(video => video.currentTime) - 1.5) < .1, 'Refresh must preserve the paused playback position');
    const readerBRequests = count('b');
    await page.getByRole('button', { name: 'Next page', exact: true }).last().click();
    await page.locator('[data-memory-page="page-b"][data-memory-page-active="true"]').waitFor(); await frameReady(page, '[data-memory-page-active="true"] video');
    assert.equal(await page.evaluate(node => document.querySelector('[data-memory-page-active="true"] video') === node, readerB), true);
    assert.equal(count('b'), readerBRequests); await onePlaying(page, '[data-memory-page] video');
    receipt.cases.push({ name: 'Book cover prewarms real pages; opening, page turns and metadata refresh retain exact nodes and playback position', passed: true });
    await page.evaluate(() => { window.readinessFixture.hold('get_memory_book'); window.readinessFixture.changeAccount('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); });
    await page.waitForFunction(() => document.querySelectorAll('[data-memory-video]').length === 0);
    assert.equal(await readerB.evaluate(node => node.isConnected), false);
    await page.evaluate(() => { window.readinessFixture.changeAccount('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); window.readinessFixture.release(); });
    await page.getByRole('button', { name: 'Open book', exact: true }).waitFor();
    assert.equal(await page.evaluate(node => document.querySelector('[data-memory-page="page-a"] video') === node, readerA), false);
    await collectFrames(); receipt.cases.push({ name: 'Book A-to-B-to-A account changes discard old media and pending owner work', passed: true });

    await page.goto(base + '/?mode=film'); await frameReady(page, '[data-memory-film-active="true"] video');
    await page.getByRole('button', { name: 'Pause memory film', exact: true }).click(); await warmed(page, '[data-memory-film-active="false"] video');
    const filmB = await page.locator('[data-memory-film-active="false"] video').elementHandle(), filmBRequests = count('b');
    await page.getByRole('button', { name: 'Next memory', exact: true }).click(); await page.getByRole('button', { name: 'Play memory film', exact: true }).click();
    await frameReady(page, '[data-memory-film-active="true"] video');
    assert.equal(await page.evaluate(node => document.querySelector('[data-memory-film-active="true"] video') === node, filmB), true);
    assert.equal(count('b'), filmBRequests); await onePlaying(page, '[data-memory-film-slot] video');
    await collectFrames();
    const retiring = await page.locator('[data-memory-film-slot] video').elementHandles();
    await page.getByRole('button', { name: 'Close memory film', exact: true }).click();
    for (const node of retiring) assert.deepEqual(await node.evaluate(video => ({ connected: video.isConnected, paused: video.paused, src: video.getAttribute('src') })), { connected: false, paused: true, src: null });
    receipt.cases.push({ name: 'Film handoff retains the next player, limits playback ownership and releases every source on close', passed: true });

    assert.ok(receipt.firstRevealedFrames.length >= 7);
    for (const frame of receipt.firstRevealedFrames) {
      assert.ok(frame.time >= .35, 'No frame may be revealed before the saved .4-second trim: ' + JSON.stringify(frame));
      const [r, g, b] = frame.pixel, name = path.basename(frame.source, '.mp4');
      const valid = name === 'a' ? r > 150 && g < 90 && b < 90 : name === 'b' ? b > 150 && r < 90 && g < 90 : name === 'c' ? g > 150 && r < 90 && b < 90 : name === 'd' ? r > 150 && g > 150 && b < 90 : false;
      assert.ok(valid, 'First revealed pixels must belong to the requested colored clip, not its black intro: ' + JSON.stringify(frame));
    }
    receipt.cases.push({ name: 'Every observed first revealed frame has the correct distinct clip pixels after the saved trim', passed: true, frames: receipt.firstRevealedFrames.length });
    assert.deepEqual(receipt.consoleErrors, []); assert.deepEqual(hashes(), before, 'Tested source changed after compilation');
    receipt.sourceSha256 = before; receipt.fixtureBundleSha256 = sha(fs.readFileSync(path.join(fixture, 'fixture.js'))); receipt.mediaRequests = requests;
    fs.writeFileSync(path.join(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ browser: receipt.browser, cases: receipt.cases, frames: receipt.firstRevealedFrames.length, output }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
