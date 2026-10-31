/** Actual five server pages + installed SDK, real client consumers and Workspace.
 * Synthetic HTTP and full-document navigation adapters; no hosted mutations. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { ROOT, ADMIN, TARGET, runPage, makeHarness } = require('../helpers/reportingFixture.cjs');
const data = require('../helpers/reportingData.cjs');
const { chromium } = require(path.join(ROOT, 'web/node_modules/playwright'));
const output = process.env.PLATINUM_REPORT_OUTPUT || '/tmp/platinum-admin-reporting';
const artifacts = process.env.PLATINUM_REPORT_ARTIFACTS || path.join(ROOT, 'docs/quality/all-platform-audit-20261031/admin/after-repair/browser');
const checks = [], actions = [], reads = [], errors = [];
const tables = { jobs: data.jobs(1100), call_sessions: data.calls(1001), stories: data.stories(1001), verification_applications: data.applications(1001), profiles: data.profiles(1001) };
for (let i = 1069; i < tables.jobs.length; i++) tables.jobs[i].title = 'Archive role ' + i;
const literal = '100%_A*(B)[C]\\D';
tables.jobs[1068].title = literal;
function json(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (['/fixture.js', '/fixture.css'].includes(url.pathname)) { res.writeHead(200, { 'Content-Type': url.pathname.endsWith('js') ? 'application/javascript' : 'text/css' }); res.end(fs.readFileSync(output + url.pathname)); return; }
    if (req.method === 'POST' && url.pathname === '/__report_action') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('Oversize fixture action'); }
      const input = JSON.parse(raw);
      if (input.action !== 'updateSupportTriage') throw new Error('Unplanned action rejected');
      const fixture = data.support(), h = makeHarness(fixture), form = new FormData();
      for (const [k, v] of input.fields) form.set(k, v);
      const record = { action: input.action, fields: input.fields, calls: [], value: null, error: null };
      try { record.value = await h.load(ADMIN + '/lib/supportTriageActions.ts').updateSupportTriage(form); }
      catch (error) { record.error = error.message; }
      record.calls = h.calls; actions.push(record); json(res, record); return;
    }
    const name = url.pathname.split('/')[1];
    if (!['jobs', 'calls', 'stories', 'queue', 'support'].includes(name)) { res.writeHead(404); res.end(); return; }
    const source = name === 'support' ? 'admin-web/app/support/[tid]/page.tsx' : `admin-web/app/${name}/page.tsx`;
    const fixture = name === 'support' ? data.support() : { tables };
    const result = await runPage(source, { ...fixture, search: Object.fromEntries(url.searchParams), respond: call => url.searchParams.get('failure') === 'count' && call.method === 'HEAD' ? new Response(null, { status: 500 }) : undefined });
    reads.push({ url: url.pathname + url.search, outcome: result.outcome, calls: result.calls });
    res.writeHead(result.outcome === 'rendered' ? 200 : 503, { 'Content-Type': 'text/html' });
    if (result.outcome !== 'rendered') { res.end('<!doctype html><html><body><p role="alert">Required report is unavailable.</p></body></html>'); return; }
    const record = JSON.stringify(result).replace(/</g, '\\u003c');
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Admin reporting verification</title></head><body><div id="root"></div><script>window.__REPORT_PAGE__=' + record + '</script><script src="/fixture.js"></script></body></html>');
  } catch (error) { json(res, { error: error.message }, 500); }
}
async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    async function open(route) { await page.goto(origin + route); await page.locator('#workspace').waitFor(); }
    async function check(name, run) {
      try { const evidence = await run(); checks.push({ name, status: 'passed', evidence }); }
      catch (error) { checks.push({ name, status: 'failed', error: String(error) }); await page.screenshot({ path: path.join(artifacts, 'failure-' + checks.length + '.png'), fullPage: true }).catch(() => {}); }
      console.log(JSON.stringify(checks.at(-1)));
    }
    await check('Jobs normal page and semantic Next page reach different actual records', async () => {
      await open('/jobs'); await page.getByRole('row', { name: 'Role 0', exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Roles pages' }).getByRole('link', { name: 'Next page' }).click();
      await page.getByRole('row', { name: 'Role 25', exact: true }).waitFor(); assert.match(page.url(), /page=2/);
      assert.match(await page.getByRole('navigation', { name: 'Roles pages' }).innerText(), /26–50 of 1,100 roles/);
    });
    await check('Jobs new server search resets page, reaches old records, and preserves exact filtered pagination', async () => {
      await page.getByRole('searchbox', { name: 'Search all job titles' }).fill('archive');
      await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
      await page.getByRole('row', { name: 'Archive role 1069', exact: true }).waitFor(); assert.equal(new URL(page.url()).searchParams.has('page'), false);
      const nav = page.getByRole('navigation', { name: 'Matching roles pages' }); assert.match(await nav.innerText(), /1–25 of 31 matching roles/);
      await nav.getByRole('link', { name: 'Next page' }).click(); await page.getByRole('row', { name: 'Archive role 1094', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('q'), 'archive'); assert.match(await nav.innerText(), /26–31 of 31 matching roles/);
    });
    await check('Jobs literal punctuation search and clear operate through real form controls', async () => {
      await page.getByRole('searchbox', { name: 'Search all job titles' }).fill(literal); await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
      await page.getByRole('row', { name: literal, exact: true }).waitFor(); assert.match(await page.getByRole('navigation', { name: 'Matching roles pages' }).innerText(), /1–1 of 1 matching roles/);
      await page.getByRole('link', { name: 'Clear title search' }).click(); await page.getByRole('row', { name: 'Role 0', exact: true }).waitFor();
    });
    await check('Jobs page filter empty state can clear without altering server search', async () => {
      await open('/jobs?q=archive'); const filter = page.getByRole('textbox', { name: 'Filter this page by role, company or location' });
      await filter.fill('absent current-page role'); await page.getByText(/^Nothing matches this view\./).waitFor();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await page.getByRole('row', { name: 'Archive role 1069', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('q'), 'archive');
    });
    for (const [route, label, expected] of [['calls', 'Sessions', '26–50 of 1,001 sessions'], ['stories', 'Stories', '26–50 of 1,001 stories'], ['queue', 'Pending requests', '26–50 of 1,001 pending requests']]) {
      await check(`${route} actual next-page link loads the second bounded set and exact total`, async () => {
        await open('/' + route); const nav = page.getByRole('navigation', { name: label + ' pages' });
        await nav.getByRole('link', { name: 'Next page' }).click(); await page.waitForURL('**/' + route + '?page=2');
        await page.waitForFunction(value => document.querySelector('nav')?.textContent?.includes(value), expected);
        assert.equal(await page.evaluate(() => window.__REPORT_PAGE__.desks[0].rows[0].id), data.id(25));
      });
    }
    await check('Failed exact count produces an unavailable boundary and no report/actions', async () => {
      const response = await page.goto(origin + '/jobs?failure=count'); assert.equal(response.status(), 503);
      await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('row').count(), 0);
    });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await check(`Jobs server search and page links fit ${width}px and remain usable`, async () => {
        await open('/jobs?page=2'); const input = page.getByRole('searchbox', { name: 'Search all job titles' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        for (const control of [input, page.getByRole('button', { name: 'Search jobs', exact: true }), page.getByRole('navigation', { name: 'Roles pages' }).getByRole('link', { name: 'Next page' })]) {
          const box = await control.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 44);
        }
        await input.fill('archive'); await page.getByRole('button', { name: 'Search jobs', exact: true }).click(); await page.getByRole('row', { name: 'Archive role 1069', exact: true }).waitFor();
        await page.screenshot({ path: path.join(artifacts, 'jobs-' + width + '.png'), fullPage: true });
      });
      await check(`Support owner selector fits ${width}px and submits the complete selected UUID`, async () => {
        await open('/support/' + TARGET); const select = page.getByRole('combobox', { name: 'Owner', exact: true }); await select.waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        const box = await select.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        await select.selectOption(data.id(400)); assert.equal(await select.inputValue(), data.id(400));
        await page.locator('input[name="reason"]').fill('Synthetic owner assignment from phone');
        await page.getByRole('button', { name: 'Save assignment', exact: true }).click(); await page.getByText('Changes saved.', { exact: true }).waitFor();
        const action = actions.at(-1), rpc = action.calls.find(c => c.path.endsWith('/admin_support_triage_update'));
        assert.equal(action.error, null); assert.equal(rpc.body.p_assigned_to, data.id(400));
        await page.screenshot({ path: path.join(artifacts, 'support-' + width + '.png'), fullPage: true });
        return { width, selector: box, selectedOwner: data.id(400), documentWidth: await page.evaluate(() => document.documentElement.scrollWidth) };
      });
    }
    const receipt = { checkedAt: new Date().toISOString(), runtime: await browser.version(), counts: { tests: checks.length, passed: checks.filter(c => c.status === 'passed').length, failed: checks.filter(c => c.status === 'failed').length }, checks, actions, reads, browserErrors: errors,
      limits: ['Actual pages, installed SDK, Desk/CommandForm/Viz/Workspace and compiled Tailwind CSS; synthetic HTTP only.', 'Shell header/rail and Next RSC router are not mounted. Next links use full-document navigation in this isolated fixture.', 'Provider failure is projected through an explicit fixture error boundary; actual Next error rendering is not accepted here.', 'No hosted write, authenticated staff session or broad admin-action acceptance is inferred.'] };
    fs.writeFileSync(path.join(artifacts, 'reporting-browser.json'), JSON.stringify(receipt, null, 2) + '\n');
    if (receipt.counts.failed || errors.length) process.exitCode = 1;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
