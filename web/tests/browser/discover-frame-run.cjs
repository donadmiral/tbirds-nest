/** Actual Discover tiles and real decoded video frames; synthetic session and local no-store video bytes on a second origin, so cross-origin rules are the real ones. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('../../node_modules/playwright');
const { compile } = require('./ui-compile.cjs');
const root = path.resolve(__dirname, '../../..');
const output = process.env.DISCOVER_FRAME_OUTPUT || '/tmp/platinum-web-discover-frames';
const evidence = process.env.DISCOVER_FRAME_EVIDENCE || '/tmp/platinum-web-discover-frames-evidence';
const checks = [], requests = [];
const COLOURS = { red: 'red', blue: 'blue', green: 'green', sealed: 'magenta', far: 'yellow', slow: 'cyan' };
const serve = (bytes, req, res, cors) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end) { res.writeHead(416, { ...cors, 'Content-Range': `bytes */${bytes.length}` }); res.end(); return; }
  res.writeHead(range ? 206 : 200, { ...cors, 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
  res.end(bytes.subarray(start, end + 1));
};
async function main() {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(evidence, { recursive: true });
  for (const [name, colour] of Object.entries(COLOURS)) await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', name==='red' ? 'color=c=red:s=160x120:r=24:d=0.375[a];color=c=blue:s=160x120:r=24:d=3.625[b];[a][b]concat=n=2:v=1:a=0' : name==='green' ? 'color=c=red:s=160x120:r=24:d=1.5[a];color=c=green:s=160x120:r=24:d=2.5[b];[a][b]concat=n=2:v=1:a=0' : `color=c=${colour}:s=160x120:r=24`, '-t', '4', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, name + '.mp4')], { timeout: 20000 });
  const media = http.createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname);
    const firstSlow=name==='slow.mp4' && req.method==='GET' && !requests.some(x=>x.name===name);
    requests.push({ name, range: req.headers.range || null });
    if(firstSlow)await new Promise(resolve=>setTimeout(resolve,12_500));
    // the sealed clip is served without cross-origin headers: a browser may play it but may not read its pixels
    const cors = name === 'sealed.mp4' ? {} : { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range, if-range', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (!name.endsWith('.mp4')) { res.writeHead(404, cors); res.end(); return; }
    serve(await fs.readFile(path.join(output, name)), req, res, cors);
  });
  await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
  const mediaOrigin = `http://127.0.0.1:${media.address().port}`;
  const adapter = path.join(__dirname, 'discover-frame-adapter.ts');
  await compile({ entry: path.join(__dirname, 'discover-frame-fixture.tsx'), output, aliases: { '@/lib/supabase/client': adapter, [path.join(root, 'web/lib/supabase/client.ts')]: adapter }, environment: { FIXTURE_MEDIA_ORIGIN: mediaOrigin }, title: 'Discover video stills verification' });
  const pages = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try { const file = pathname === '/' || !path.extname(pathname) ? 'index.html' : path.basename(pathname); const data = await fs.readFile(path.join(output, file)); res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => pages.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  // the missing cover and the sealed clip are meant to fail at the network; every other console error and any page error is a failure of the components
  const expected = text => /missing-cover\.jpg|sealed\.mp4|status of 404|net::ERR_FAILED/.test(text);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && !expected(message.text())) errors.push(message.text()); });
  let failure;
  try {
    await page.goto(`http://127.0.0.1:${pages.address().port}/discover`);
    const frame = async tile => {
      const image = page.locator(`[data-tile="${tile}"] img[data-video-frame="ready"]`);
      await image.waitFor({ timeout: 30000 });
      const src = await image.getAttribute('src');
      assert.ok(src.startsWith('data:image/jpeg'), tile + ' shows a decoded JPEG frame');
      return page.evaluate(async source => { const picture = new Image(); picture.src = source; await picture.decode(); const canvas = document.createElement('canvas'); canvas.width = picture.width; canvas.height = picture.height; const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0); const [r, g, b] = context.getImageData(Math.floor(picture.width / 2), Math.floor(picture.height / 2), 1, 1).data; return { r, g, b, width: picture.width, height: picture.height }; }, src);
    };
    const red = await frame('red');
    assert.ok(red.r > 170 && red.g < 90 && red.b < 90, 'the red clip gives a red frame: ' + JSON.stringify(red));
    assert.equal(await page.locator('[data-tile="red"]').getByText('Video', { exact: true }).count(), 0, 'the placeholder label is gone');
    assert.equal(await page.locator('[data-tile="red"] span.absolute.right-2.top-2 svg').count(), 1, 'the play chip stays');
    checks.push('A video without a stored cover shows a real decoded frame of itself in the Discover tile, with the play chip unchanged');
    const blue = await frame('blue');
    assert.ok(blue.b > 170 && blue.r < 90, 'a cover the browser cannot load falls back to a decoded frame: ' + JSON.stringify(blue));
    checks.push('A stored cover that no longer loads falls back to a decoded frame instead of a broken image');
    const green = await frame('green');
    assert.ok(green.g > 100 && green.r < 60 && green.b < 60, 'the author trim start is honoured for the frame moment: ' + JSON.stringify(green));
    checks.push('The frame is taken at the author\'s chosen moment when the recipe has one');
    const native=page.locator('[data-tile="sealed"] video[data-video-frame="native"]');await native.waitFor({timeout:30000});
    const picture=await native.evaluate(v=>({w:v.videoWidth,h:v.videoHeight,at:v.currentTime,paused:v.paused,muted:v.muted,auto:v.autoplay}));
    assert.ok(picture.w>0&&picture.h>0&&picture.paused&&picture.muted&&!picture.auto&&Math.abs(picture.at-2)<.1);
    await page.waitForTimeout(350);assert.equal(await native.evaluate(v=>v.currentTime),picture.at);
    checks.push('A display-only cross-origin clip shows an actual paused, muted native picture at the authored trim without reading a canvas');
    const slow=await frame('slow');assert.ok(slow.g>150 && slow.b>150);
    checks.push('A 12.5-second metadata request still decodes its first picture');
    assert.equal(requests.filter(r => r.name === 'far.mp4').length, 0, 'a tile far below the fold has fetched nothing');
    await page.evaluate(() => window.__frameFixture.dataSaver(true));
    await page.locator('[data-tile="far"]').scrollIntoViewIfNeeded();
    await page.locator('[data-tile="far"] [data-video-frame="idle"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    assert.equal(requests.filter(r => r.name === 'far.mp4').length, 0, 'data saver fetches no video bytes for a still');
    checks.push('A tile fetches nothing until it comes near the screen, and nothing at all under data saver');
    await page.evaluate(() => window.__frameFixture.dataSaver(false));
    const far = await frame('far');
    assert.ok(far.r > 170 && far.g > 150 && far.b < 90, 'turning data saver off decodes the frame: ' + JSON.stringify(far));
    checks.push('Turning data saver off decodes the waiting frame');
    const before = await page.evaluate(() => window.__frameFixture.decodes);
    await page.locator('[data-tile="red"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.__frameFixture.session('fixture-b', 'session-b'));
    await page.locator('[data-tile="red"] span[data-video-frame]').waitFor({ timeout: 10000 });
    checks.push('A change of signed-in person forgets every frame at once');
    await page.locator('[data-tile="red"] img[data-video-frame="ready"]').waitFor({ timeout: 30000 });
    assert.ok(await page.evaluate(() => window.__frameFixture.decodes) > before, 'the frame is decoded afresh for the new session rather than recalled');
    checks.push('A change of signed-in person forgets every frame and decodes again for the new session');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(evidence, 'discover-frames.png') });
  } catch (error) { failure = error; await page.screenshot({ path: path.join(evidence, 'discover-frames-failure.png') }).catch(() => {}); }
  finally {
    await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify({ checks, errors, requests: requests.length, failure: failure?.stack || null, scope: 'Actual DiscoverTile and VideoFrame components with a synthetic session and local H.264 clips on a second origin. Does not validate hosted media delivery.' }, null, 2));
    await browser.close(); media.closeAllConnections(); pages.closeAllConnections();
    await new Promise(resolve => media.close(resolve)); await new Promise(resolve => pages.close(resolve));
  }
  if (failure) throw failure;
  console.log(JSON.stringify({ checks: checks.length, evidence }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
