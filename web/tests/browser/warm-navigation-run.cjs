/** Focused existing Home/Messages frame probe plus real browser history traversal. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../../node_modules/playwright');
const { compile } = require('./ui-compile.cjs');
const { runWarmNavigation } = require('./social-navigation.cjs');

const output = process.env.PLATINUM_NAVIGATION_OUTPUT || '/tmp/platinum-warm-navigation-browser';
const artifacts = process.env.PLATINUM_NAVIGATION_ARTIFACTS || '/tmp/platinum-warm-navigation-evidence';
const coast = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720"><rect width="1200" height="720" fill="#8aa9bb"/><text x="40" y="80" font-family="Arial" font-size="24">Synthetic navigation fixture media</text></svg>';

async function checkHistory(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__historyDocument = crypto.randomUUID();
    window.__historyEvents = [];
    window.addEventListener('popstate', event => window.__historyEvents.push({
      trusted: event.isTrusted, path: location.pathname + location.search,
    }));
  });
  try {
    await page.goto(origin + '/home');
    await page.getByText('A slower morning on the coast.', { exact: false }).waitFor();
    const documentId = await page.evaluate(() => window.__historyDocument);
    await page.getByRole('link', { name: 'Messages', exact: true }).first().click();
    await page.getByRole('button', { name: 'Open conversation with Jordan Ellis', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__historyEvents), []);
    checks.push('Link push navigation updates the fixture route without emitting popstate');

    await page.getByRole('button', { name: 'Open conversation with Jordan Ellis', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Conversation"] [data-message-id]').length === 2);
    assert.equal(new URL(page.url()).searchParams.get('c'), 'conversation-fixture');
    await page.goBack();
    await page.waitForFunction(() => location.pathname === '/messages' && !location.search
      && !document.querySelector('[data-message-id]') && !document.querySelector('textarea[aria-label="Message"]'));
    await page.getByRole('heading', { name: 'Your conversations, together', exact: true }).waitFor();
    checks.push('Actual browser Back closes the conversation through its popstate handler');

    await page.goForward();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('c') === 'conversation-fixture'
      && document.querySelectorAll('[aria-label="Conversation"] [data-message-id]').length === 2);
    checks.push('Actual browser Forward restores the selected conversation and authorized rows');

    await page.goBack();
    await page.waitForFunction(() => location.pathname === '/messages' && !location.search
      && !document.querySelector('[data-message-id]') && !document.querySelector('textarea[aria-label="Message"]'));
    await page.goBack();
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
    await page.getByText('A slower morning on the coast.', { exact: false }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open conversation with Jordan Ellis', exact: true }).waitFor();
    const events = await page.evaluate(() => window.__historyEvents);
    assert.equal(events.length, 5);
    assert.ok(events.every(event => event.trusted), 'all history events must come from browser traversal');
    assert.equal(await page.evaluate(() => window.__historyDocument), documentId, 'history traversal must retain the same document');
    assert.deepEqual(errors, []);
    checks.push('Back and Forward update Home and Messages in the same document using trusted history events');
    await page.screenshot({ path: path.join(artifacts, 'history-traversal.png') });
    return { checks, events, browserErrors: errors };
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'history-traversal-failure.png') }).catch(() => {});
    await fs.writeFile(path.join(artifacts, 'history-traversal-failure.json'), JSON.stringify({
      error: String(error), checks, events: await page.evaluate(() => window.__historyEvents), browserErrors: errors,
    }, null, 2));
    throw error;
  } finally { await context.close(); }
}

async function main() {
  assert.ok(process.env.PLATINUM_CHROMIUM, 'Set PLATINUM_CHROMIUM to the existing verification browser.');
  await fs.mkdir(artifacts, { recursive: true });
  const backend = path.join(__dirname, 'social-backend.ts');
  await compile({ entry: path.join(__dirname, 'social-fixture.tsx'), output, aliases: {
    '@/lib/supabase/client': backend, '@/lib/supabase/server': backend, '@/lib/serverViewer': backend,
    '@/lib/contentMedia': backend, './supabase/client': backend, '../../lib/supabase/client': backend,
  } });
  const server = http.createServer(async (request, response) => {
    const requested = new URL(request.url, 'http://local').pathname;
    if (requested === '/coast.svg') { response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(coast); return; }
    if (requested === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = /\.(js|css|png|mp4|m4a)$/.test(requested) ? requested.slice(1) : 'index.html';
    const target = path.resolve(output, file);
    if (!target.startsWith(path.resolve(output) + path.sep)) { response.writeHead(400); response.end(); return; }
    try {
      const data = await fs.readFile(target);
      response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html' });
      response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const warm = await runWarmNavigation(browser, origin, artifacts);
    const history = await checkHistory(browser, origin);
    const receipt = {
      checkedAt: new Date().toISOString(), runtime: await browser.version(),
      scope: 'Existing social fixture and unchanged warm-navigation frame assertions, followed by trusted browser Back/Forward in the same document. Synthetic local Auth/database; no hosted-provider or capacity acceptance.',
      warm: warm.probes.map(probe => ({ destination: probe.destination, sampledFrames: probe.sampledFrames, blankContentFrames: probe.blankContentFrames, expected: probe.expected })),
      history,
    };
    await fs.writeFile(path.join(artifacts, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    await fs.rm(path.join(artifacts, 'history-traversal-failure.png'), { force: true });
    await fs.rm(path.join(artifacts, 'history-traversal-failure.json'), { force: true });
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
