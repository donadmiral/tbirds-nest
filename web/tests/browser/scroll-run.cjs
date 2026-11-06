/** Real mouse-wheel input against production web components. Local synthetic services only. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('../../node_modules/playwright');
const { compile } = require('./ui-compile.cjs');
const repo = path.resolve(__dirname, '../../..');
const output = process.env.PLATINUM_SCROLL_OUTPUT || '/tmp/platinum-web-scroll-browser';
const artifacts = process.env.PLATINUM_SCROLL_ARTIFACTS || '/tmp/platinum-web-scroll-evidence';
const executablePath = process.env.PLATINUM_CHROMIUM || '/tmp/platinum-web-admin-chrome156/chrome-linux64/chrome';
const sourceFiles = ['web/app/globals.css', 'web/components/HomeFeed.tsx', 'web/components/PostCard.tsx', 'web/components/PollCard.tsx', 'web/components/StableAsyncBlock.tsx', 'web/components/SharedPostThumbnail.tsx', 'web/components/MediaGallery.tsx', 'web/components/VideoPlayer.tsx', 'web/components/NavigationPopover.tsx', 'web/components/GlobalMediaLightbox.tsx', 'web/components/DiscoverViewer.tsx', 'web/components/ScrollMemory.tsx', 'web/lib/asyncBlockGeometry.ts', 'web/lib/useSharedPostPreview.ts', 'web/lib/contentMedia.ts', 'shared/contentMedia.ts', 'shared/sharedPostPreview.ts', 'web/lib/homeFeedController.ts', 'web/lib/homeFeedScroll.ts', 'web/tests/browser/social-fixture.tsx', 'web/tests/browser/scroll-fixture.tsx', 'web/tests/browser/scroll-run.cjs'];
const sourceHashes = () => Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(repo, file))).digest('hex')])).then(Object.fromEntries);
sourceFiles.push('shared/keyedBatchReader.ts', 'shared/feedLive.ts', 'web/lib/postMetadata.ts', 'web/lib/pollCheck.ts', 'web/lib/commentCounts.ts');
const checks = [], traces = [], errors = [], requests = [];
const id = index => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const mediaId = index => `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const coast = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720"><rect width="1200" height="720" fill="#c9d6df"/><path d="M0 400 Q400 270 1200 430 V720 H0Z" fill="#366481"/><text x="50" y="100" font-family="Arial" font-size="35" fill="#21384e">LOCAL SYNTHETIC WHEEL VERIFICATION</text></svg>';
const delayedImage = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#c9b28e"/><text x="50" y="100" font-family="Arial" font-size="35" fill="#21384e">DELAYED NATURAL IMAGE DIMENSIONS · 4:1</text></svg>';
const legacyOriginal = 'https://synthetic.invalid/storage/v1/object/public/post-media/legacy.jpg';
const legacyGranted = 'https://synthetic.invalid/functions/v1/media-content/post-media/legacy.jpg?token=' + 'b'.repeat(64);
const turns = (page, count) => page.evaluate(count => new Promise(resolve => {
  const tick = () => --count <= 0 ? resolve() : requestAnimationFrame(tick);
  requestAnimationFrame(tick);
}), count);

async function check(name, work) { await work(); checks.push(name); console.log('PASS', name); }
async function startProbe(page, label) {
  await page.evaluate(label => {
    const probe = { label, startY: scrollY, start: performance.now(), samples: [], wheels: [], longTasks: [] };
    const sample = t => { probe.samples.push({ t, y: scrollY }); probe.frame = requestAnimationFrame(sample); };
    probe.onWheel = event => probe.wheels.push({ t: performance.now(), x: event.deltaX, y: event.deltaY, mode: event.deltaMode, cancelled: event.defaultPrevented });
    window.addEventListener('wheel', probe.onWheel, { passive: true });
    probe.observer = new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
    probe.observer.observe({ type: 'longtask' }); probe.frame = requestAnimationFrame(sample); window.__wheelProbe = probe;
  }, label);
}
async function stopProbe(page) {
  return page.evaluate(() => {
    const probe = window.__wheelProbe;
    cancelAnimationFrame(probe.frame); window.removeEventListener('wheel', probe.onWheel); probe.observer.disconnect();
    const gaps = probe.samples.slice(1).map((sample, i) => sample.t - probe.samples[i].t).sort((a, b) => a - b);
    return { label: probe.label, startY: probe.startY, endY: scrollY, distance: scrollY - probe.startY,
      samples: probe.samples, wheels: probe.wheels, longTasks: probe.longTasks,
      frameIntervals: { count: gaps.length, median: gaps[Math.floor(gaps.length * .5)] || 0, p95: gaps[Math.floor(gaps.length * .95)] || 0, max: gaps.at(-1) || 0 },
      media: { videoNodes: document.querySelectorAll('video').length, attachedSources: [...document.querySelectorAll('video')].filter(video => video.getAttribute('src')).length, playing: [...document.querySelectorAll('video')].filter(video => !video.paused).length },
      height: document.documentElement.scrollHeight, htmlBehavior: getComputedStyle(document.documentElement).scrollBehavior };
  });
}
async function wheel(page, label, delta, count, interval = 3, locked = false) {
  await turns(page, 12); await startProbe(page, label);
  for (let index = 0; index < count; index++) { await page.mouse.wheel(0, delta); await turns(page, interval); }
  await turns(page, 24); const trace = await stopProbe(page);
  trace.expected = locked ? 0 : delta * count;
  trace.oppositeSteps = trace.samples.slice(1).filter((sample, i) => (sample.y - trace.samples[i].y) * Math.sign(delta) < -1).length;
  traces.push(trace);
  assert.ok(Math.abs(trace.distance - trace.expected) <= 1, `${label}: expected ${trace.expected}px, received ${trace.distance}px`);
  assert.equal(trace.oppositeSteps, 0, `${label}: scroll reversed without a reverse wheel event`);
  assert.equal(trace.wheels.length, count, `${label}: real browser wheel events were not received`);
  assert.ok(trace.wheels.every(event => event.mode === 0 && !event.cancelled), `${label}: app altered native wheel events`);
  // Browser samples describe this local run. Timing remains evidence, not a flaky
  // hardware-speed assertion; correctness assertions above are device-independent.
  console.log('WHEEL', JSON.stringify({ label, distance: trace.distance, frameIntervals: trace.frameIntervals, longTasks: trace.longTasks.length, media: trace.media }));
  return trace;
}
async function geometry(page, index) {
  return page.locator(`[data-pid="${id(index)}"]`).evaluate(card => {
    const frame = card.querySelector('.media-frame'), next = card.nextElementSibling;
    const rect = card.getBoundingClientRect(), media = frame?.getBoundingClientRect();
    return { y: scrollY, cardTop: rect.top, cardHeight: rect.height, frameWidth: media?.width, frameHeight: media?.height, nextTop: next?.getBoundingClientRect().top, documentHeight: document.documentElement.scrollHeight };
  });
}
async function assertGeometry(label, before, after) {
  traces.push({ label, before, after });
  for (const property of ['cardHeight', 'frameWidth', 'frameHeight', 'documentHeight']) {
    assert.ok(Math.abs(after[property] - before[property]) <= 1, `${label}: ${property} changed from ${before[property]} to ${after[property]}`);
  }
  assert.ok(Math.abs(after.y - before.y) <= 1, `${label}: page position changed without wheel input`);
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const hashes = await sourceHashes();
  const backend = path.join(__dirname, 'social-backend.ts');
  await compile({ entry: path.join(__dirname, 'scroll-fixture.tsx'), output,
    aliases: { '@/lib/supabase/client': backend, '@/lib/supabase/server': backend, '@/lib/serverViewer': backend, '@/lib/contentMedia': backend, './supabase/client': backend, '../../lib/supabase/client': backend },
    title: 'Platinum Circles — local mouse-wheel verification' });
  const videoPath = path.join(output, 'video.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x365d80:s=320x180:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath]);
  const videoBytes = await fs.readFile(videoPath);
  const held = { image: true, video: true }, pending = { image: [], video: [] };
  function release(kind) { held[kind] = false; for (const finish of pending[kind].splice(0)) finish(); }
  const server = http.createServer(async (request, response) => {
    const requested = new URL(request.url, 'http://localhost').pathname;
    const finish = () => {
      if (response.destroyed) return;
      if (requested.endsWith('.svg')) { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(requested === '/delayed-image.svg' ? delayedImage : coast); return; }
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1;
        response.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${videoBytes.length}`, 'content-length': end - start + 1 }); response.end(videoBytes.subarray(start, end + 1));
      } else { response.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': videoBytes.length }); response.end(videoBytes); }
    };
    if (requested === '/coast.svg' || requested === '/delayed-image.svg' || requested === '/video.mp4' || requested === '/delayed-video.mp4') {
      requests.push({ path: request.url, range: request.headers.range || null });
      const kind = requested === '/delayed-image.svg' ? 'image' : requested === '/delayed-video.mp4' ? 'video' : null;
      if (kind && held[kind]) pending[kind].push(finish); else finish(); return;
    }
    if (requested === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = /\.(js|css)$/.test(requested) ? requested.slice(1) : 'index.html', target = path.resolve(output, file);
    if (!target.startsWith(output + '/')) { response.writeHead(400); response.end(); return; }
    try { const content = await fs.readFile(target); response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(content); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  let failure;
  try {
    const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, reducedMotion: 'no-preference' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === legacyGranted) { requests.push({ path: url, syntheticCapability: true }); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: coast }); }
      if (url.startsWith(origin)) return route.continue();
      requests.push({ path: url, blocked: true }); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
    // Both delayed assets intentionally remain in flight at the first paint.
    await page.goto(origin + '/home', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('[data-feed-content] [data-pid]').length === 20);
    await turns(page, 24); await page.mouse.move(770, 650);

    await check('Late image decode keeps the feed frame and page position fixed', async () => {
      const before = await geometry(page, 1); release('image');
      await page.locator(`[data-pid="${id(1)}"] [data-media-opener]`).evaluate(image => image.decode()); await turns(page, 24);
      await assertGeometry('delayed image geometry', before, await geometry(page, 1));
    });
    await check('Late video metadata keeps the feed frame and page position fixed', async () => {
      const top = await page.locator(`[data-pid="${id(2)}"]`).evaluate(card => card.getBoundingClientRect().top);
      await page.mouse.wheel(0, Math.max(0, Math.round(top - 200))); await turns(page, 24);
      await page.waitForFunction(id => !!document.querySelector(`[data-pid="${id}"] video`)?.getAttribute('src'), id(2));
      const before = await geometry(page, 2); release('video');
      await page.waitForFunction(id => document.querySelector(`[data-pid="${id}"] video`)?.videoWidth === 320, id(2)); await turns(page, 24);
      await assertGeometry('delayed video geometry', before, await geometry(page, 2));
    });
    await check('A late authored square crop stays clipped inside the reserved feed frame', async () => {
      const before = await geometry(page, 1); await page.evaluate(() => window.__scrollFixture.releaseRecipe());
      await page.waitForFunction(id => {
        const image = document.querySelector(`[data-pid="${id}"] [data-media-opener]`);
        return image && getComputedStyle(image).transform.startsWith('matrix(2,');
      }, id(1)); await turns(page, 12);
      const crop = await page.locator(`[data-pid="${id(1)}"] [data-media-opener]`).evaluate(image => {
        const container = image.parentElement, box = container.getBoundingClientRect();
        return { width: box.width, height: box.height, overflow: getComputedStyle(container).overflow, imageTransform: getComputedStyle(image).transform };
      });
      assert.equal(crop.overflow, 'hidden', 'authored scale bleeds outside the inner crop');
      assert.ok(Math.abs(crop.width - crop.height) <= 1, 'authored square aspect was not applied inside the frame');
      await assertGeometry('delayed crop geometry', before, await geometry(page, 1)); traces.push({ label: 'late square crop', ...crop });
    });
    await check('A failed metadata renewal retains the confirmed authored crop and reading position', async () => {
      const before = await geometry(page, 1);
      await page.evaluate(() => { window.__scrollFixture.failRecipeReads(true); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.__scrollFixture.metadataReads.some(read => read.failed));
      await turns(page, 12);
      const transform = await page.locator(`[data-pid="${id(1)}"] [data-media-opener]`).evaluate(image => getComputedStyle(image).transform);
      assert.ok(transform.startsWith('matrix(2,'), 'a failed metadata read reverted the confirmed authored crop');
      await assertGeometry('failed metadata renewal', before, await geometry(page, 1));
      await page.evaluate(() => window.__scrollFixture.failRecipeReads(false));
    });
    await check('A warm refresh error and its Retry do not move any feed card', async () => {
      const before = await geometry(page, 1);
      await page.evaluate(() => { window.__scrollFixture.failRefresh(true); window.dispatchEvent(new Event('pc-refresh-feed')); });
      const notice = page.locator('[data-feed-refresh-error]');
      await notice.waitFor({state:'visible'});
      await assertGeometry('warm refresh error', before, await geometry(page, 1));
      await page.evaluate(() => window.__scrollFixture.failRefresh(false));
      await notice.getByRole('button', {name:'Retry'}).click();
      await notice.waitFor({state:'detached'});
      await assertGeometry('warm refresh recovery', before, await geometry(page, 1));
    });

    await check('Mouse wheel follows native distance without acceleration or reverse jumps', async () => {
      await wheel(page, 'detented wheel', 120, 8, 4);
      await wheel(page, 'rapid wheel', 360, 8, 2);
      await wheel(page, 'reverse wheel', -120, 6, 3);
      await wheel(page, 'small trackpad-style deltas', 8, 20, 1);
    });
    await check('Appending a page preserves existing cards, metadata work and the visible anchor', async () => {
      const target = await page.locator(`[data-pid="${id(14)}"]`).evaluate(card => card.getBoundingClientRect().top);
      await page.mouse.wheel(0, Math.round(target - 300)); await turns(page, 24);
      await page.waitForFunction(() => window.__scrollFixture.feedRequests.some(request => request.cursor && request.held));
      const before = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-feed-content] [data-pid]')];
        const anchor = cards.find(card => card.getBoundingClientRect().top >= 0);
        window.__scrollRetained = { cards, videos: [...document.querySelectorAll('[data-feed-content] video')] };
        return { y: scrollY, anchor: anchor?.getAttribute('data-pid'), anchorTop: anchor?.getBoundingClientRect().top, metadataReads: window.__scrollFixture.metadataReads.length };
      });
      await page.evaluate(() => window.__scrollFixture.release());
      await page.waitForFunction(() => document.querySelectorAll('[data-feed-content] [data-pid]').length === 36); await turns(page, 24);
      const after = await page.evaluate(({ before, previousIds }) => {
        const retained = window.__scrollRetained;
        return { y: scrollY, anchorTop: document.querySelector(`[data-pid="${before.anchor}"]`)?.getBoundingClientRect().top,
          retainedCards: retained.cards.every(card => card.isConnected && card === document.querySelector(`[data-pid="${card.getAttribute('data-pid')}"]`)),
          retainedVideos: retained.videos.every(video => video.isConnected),
          repeatedMetadataReads: window.__scrollFixture.metadataReads.slice(before.metadataReads).filter(read => read.ids.some(id => previousIds.includes(id))) };
      }, { before, previousIds: Array.from({ length: 20 }, (_, index) => mediaId(index + 1)) });
      traces.push({ label: 'page append', before, after });
      assert.ok(after.retainedCards && after.retainedVideos, 'append replaced an already mounted card or player');
      assert.ok(Math.abs(after.y - before.y) <= 1 && Math.abs(after.anchorTop - before.anchorTop) <= 1, 'append moved the current reading position');
      assert.equal(after.repeatedMetadataReads.length, 0, 'append requeried metadata for previously loaded cards');
      const longFeed = await wheel(page, 'long feed wheel after append', 360, 10, 2);
      assert.ok(longFeed.media.attachedSources <= 3, 'long feed retained too many video sources');
      assert.ok(longFeed.media.playing <= 1, 'more than one feed video played');
    });
    await check('Navigation popover and composer preserve a scrolled page and native wheel resumes', async () => {
      const before = await page.evaluate(() => ({ y: scrollY, width: document.documentElement.clientWidth }));
      const create = page.getByRole('button', { name: 'Create', exact: true }).first();
      await create.click(); const menu = page.getByRole('dialog', { name: 'Create', exact: true }); await menu.waitFor();
      assert.equal(await page.evaluate(() => scrollY), before.y, 'opening navigation moved the feed');
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => scrollY), before.y, 'closing navigation moved the feed');
      await create.click(); await menu.getByRole('link', { name: /^Post / }).click();
      const dialog = page.getByRole('dialog', { name: 'New post', exact: true }); await dialog.waitFor();
      const rect = await dialog.boundingBox(); await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await wheel(page, 'composer background lock', 500, 3, 3, true);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      const after = await page.evaluate(() => ({ y: scrollY, width: document.documentElement.clientWidth }));
      assert.deepEqual(after, before, 'composer close changed scroll position or page width');
      await page.mouse.move(770, 650); await wheel(page, 'wheel after composer close', 120, 3, 3);
    });
    await check('Home navigation restores the loaded long feed while its refresh is pending', async () => {
      const before = await page.evaluate(() => { window.__scrollFixture.holdRefresh(); return { y: scrollY, count: document.querySelectorAll('[data-feed-content] [data-pid]').length }; });
      await page.getByRole('link', { name: 'Messages', exact: true }).first().click(); await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Home', exact: true }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('[data-feed-content] [data-pid]').length === 36); await turns(page, 24);
      const pending = await page.evaluate(() => ({ y: scrollY, count: document.querySelectorAll('[data-feed-content] [data-pid]').length }));
      const navigationTrace = { label: 'navigation restoration', before, pending }; traces.push(navigationTrace);
      assert.deepEqual(pending, before, 'returning Home lost retained content or scroll position');
      await page.evaluate(() => window.__scrollFixture.release()); await turns(page, 24);
      const after = await page.evaluate(() => ({ y: scrollY, count: document.querySelectorAll('[data-feed-content] [data-pid]').length }));
      navigationTrace.after = after; assert.deepEqual(after, before, 'background refresh moved the restored feed');
    });
    await check('Late poll and quote responses preserve the viewport throughout warm navigation', async () => {
      const fixture = await page.evaluate(() => ({ quote: window.__scrollFixture.quotedContent, poll: window.__scrollFixture.pollLabel }));
      await page.getByText(fixture.quote, { exact: true }).waitFor();
      await page.getByRole('button', { name: fixture.poll, exact: true }).waitFor(); await turns(page, 4);
      const before = await page.evaluate(() => {
        const anchor = [...document.querySelectorAll('[data-feed-content] [data-pid]')].find(card => card.getBoundingClientRect().top >= 0);
        const frame = anchor.querySelector('.media-frame').getBoundingClientRect();
        return { y: scrollY, anchor: anchor.getAttribute('data-pid'), anchorTop: anchor.getBoundingClientRect().top,
          mediaTop: frame.top, mediaLeft: frame.left, documentHeight: document.documentElement.scrollHeight,
          readStart: window.__scrollFixture.holdAsyncBlocks() };
      });
      await page.getByRole('link', { name: 'Messages', exact: true }).first().click(); await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
      await page.evaluate(before => {
        const probe = { frames: [], phase: 'held', stopped: false };
        const snapshot = () => {
          const fixture = window.__scrollFixture;
          const card = document.querySelector(`[data-pid="${before.anchor}"]`), media = card?.querySelector('.media-frame')?.getBoundingClientRect();
          const quote = document.querySelector(`[data-async-block="quote:${fixture.quotedSourceId}"]`);
          const poll = document.querySelector('[data-async-block="poll:20000000-0000-4000-8000-000000000005"]');
          return { y: scrollY, count: document.querySelectorAll('[data-feed-content] [data-pid]').length,
            anchorTop: card?.getBoundingClientRect().top ?? null, mediaTop: media?.top ?? null, mediaLeft: media?.left ?? null,
            documentHeight: document.documentElement.scrollHeight, quoteState: quote?.getAttribute('data-async-state') ?? null,
            pollState: poll?.getAttribute('data-async-state') ?? null, quoteHeight: quote?.getBoundingClientRect().height ?? null,
            pollHeight: poll?.getBoundingClientRect().height ?? null,
            quoteContentVisible: !![...document.querySelectorAll(`[href="/post/${fixture.quotedSourceId}"]`)].find(link => link.textContent.includes(fixture.quotedContent)),
            pollContentVisible: !![...document.querySelectorAll('[data-pid="20000000-0000-4000-8000-000000000005"] button')].find(button => button.textContent === fixture.pollLabel) };
        };
        const sample = t => {
          if (probe.stopped) return;
          if (location.pathname === '/home' && document.querySelector('[data-feed-content]')) probe.frames.push({ t, phase: probe.phase, ...snapshot() });
          probe.frame = requestAnimationFrame(sample);
        };
        probe.snapshot = snapshot; probe.frame = requestAnimationFrame(sample); window.__lateAsyncProbe = probe;
      }, before);
      await page.getByRole('link', { name: 'Home', exact: true }).first().click();
      await page.waitForFunction(start => ['poll', 'quote'].every(kind => window.__scrollFixture.asyncReads.slice(start).some(read => read.kind === kind && read.held && !read.finished)), before.readStart);
      await turns(page, 24); const held = await page.evaluate(() => window.__lateAsyncProbe.snapshot());
      await page.evaluate(() => { window.__lateAsyncProbe.phase = 'poll released'; window.__scrollFixture.releaseAsyncBlock('poll'); });
      await page.getByRole('button', { name: fixture.poll, exact: true }).waitFor(); await turns(page, 24);
      const pollReleased = await page.evaluate(() => window.__lateAsyncProbe.snapshot());
      await page.evaluate(() => { window.__lateAsyncProbe.phase = 'quote released'; window.__scrollFixture.releaseAsyncBlock('quote'); });
      await page.getByText(fixture.quote, { exact: true }).waitFor(); await turns(page, 24);
      const after = await page.evaluate(() => window.__lateAsyncProbe.snapshot());
      const frames = await page.evaluate(() => { const probe = window.__lateAsyncProbe; probe.stopped = true; cancelAnimationFrame(probe.frame); return probe.frames; });
      const reads = await page.evaluate(start => window.__scrollFixture.asyncReads.slice(start), before.readStart);
      traces.push({ label: 'late poll and quote navigation', before, held, pollReleased, after, reads, frames });
      assert.ok(frames.length >= 72, 'late-response check did not observe the held and resolved phases');
      for (const frame of frames) {
        assert.equal(frame.count, 36, 'late-response navigation replaced retained feed rows');
        for (const property of ['y', 'anchorTop', 'mediaTop', 'mediaLeft', 'documentHeight']) {
          assert.ok(frame[property] !== null && Math.abs(frame[property] - before[property]) <= 1,
            `${frame.phase}: ${property} changed from ${before[property]} to ${frame[property]} while a quote or poll reloaded`);
        }
      }
      assert.equal(held.quoteState, 'pending'); assert.equal(held.pollState, 'pending');
      assert.ok(held.quoteHeight > 0 && held.pollHeight > 0, 'pending blocks did not reserve their measured space');
      assert.equal(held.quoteContentVisible, false, 'pending quote exposed old source content');
      assert.equal(held.pollContentVisible, false, 'pending poll exposed old authorized options');
      assert.equal(pollReleased.pollContentVisible, true); assert.equal(pollReleased.quoteContentVisible, false);
      assert.equal(after.pollContentVisible, true); assert.equal(after.quoteContentVisible, true);
      assert.ok(reads.some(read => read.kind === 'poll' && read.held && read.finished) && reads.some(read => read.kind === 'quote' && read.held && read.finished), 'authorized async reads did not finish independently');
    });
    await check('App-wide media viewer locks the background without moving the visible feed frame', async () => {
      const before = await page.evaluate(() => {
        const card = [...document.querySelectorAll('[data-pid]')].find(card => card.getBoundingClientRect().top >= 0);
        const frame = card.querySelector('.media-frame').getBoundingClientRect();
        return { id: card.getAttribute('data-pid'), y: scrollY, left: frame.left, top: frame.top, width: frame.width, height: frame.height, overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
      });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('pc-view-media', { detail: { url: '/coast.svg' } })));
      const viewer = page.getByRole('dialog', { name: 'Media viewer', exact: true }); await viewer.waitFor(); await turns(page, 4);
      const opened = await page.evaluate(before => {
        const frame = document.querySelector(`[data-pid="${before.id}"] .media-frame`).getBoundingClientRect();
        return { y: scrollY, left: frame.left, top: frame.top, width: frame.width, height: frame.height, overflow: document.body.style.overflow };
      }, before);
      assert.equal(opened.overflow, 'hidden');
      for (const property of ['y', 'left', 'top', 'width', 'height']) assert.ok(Math.abs(opened[property] - before[property]) <= 1, `media viewer changed ${property}`);
      await page.mouse.move(4, 500); await wheel(page, 'media viewer background lock', 360, 3, 2, true);
      await page.keyboard.press('Escape'); await viewer.waitFor({ state: 'hidden' }); await turns(page, 4);
      const after = await page.evaluate(() => ({ y: scrollY, overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight }));
      assert.deepEqual(after, { y: before.y, overflow: before.overflow, paddingRight: before.paddingRight });
      traces.push({ label: 'media viewer geometry', before, opened, after });
    });
    await check('Reduced-motion preference keeps native wheel input and disables smooth CSS scrolling', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.mouse.move(770, 650);
      const trace = await wheel(page, 'reduced-motion wheel', 120, 5, 3); assert.equal(trace.htmlBehavior, 'auto');
    });
    await check('Legacy quote media retains safe geometry while grants are pending or denied', async () => {
      // Keep the source thumbnail near the viewport so Chromium also decodes the
      // locally fulfilled capability. Its canonical private URL is never served.
      await page.mouse.move(770, 650);
      const target = await page.locator(`[data-pid="${id(7)}"]`).evaluate(card => card.getBoundingClientRect().top - 420);
      await page.mouse.wheel(0, Math.round(target)); await turns(page, 24);
      const fixture = await page.evaluate(() => ({ source: window.__scrollFixture.quotedSourceId, content: window.__scrollFixture.quotedContent }));
      const quoteSelector = `[data-async-block="quote:${fixture.source}"]`;
      await page.locator(quoteSelector + ' img').evaluate(image => image.decode());
      const before = await page.evaluate(anchorId => {
        const card = document.querySelector(`[data-pid="${anchorId}"]`), media = card.querySelector('.media-frame').getBoundingClientRect();
        return { anchor: anchorId, y: scrollY, anchorTop: card.getBoundingClientRect().top, mediaTop: media.top, mediaLeft: media.left, documentHeight: document.documentElement.scrollHeight };
      }, id(7));
      await page.evaluate(before => {
        const probe = { startedAt: performance.now(), frames: [], scrollCalls: [], scrollEvents: [], phase: 'initial', stopped: false };
        const snapshot = () => {
          const fixture = window.__scrollFixture, card = document.querySelector(`[data-pid="${before.anchor}"]`), media = card?.querySelector('.media-frame')?.getBoundingClientRect();
          const quote = document.querySelector(`[data-async-block="quote:${fixture.quotedSourceId}"]`), thumbnail = quote?.querySelector('[role="img"]');
          const thumbnailBox = thumbnail?.getBoundingClientRect();
          const poll = document.querySelector('[data-async-block="poll:20000000-0000-4000-8000-000000000005"]');
          return { y: scrollY, anchorTop: card?.getBoundingClientRect().top ?? null, mediaTop: media?.top ?? null, mediaLeft: media?.left ?? null,
            documentHeight: document.documentElement.scrollHeight, quoteState: quote?.getAttribute('data-async-state') ?? null,
            quoteHeight: quote?.getBoundingClientRect().height ?? null, thumbnailLabel: thumbnail?.getAttribute('aria-label') ?? null,
            thumbnailWidth: thumbnailBox?.width ?? null, thumbnailHeight: thumbnailBox?.height ?? null,
            imageSources: [...(quote?.querySelectorAll('img') ?? [])].map(image => image.getAttribute('src')),
            rawPrivateUrlInDom: document.documentElement.outerHTML.includes(fixture.legacyOriginal),
            sourceContentVisible: quote?.textContent.includes(fixture.quotedContent) ?? false,
            documentClientWidth: document.documentElement.clientWidth, innerWidth,
            bodyOverflow: document.body.style.overflow, bodyPaddingRight: document.body.style.paddingRight,
            quoteTop: quote?.getBoundingClientRect().top ?? null, quoteLinkTop: quote?.querySelector('a')?.getBoundingClientRect().top ?? null,
            pollHeight: poll?.getBoundingClientRect().height ?? null, pollState: poll?.getAttribute('data-async-state') ?? null,
            pollDisplay: poll ? getComputedStyle(poll).display : null, pollInlineHeight: poll?.style.height ?? null,
            pollTop: poll?.getBoundingClientRect().top ?? null,
            pollChildMarginTop: poll?.firstElementChild ? getComputedStyle(poll.firstElementChild).marginTop : null,
            pollChildHeight: poll?.firstElementChild?.getBoundingClientRect().height ?? null,
            pollChildTop: poll?.firstElementChild?.getBoundingClientRect().top ?? null,
            firstMediaFrames: [...document.querySelectorAll('[data-feed-content] [data-pid]')].slice(0, 8).map(card => {
              const frame = card.querySelector('.media-frame')?.getBoundingClientRect();
              return { id: card.getAttribute('data-pid'), width: frame?.width ?? null, height: frame?.height ?? null, top: frame?.top ?? null };
            }) };
        };
        const sample = t => {
          if (probe.stopped) return;
          if (location.pathname === '/home' && document.querySelector('[data-feed-content]')) probe.frames.push({ t, phase: probe.phase, ...snapshot() });
          probe.frame = requestAnimationFrame(sample);
        };
        const scrollTo = window.scrollTo;
        probe.restoreScrollTo = () => { window.scrollTo = scrollTo; };
        window.scrollTo = function (...args) {
          const call = { phase: probe.phase, before: scrollY, args };
          const result = scrollTo.apply(window, args); call.after = scrollY; probe.scrollCalls.push(call); return result;
        };
        probe.onScroll = () => { if (location.pathname === '/home') probe.scrollEvents.push({ phase: probe.phase, y: scrollY }); };
        window.addEventListener('scroll', probe.onScroll, { passive: true });
        probe.snapshot = snapshot; probe.frame = requestAnimationFrame(sample); window.__legacyGrantProbe = probe;
      }, before);
      const phases = [];
      for (const denied of [false, true]) {
        const start = await page.evaluate(denied => window.__scrollFixture.holdLegacyGrant(denied), denied);
        await page.getByRole('link', { name: 'Messages', exact: true }).first().click(); await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
        await page.evaluate(denied => { window.__legacyGrantProbe.phase = denied ? 'denial pending' : 'grant pending'; }, denied);
        await page.getByRole('link', { name: 'Home', exact: true }).first().click();
        await page.waitForFunction(start => window.__scrollFixture.grantReads.slice(start).some(read => read.held && !read.finished), start);
        await turns(page, 24); const pending = await page.evaluate(() => window.__legacyGrantProbe.snapshot());
        await page.evaluate(denied => { window.__legacyGrantProbe.phase = denied ? 'grant denied' : 'grant delivered'; window.__scrollFixture.releaseLegacyGrant(); }, denied);
        await page.waitForFunction(start => window.__scrollFixture.grantReads.slice(start).some(read => read.held && read.finished), start);
        if (!denied) {
          await page.waitForFunction(selector => document.querySelector(selector + ' img')?.getAttribute('src') === window.__scrollFixture.legacyGranted, quoteSelector);
          await page.locator(quoteSelector + ' img').evaluate(image => image.decode());
        }
        await turns(page, 24); const resolved = await page.evaluate(() => window.__legacyGrantProbe.snapshot());
        phases.push({ denied, pending, resolved, reads: await page.evaluate(start => window.__scrollFixture.grantReads.slice(start), start) });
      }
      const sampled = await page.evaluate(() => {
        const probe = window.__legacyGrantProbe; probe.stopped = true; cancelAnimationFrame(probe.frame);
        probe.restoreScrollTo(); window.removeEventListener('scroll', probe.onScroll);
        return { frames: probe.frames, scrollCalls: probe.scrollCalls, scrollEvents: probe.scrollEvents };
      });
      const { frames } = sampled;
      const trace = { label: 'legacy quote grant geometry', before, phases, ...sampled }; traces.push(trace);
      assert.ok(frames.length >= 96, 'legacy grant check did not sample pending and resolved phases');
      for (const frame of frames) {
        assert.equal(frame.rawPrivateUrlInDom, false, 'canonical private media URL entered the DOM');
        for (const property of ['y', 'anchorTop', 'mediaTop', 'mediaLeft', 'documentHeight']) {
          assert.ok(frame[property] !== null && Math.abs(frame[property] - before[property]) <= 1,
            `${frame.phase}: ${property} changed from ${before[property]} to ${frame[property]} during the legacy media grant`);
        }
      }
      for (const phase of phases) {
        assert.equal(phase.pending.quoteState, 'ready', 'source authorization was still pending instead of only the media grant');
        assert.equal(phase.pending.sourceContentVisible, true);
        assert.equal(phase.pending.thumbnailLabel, 'Photo from original post');
        assert.equal(phase.pending.thumbnailWidth, 56); assert.equal(phase.pending.thumbnailHeight, 56);
        assert.deepEqual(phase.pending.imageSources, [], 'pending grant showed old or raw media pixels');
        assert.equal(phase.resolved.thumbnailLabel, 'Photo from original post');
        assert.deepEqual(phase.resolved.imageSources, phase.denied ? [] : [legacyGranted]);
        assert.ok(phase.reads.some(read => read.held && read.finished && read.authorizationPinned && read.denied === phase.denied));
      }
      assert.ok(!requests.some(request => request.path === legacyOriginal), 'browser requested a canonical private media URL');
      // A new authorized source row without media must clear the type placeholder;
      // a genuinely missing source must clear the entire block, not reuse old data.
      const freshSources = [];
      for (const mode of ['text', 'missing']) {
        await page.evaluate(mode => window.__scrollFixture.setQuoteMode(mode), mode);
        await page.getByRole('link', { name: 'Messages', exact: true }).first().click(); await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
        await page.getByRole('link', { name: 'Home', exact: true }).first().click();
        await page.waitForFunction(({ selector, state }) => document.querySelector(selector)?.getAttribute('data-async-state') === state, { selector: quoteSelector, state: mode === 'text' ? 'ready' : 'empty' });
        await turns(page, 12); const result = await page.evaluate(() => window.__legacyGrantProbe.snapshot()); freshSources.push({ mode, ...result });
        assert.equal(result.thumbnailLabel, null); assert.deepEqual(result.imageSources, []); assert.equal(result.rawPrivateUrlInDom, false);
        assert.equal(result.sourceContentVisible, mode === 'text');
        if (mode === 'missing') assert.equal(result.quoteHeight, 0, 'missing source kept its old reserved block');
      }
      trace.freshSources = freshSources;
    });
    assert.deepEqual(errors, [], 'browser runtime errors');
    await page.screenshot({ path: path.join(artifacts, 'long-feed-after-wheel.png') });
  } catch (error) { failure = error; }
  finally {
    release('image'); release('video');
    const finalHashes = await sourceHashes();
    const changedInputs = sourceFiles.filter(file => hashes[file] !== finalHashes[file]);
    if (changedInputs.length && !failure) failure = new Error('Source files changed after browser fixture compilation: ' + changedInputs.join(', '));
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({
      scope: 'Actual production HomeFeed, PostCard, PollCard, quote preview, chrome, MediaGallery, VideoPlayer, composer and Messages. Synthetic Auth/data/router; local HTTP SVG and range-served H.264. Real Playwright mouse.wheel events and per-frame visible-anchor measurements through held poll/quote responses. Frame intervals are local development-fixture main-thread responsiveness evidence, not production GPU/device benchmarks or physical mouse hardware.',
      executablePath, chromiumVersion: browser.version(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), hashes, changedInputs,
      checks, traces, errors, requests, failure: failure?.stack || null,
    }, null, 2));
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure;
  console.log(JSON.stringify({ checks: checks.length, artifacts }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
