const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(root + '/web/node_modules/playwright');
const { compile } = require(root + '/web/tests/browser/ui-compile.cjs');
const output = process.env.PLATINUM_SUPPORT_OUTPUT || '/tmp/platinum-support-browser';
const evidence = process.env.PLATINUM_SUPPORT_ARTIFACTS || '/tmp/platinum-browser-evidence/support';
const cases = [];
async function main() {
  await fs.mkdir(evidence, { recursive: true });
  await compile({ entry: path.join(__dirname, 'support-fixture.tsx'), output, aliases: { '@/lib/supabase/client': path.join(__dirname, 'support-backend.ts') }, title: 'Support page audit' });
  const server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://localhost').pathname;
      const name = p === '/fixture.js' ? 'fixture.js' : p === '/fixture.css' ? 'fixture.css' : 'index.html';
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(await fs.readFile(path.join(output, name)));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLATINUM_CHROMIUM || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  async function run(id, name, scenario, route, verify) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [], alerts = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { alerts.push(d.message()); void d.accept(); });
    const row = { id, name, scenario, route, status: 'untested', errors, alerts };
    try {
      await page.goto(origin + route + '?scenario=' + scenario);
      await page.waitForFunction(() => window.__supportAudit && window.__supportAudit.reads.length > 0 || window.__supportAudit?.state.owner === null);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await verify(page, alerts, errors);
      row.status = 'passed';
    } catch (error) {
      row.status = 'failed'; row.failure = String(error);
    } finally {
      row.observed = await page.evaluate(() => ({ text: document.querySelector('main')?.innerText, reads: window.__supportAudit?.reads, writes: window.__supportAudit?.writes, buttons: [...document.querySelectorAll('button')].map(b => ({ text: b.innerText, disabled: b.disabled })), inputs: [...document.querySelectorAll('input,textarea')].map(i => ({ placeholder: i.placeholder, value: i.value })) })).catch(() => null);
      await page.screenshot({ path: path.join(evidence, id + '.png'), fullPage: true }).catch(() => {});
      cases.push(row); console.log(row.status.toUpperCase(), id, name);
      await fs.writeFile(path.join(evidence, 'browser-audit.json'), JSON.stringify({ source: process.env.GITHUB_SHA || process.env.PLATINUM_AUDIT_SOURCE || 'local-working-tree', checkedAt: new Date().toISOString(), scope: 'Actual member support page components in Chromium at 390x844 with a synthetic Auth/database adapter. No hosted request, real message or framework route lifecycle claim.', runtime: await browser.version(), cases }, null, 2) + '\n');
      await context.close();
    }
  }
  try {
    await run('SUP-001', 'Support list renders the returned owner ticket', 'ok', '/settings/support', async page => {
      await page.getByRole('link', { name: /Ticket A/ }).waitFor();
      assert.equal(await page.getByRole('link', { name: /Ticket A/ }).getAttribute('href'), '/settings/support/ticket-a');
    });
    await run('SUP-002', 'Failed ticket-list read shows a recoverable error, not an empty inbox', 'list-error', '/settings/support', async page => {
      assert.ok(await page.getByRole('alert').count() > 0, 'No read error is displayed');
      assert.ok(await page.getByRole('button', { name: /retry|try again/i }).count() > 0, 'No read retry is offered');
    });
    await run('SUP-003', 'Missing ticket resolves to a not-found/access state with an exit', 'missing-ticket', '/settings/support/ticket-a', async page => {
      const text = await page.locator('main').innerText();
      assert.match(text, /not found|not available|unavailable|could not|cannot|no access/i);
      assert.equal(await page.getByText('Loading', { exact: true }).count(), 0);
    });
    await run('SUP-004', 'Failed ticket read exposes an error and retry', 'ticket-error', '/settings/support/ticket-a', async page => {
      assert.ok(await page.getByRole('alert').count() > 0, 'Ticket read error stays behind Loading');
    });
    await run('SUP-005', 'Failed message read is reported separately from an empty conversation', 'messages-error', '/settings/support/ticket-a', async page => {
      await page.getByRole('heading', { name: 'Ticket A', exact: true }).waitFor();
      assert.ok(await page.getByRole('alert').count() > 0, 'Failed history read is silently shown as no replies');
    });
    await run('SUP-006', 'Signed-out support displays sign-in guidance without ticket reads', 'signed-out', '/settings/support', async page => {
      await page.getByText('Sign in to contact support.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.reads.length), 0);
    });
    await run('SUP-007', 'New support request validates empty fields without writing', 'ok', '/settings/support', async (page, alerts) => {
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      assert.ok(alerts.some(x => /subject and a message/.test(x)));
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 0);
    });
    await run('SUP-008', 'Rejected request keeps the draft and releases Send', 'write-reject', '/settings/support', async (page, alerts) => {
      await page.getByPlaceholder('Subject', { exact: true }).fill('Keep my subject');
      await page.getByPlaceholder('What do you need help with?', { exact: true }).fill('Keep my support draft');
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      assert.ok(alerts.some(x => /Could not send/.test(x)));
      assert.equal(await page.getByPlaceholder('Subject', { exact: true }).inputValue(), 'Keep my subject');
      assert.equal(await page.getByRole('button', { name: 'Send to operations', exact: true }).isDisabled(), false);
    });
    await run('SUP-009', 'Successful request makes one write and shows the returned ticket', 'ok', '/settings/support', async (page, alerts) => {
      await page.getByPlaceholder('Subject', { exact: true }).fill('New issue');
      await page.getByPlaceholder('What do you need help with?', { exact: true }).fill('Synthetic new issue');
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      await page.getByRole('link', { name: /New issue/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 1);
      assert.equal(await page.getByPlaceholder('Subject', { exact: true }).inputValue(), '');
    });
    await run('SUP-010', 'Returned ticket and message render with a working reply control', 'ok', '/settings/support/ticket-a', async page => {
      await page.getByText('Existing staff reply', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
      await page.getByPlaceholder('Write a reply', { exact: true }).fill('Synthetic reply');
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false);
    });
    await run('SUP-011', 'Rejected reply preserves draft and releases Send', 'write-reject', '/settings/support/ticket-a', async (page, alerts) => {
      await page.getByPlaceholder('Write a reply', { exact: true }).fill('Keep this reply');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      assert.ok(alerts.some(x => /Could not send/.test(x)));
      assert.equal(await page.getByPlaceholder('Write a reply', { exact: true }).inputValue(), 'Keep this reply');
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false);
    });
    await run('SUP-012', 'A successful reply followed by a rejected status update is not reported as full success', 'status-error', '/settings/support/ticket-a', async (page, alerts) => {
      await page.getByPlaceholder('Write a reply', { exact: true }).fill('Please reopen my ticket');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.ok(alerts.some(x => /status|reopen|part|failed/i.test(x)) || await page.getByRole('alert').count() > 0, 'Status write failure is ignored; draft clears and ticket remains solved');
    });
    await run('SUP-013', 'Unexpected rejected support submission does not leave Sending locked', 'write-throw', '/settings/support', async (page, alerts, errors) => {
      await page.getByPlaceholder('Subject', { exact: true }).fill('Transport problem');
      await page.getByPlaceholder('What do you need help with?', { exact: true }).fill('Do not lose this');
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await page.getByRole('button', { name: 'Sending', exact: true }).count(), 0, 'Sending remains disabled after rejected promise');
      assert.equal(errors.length, 0, 'Submission creates an unhandled rejection');
    });
    await run('SUP-014', 'Unexpected rejected reply does not leave Send locked', 'write-throw', '/settings/support/ticket-a', async (page, alerts, errors) => {
      await page.getByPlaceholder('Write a reply', { exact: true }).fill('Do not lose my reply');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false, 'Send remains locked after rejected promise');
      assert.equal(errors.length, 0, 'Reply creates an unhandled rejection');
    });
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
  if (cases.some(row => row.status !== 'passed')) process.exitCode = 1;
  console.log(JSON.stringify({ passed: cases.filter(x => x.status === 'passed').length, failed: cases.filter(x => x.status === 'failed').length, total: cases.length, evidence }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
