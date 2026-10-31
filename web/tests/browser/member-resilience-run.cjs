const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const os = require('node:os');
const { chromium } = require('playwright');
const { compile } = require('./ui-compile.cjs');

const output = process.env.PLATINUM_MEMBER_ARTIFACTS || '/tmp/platinum-member-resilience';
const baseline = process.env.PLATINUM_MEMBER_BASELINE === '1';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=', 'base64');
const cases = [];
function test(name, route, mode, target, run, options = {}) { cases.push({ name, route, mode, target, run, ...options }); }
async function visible(page, text) { await page.getByText(text, { exact: typeof text === 'string' }).first().waitFor({ state: 'visible' }); }
async function restore(page) { await page.evaluate(() => { window.__memberResilience.mode = 'normal'; }); }
async function retry(page) { await restore(page); await page.getByRole('button', { name: /Try again|Retry/, exact: false }).first().click(); }
async function wordsPresent(page) { await visible(page, 'existing'); }

for (const kind of ['hidden', 'muted']) {
  const route = '/settings/' + kind + '-words', field = kind + '_words';
  for (const mode of ['normal', 'resolved', 'rejected']) test(kind + ' words initial ' + mode + ' and successful add', route, mode, 'table:profiles:read', async page => {
    if (mode !== 'normal') {
      await visible(page, /could not load/i);
      assert.equal(await page.getByPlaceholder('Add a word or phrase').isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Add', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__memberResilience.requests.filter(r => r.action === 'update').length), 0);
      await retry(page);
    }
    await wordsPresent(page);
    await page.getByPlaceholder('Add a word or phrase').fill('newword');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await visible(page, 'newword');
    assert.deepEqual(await page.evaluate(field => window.__memberResilience.words[field], field), ['existing', 'newword']);
    assert.equal(await page.getByPlaceholder('Add a word or phrase').inputValue(), '');
  }, { regression: mode !== 'normal' });
  for (const mode of ['resolved', 'rejected']) test(kind + ' words mutation ' + mode + ' preserves draft and retry', route, 'normal', '', async page => {
    await wordsPresent(page);
    await page.evaluate(({ mode }) => { window.__memberResilience.mode = mode; window.__memberResilience.target = 'table:profiles:update'; }, { mode });
    await page.getByPlaceholder('Add a word or phrase').fill('newword'); await page.getByRole('button', { name: 'Add', exact: true }).click();
    await visible(page, /Controlled request|could not save/i);
    assert.equal(await page.getByPlaceholder('Add a word or phrase').inputValue(), 'newword');
    assert.deepEqual(await page.evaluate(field => window.__memberResilience.words[field], field), ['existing']);
    await restore(page); await page.getByRole('button', { name: 'Add', exact: true }).click(); await visible(page, 'newword');
  }, { regression: true });
}

const reads = [
  ['standing', '/settings/standing', 'table:member_strikes', /Good standing/, /could not load.*standing/i],
  ['Explore', '/explore', 'rpc:get_feed', 'Explore', /could not load.*explore/i],
  ['topic', '/topic/CoastalStories', 'table:posts', 'Existing promotion #CoastalStories', /could not load.*topic/i],
  ['Search topics', '/search', 'rpc:get_trending_topics', /#CoastalStories/, /trending topics could not load/i],
  ['featured channels', '/discover/channels-fixture', 'rpc:get_channels', 'Featured channels', /channels could not load/i],
  ['Discover topics', '/discover/topics-fixture', 'rpc:get_trending_topics', 'Explore by topic', /topics could not load/i],
  ['Market availability', '/market/new', 'table:feature_flags', 'New listing', /market availability could not/i],
];
for (const [name, route, target, good, failed] of reads) for (const mode of ['normal', 'resolved', 'rejected']) test(name + ' ' + mode + ' with retry', route, mode, target, async page => {
  if (mode !== 'normal') {
    await visible(page, failed);
    if (name === 'standing') assert.equal(await page.getByText(/Good standing|No strikes/).count(), 0);
    if (name === 'topic') assert.equal(await page.getByText('No posts with this topic yet.', { exact: true }).count(), 0);
    await retry(page);
  }
  await visible(page, good);
}, { regression: mode !== 'normal' });

for (const mode of ['normal', 'resolved', 'rejected']) test('Market inbox count ' + mode + ' and next-poll recovery', '/market/unread-fixture', mode, 'table:conversations', async page => {
  if (mode !== 'normal') {
    await page.getByLabel('Message count unavailable', { exact: true }).waitFor({ state: 'visible' });
    await restore(page); await page.clock.fastForward(30000);
    await page.getByLabel('Message count unavailable', { exact: true }).waitFor({ state: 'hidden' });
  } else await visible(page, /Messages/);
}, { regression: mode !== 'normal', clock: true });

async function fillListing(page) {
  await page.getByPlaceholder('Title', { exact: true }).fill('Audit ceramic mug');
  await page.getByPlaceholder('Price. Use 0 for free').fill('20');
  await page.locator('input[type=file]').setInputFiles({ name: 'audit.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Share to feed', { exact: true }).uncheck();
}
for (const target of ['storage:market-media', 'table:marketplace_listings:insert']) for (const mode of ['normal', 'resolved', 'rejected']) test('Listing ' + target + ' ' + mode + ' then successful submit', '/market/new', mode, target, async page => {
  await fillListing(page); await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  if (mode !== 'normal') {
    await visible(page, /Controlled request|could not publish/i);
    assert.equal(await page.getByRole('button', { name: 'Publish listing', exact: true }).isEnabled(), true);
    assert.equal(await page.getByPlaceholder('Title', { exact: true }).inputValue(), 'Audit ceramic mug');
    await restore(page); await page.getByRole('button', { name: 'Publish listing', exact: true }).click();
  }
  await visible(page, /Synthetic destination: \/market\//);
}, { regression: mode === 'rejected' });

for (const mode of ['normal', 'resolved', 'rejected']) test('Business creation ' + mode + ' then successful retry', '/businesses/new', mode, 'function:create-business', async page => {
  await page.getByPlaceholder('Pearl Group', { exact: true }).fill('Audit business');
  await page.getByPlaceholder('pearlgroup', { exact: true }).fill('auditbusiness');
  await page.getByRole('button', { name: 'Technology', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  if (mode !== 'normal') {
    await visible(page, /Controlled request|could not create/i);
    assert.equal(await page.getByRole('button', { name: 'Create', exact: true }).isEnabled(), true);
    await restore(page); await page.getByRole('button', { name: 'Create', exact: true }).click();
  }
  await visible(page, 'Synthetic destination: /auditbusiness');
}, { regression: mode === 'rejected' });

for (const mode of ['normal', 'resolved', 'rejected']) test('Promotion picker ' + mode + ' and content retry', '/ads/new', mode, 'table:posts', async page => {
  await page.getByRole('button', { name: 'Get more views', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  if (mode !== 'normal') { await visible(page, /could not load.*content|Controlled request/i); await retry(page); }
  await visible(page, 'Existing promotion #CoastalStories');
}, { regression: mode !== 'normal' });

for (const width of [390, 1440]) test('Profile cover pointer path at ' + width, '/settings/profile', 'normal', '', async page => {
  const button = page.getByRole('button', { name: 'Change cover', exact: true });
  await button.waitFor();
  const ownsCenter = await button.evaluate(element => { const b = element.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return hit === element || element.contains(hit); });
  assert.equal(ownsCenter, true, 'Change cover center must not be intercepted by the photo row');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles([]);
}, { regression: true, width });

require('./word-preferences-deadline-cases.cjs')({ test, visible, wordsPresent });

async function main() {
  await fs.mkdir(output, { recursive: true });
  const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'platinum-member-resilience-'));
  let entry = path.join(__dirname, 'member-resilience-fixture.tsx');
  const baselineRoot = process.env.PLATINUM_MEMBER_BASELINE_ROOT;
  if (baselineRoot) {
    const source = (await fs.readFile(entry, 'utf8'))
      .replace(/from '(\.\.\/\.\.\/[^']+)'/g, (_all, relative) => 'from ' + JSON.stringify(path.resolve(baselineRoot, 'web/tests/browser', relative)))
      .replace("import './member-resilience-backend';", 'import ' + JSON.stringify(path.join(__dirname, 'member-resilience-backend.ts')) + ';');
    entry = path.join(bundle, 'baseline-entry.tsx'); await fs.writeFile(entry, source);
  }
  await compile({ entry, output: bundle,
    aliases: { '@/lib/supabase/client': path.join(__dirname, 'member-resilience-backend.ts'), './supabase/client': path.join(__dirname, 'member-resilience-backend.ts'),
      ...(process.env.PLATINUM_WORD_PREFERENCES_SOURCE ? { '@/lib/useWordPreferences': process.env.PLATINUM_WORD_PREFERENCES_SOURCE } : {}) } });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { res.end(); return; }
    const file = /\.(js|css)$/.test(pathname) ? pathname.slice(1) : 'index.html';
    const target = path.resolve(bundle, file);
    if (!target.startsWith(bundle + '/')) { res.writeHead(400); res.end(); return; }
    try { res.setHeader('content-type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await fs.readFile(target)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  try {
    for (const item of cases.filter(item => process.env.PLATINUM_MEMBER_FOCUS === 'word-write' ? item.wordDeadline : !baseline || item.regression)) {
      const context = await browser.newContext({ viewport: { width: item.width || 1440, height: 1000 }, reducedMotion: 'reduce' });
      const errors = [], blocked = [];
      await context.route('**/*', request => { const url = new URL(request.request().url()); if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return request.continue(); blocked.push(url.origin + url.pathname); return request.abort(); });
      const page = await context.newPage(); page.setDefaultTimeout(2000);
      page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.dismiss());
      if (item.clock) await page.clock.install();
      const record = { name: item.name, route: item.route, mode: item.mode, target: item.target };
      try {
        await page.goto(origin + item.route + '?' + new URLSearchParams({ mode: item.mode, target: item.target }), { waitUntil: 'domcontentloaded' });
        await page.locator('[data-member-resilience]').waitFor({ state: 'attached' });
        await item.run(page);
        assert.deepEqual(errors, [], 'No uncaught request rejection');
        record.status = 'PASS';
      } catch (error) { record.status = 'FAIL'; record.error = String(error); }
      record.pageErrors = errors; record.blockedExternalRequests = blocked;
      record.observed = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText, requests: window.__memberResilience.requests, words: window.__memberResilience.words }));
      if (record.status === 'FAIL' || item.width) {
        record.screenshot = item.name.replace(/[^a-zA-Z0-9]/g, '-') + '.png';
        await page.screenshot({ path: path.join(output, record.screenshot), fullPage: true });
      }
      results.push(record); console.log(JSON.stringify({ name: record.name, status: record.status, error: record.error?.split('\n')[0] }));
      await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify({ runtime: await browser.version(), baseline, baselineRoot: baselineRoot || null, scope: 'Actual member web components with synthetic Auth/database/storage/functions and Next routing adapters. No hosted/provider acceptance or real mutations.', cases: results }, null, 2) + '\n');
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const failures = results.filter(result => result.status === 'FAIL');
  console.log(JSON.stringify({ cases: results.length, passed: results.length - failures.length, failed: failures.length, output }));
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
