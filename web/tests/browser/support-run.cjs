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
  const backend = path.join(__dirname, 'support-backend.ts');
  await compile({ entry: path.join(__dirname, 'support-fixture.tsx'), output, aliases: { '@/lib/supabase/client': backend, './supabase/client': backend }, title: 'Support page audit' });
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
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
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
      assert.ok(alerts.some(x => /not.*confirm|could not send/i.test(x)));
      assert.equal(await page.getByPlaceholder('Subject', { exact: true }).inputValue(), 'Keep my subject');
      assert.equal(await page.getByRole('button', { name: 'Send to operations', exact: true }).isDisabled(), false);
    });
    await run('SUP-009', 'Successful request makes one write and shows the returned ticket', 'ok', '/settings/support', async page => {
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
      assert.ok(alerts.some(x => /not.*confirm|could not send/i.test(x)));
      assert.equal(await page.getByPlaceholder('Write a reply', { exact: true }).inputValue(), 'Keep this reply');
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false);
    });
    await run('SUP-012', 'An atomic reply failure preserves the draft and does not insert a partial message', 'status-error', '/settings/support/ticket-a', async (page, alerts) => {
      await page.getByPlaceholder('Write a reply', { exact: true }).fill('Please reopen my ticket');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert.ok(alerts.some(x => /not.*confirm/i.test(x)), 'Atomic failure must be visible');
      assert.equal(await page.getByPlaceholder('Write a reply', { exact: true }).inputValue(), 'Please reopen my ticket');
      assert.equal(await page.evaluate(() => window.__supportAudit.state.messages.length), 1, 'No partial reply may survive a failed atomic reopen');
      assert.equal(await page.evaluate(() => window.__supportAudit.writes[0].operation), 'send_member_support_reply');
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
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), false, 'Send remains locked after rejected promise');
      assert.equal(errors.length, 0, 'Reply creates an unhandled rejection');
    });
    await run('SUP-015', 'A confirmed reply uses one atomic request and renders its readback', 'ok', '/settings/support/ticket-a', async page => {
      await page.getByPlaceholder('Write a reply').fill('One atomic reply');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('One atomic reply', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 1);
      assert.equal(await page.evaluate(() => window.__supportAudit.writes[0].operation), 'send_member_support_reply');
      assert.equal(await page.getByPlaceholder('Write a reply').inputValue(), '');
    });
    await run('SUP-016', 'Lost reply response retries the same UUID without a duplicate', 'write-lost', '/settings/support/ticket-a', async page => {
      await page.getByPlaceholder('Write a reply').fill('A recoverable reply');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder('Write a reply').inputValue(), 'A recoverable reply');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('A recoverable reply', { exact: true }).waitFor();
      const state = await page.evaluate(() => ({ writes: window.__supportAudit.writes, messages: window.__supportAudit.state.messages }));
      assert.equal(state.writes.length, 2); assert.equal(state.writes[0].values.p_request_id, state.writes[1].values.p_request_id);
      assert.equal(state.messages.filter(message => message.body === 'A recoverable reply').length, 1);
    });
    await run('SUP-017', 'Missing atomic contract preserves the draft without unsafe legacy writes', 'rpc-missing', '/settings/support/ticket-a', async (page, alerts) => {
      await page.getByPlaceholder('Write a reply').fill('Keep until available');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
      await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
      assert.ok(alerts.some(message => /temporarily unavailable/.test(message)));
      assert.equal(await page.getByPlaceholder('Write a reply').inputValue(), 'Keep until available');
      assert.equal(await page.evaluate(() => window.__supportAudit.state.messages.length), 1);
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.every(write => write.table === 'rpc')), true);
    });
    await run('SUP-018', 'List retry recovers the actual returned ticket', 'list-error', '/settings/support', async page => {
      await page.getByRole('alert').waitFor();
      await page.evaluate(() => window.__supportAudit.recover());
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByRole('link', { name: /Ticket A/ }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
    });
    await run('SUP-019', 'Held list read reaches a bounded error and can recover', 'read-held', '/settings/support', async page => {
      await page.getByRole('alert').waitFor({ timeout: 16000 });
      await page.evaluate(() => { window.__supportAudit.recover(); window.__supportAudit.release(); });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByRole('link', { name: /Ticket A/ }).waitFor();
      assert.equal(await page.getByText('Loading', { exact: true }).count(), 0);
    });
    await run('SUP-020', 'Signed-out ticket does not query private conversation data', 'signed-out', '/settings/support/ticket-a', async page => {
      await page.getByText('Sign in to view this support ticket.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.reads.length), 0);
    });
    await run('SUP-021', 'Lost create response confirms the exact stored ticket without a duplicate', 'write-lost', '/settings/support', async page => {
      await page.getByPlaceholder('Subject', { exact: true }).fill('Recover a sent ticket');
      await page.getByPlaceholder('What do you need help with?', { exact: true }).fill('Already committed before the response was lost');
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      await page.getByRole('link', { name: /Recover a sent ticket/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 1);
      assert.equal(await page.evaluate(() => window.__supportAudit.state.tickets.filter(ticket => ticket.subject === 'Recover a sent ticket').length), 1);
      assert.equal(await page.getByPlaceholder('Subject', { exact: true }).inputValue(), '');
    });
    await run('SUP-022', 'Rapid repeated reply activation makes only one request', 'ok', '/settings/support/ticket-a', async page => {
      await page.getByPlaceholder('Write a reply').fill('Only one copy');
      await page.getByRole('button', { name: 'Send', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.getByText('Only one copy', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 1);
    });
    await run('SUP-023', 'Older history retry cannot erase a confirmed reply or restore a stale solved state', 'messages-error', '/settings/support/ticket-a', async page => {
      await page.getByRole('alert').waitFor();
      await page.evaluate(() => { window.__supportAudit.recover(); window.__supportAudit.state.tickets[0].status = 'solved'; window.__supportAudit.state.holdNextHistory = true; });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.waitForFunction(() => !!window.__supportAudit.state.releaseHistory);
      await page.getByPlaceholder('Write a reply').fill('Confirmed after old history started');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByText('Confirmed after old history started', { exact: true }).waitFor();
      await page.evaluate(() => window.__supportAudit.state.releaseHistory());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.getByText('Confirmed after old history started', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Open', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Solved', { exact: true }).count(), 0);
    });
    await run('SUP-024', 'Older list retry cannot erase the newly confirmed ticket', 'list-error', '/settings/support', async page => {
      await page.getByRole('alert').waitFor();
      await page.evaluate(() => { window.__supportAudit.recover(); window.__supportAudit.state.holdNextList = true; });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.waitForFunction(() => !!window.__supportAudit.state.releaseList);
      await page.getByPlaceholder('Subject', { exact: true }).fill('Newer confirmed ticket');
      await page.getByPlaceholder('What do you need help with?', { exact: true }).fill('Do not replace this with the older list');
      await page.getByRole('button', { name: 'Send to operations', exact: true }).click();
      await page.getByRole('link', { name: /Newer confirmed ticket/ }).waitFor();
      await page.evaluate(() => window.__supportAudit.state.releaseList());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.getByRole('link', { name: /Newer confirmed ticket/ }).count(), 1);
    });
    let caseId = 25;
    for (const kind of ['reply', 'create']) {
      const route = kind === 'reply' ? '/settings/support/ticket-a' : '/settings/support';
      const draft = page => page.getByPlaceholder(kind === 'reply' ? 'Write a reply' : 'What do you need help with?', { exact: true });
      const send = page => page.getByRole('button', { name: kind === 'reply' ? 'Send' : 'Send to operations', exact: true });
      const prepare = async page => {
        if (kind === 'create') await page.getByPlaceholder('Subject', { exact: true }).fill('Session-bound ticket');
        await draft(page).fill('Session-bound draft');
      };
      const holdDigest = page => page.evaluate(() => {
        const original = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = async (...args) => {
          window.__supportAudit.state.digestEntered = true;
          await new Promise(resolve => { window.__supportAudit.state.releaseDigest = resolve; });
          crypto.subtle.digest = original;
          return original(...args);
        };
      });
      await run(`SUP-${String(caseId++).padStart(3, '0')}`, `${kind}: queued preparation is rejected across A to B to A`, 'ok', route, async page => {
        await prepare(page); await holdDigest(page); await send(page).click();
        await page.waitForFunction(() => window.__supportAudit.state.digestEntered);
        await page.evaluate(() => { window.__supportAudit.changeOwner('member-b'); window.__supportAudit.changeOwner('member-a'); window.__supportAudit.state.releaseDigest(); });
        await send(page).waitFor();
        assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 0);
        assert.equal(await draft(page).inputValue(), 'Session-bound draft');
      });
      await run(`SUP-${String(caseId++).padStart(3, '0')}`, `${kind}: ordinary token refresh keeps the captured bearer and permits confirmation`, 'ok', route, async page => {
        await prepare(page); await holdDigest(page); await send(page).click();
        await page.waitForFunction(() => window.__supportAudit.state.digestEntered);
        await page.evaluate(() => { window.__supportAudit.refresh(); window.__supportAudit.state.releaseDigest(); });
        await page.getByText(kind === 'reply' ? 'Session-bound draft' : 'Session-bound ticket', { exact: true }).waitFor();
        const write = await page.evaluate(() => window.__supportAudit.writes[0]);
        assert.match(write.headers.Authorization, /\.0$/);
        assert.equal(await page.evaluate(() => window.__supportAudit.state.tokenRevision), 1);
        assert.equal(await draft(page).inputValue(), '');
      });
      await run(`SUP-${String(caseId++).padStart(3, '0')}`, `${kind}: leaving the actual page before hashing completes prevents dispatch`, 'ok', route, async page => {
        await prepare(page); await holdDigest(page); await send(page).click();
        await page.waitForFunction(() => window.__supportAudit.state.digestEntered);
        await page.getByRole('link', { name: kind === 'reply' ? 'Back to support' : /Ticket A/ }).click();
        await page.getByRole('heading', { name: kind === 'reply' ? 'Support' : 'Ticket A', exact: true }).waitFor();
        await page.evaluate(() => window.__supportAudit.state.releaseDigest());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.__supportAudit.writes.length), 0);
      });
      await run(`SUP-${String(caseId++).padStart(3, '0')}`, `${kind}: a discarded completion retains its UUID for a later same-payload submission`, 'write-held', route, async page => {
        await prepare(page); await send(page).click();
        await page.waitForFunction(() => window.__supportAudit.writes.length === 1);
        await page.getByRole('link', { name: kind === 'reply' ? 'Back to support' : /Ticket A/ }).click();
        await page.getByRole('heading', { name: kind === 'reply' ? 'Support' : 'Ticket A', exact: true }).waitFor();
        await page.evaluate(() => { window.__supportAudit.release(); window.__supportAudit.recover(); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pc:support:retry:')).length), 1);
        await page.getByRole('link', { name: kind === 'reply' ? /Ticket A/ : 'Back to support' }).click();
        await prepare(page); await send(page).click();
        await page.getByText(kind === 'reply' ? 'Session-bound draft' : 'Session-bound ticket', { exact: true }).waitFor();
        await page.waitForFunction(() => window.__supportAudit.writes.length === 2);
        const writes = await page.evaluate(() => window.__supportAudit.writes);
        assert.equal(kind === 'reply' ? writes[0].values.p_request_id : writes[0].values.id, kind === 'reply' ? writes[1].values.p_request_id : writes[1].values.id);
        assert.equal(await page.evaluate(kind => kind === 'reply'
          ? window.__supportAudit.state.messages.filter(row => row.body === 'Session-bound draft').length
          : window.__supportAudit.state.tickets.filter(row => row.subject === 'Session-bound ticket').length, kind), 1);
        assert.equal(await draft(page).inputValue(), '');
      });
    }
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
  if (cases.some(row => row.status !== 'passed')) process.exitCode = 1;
  console.log(JSON.stringify({ passed: cases.filter(x => x.status === 'passed').length, failed: cases.filter(x => x.status === 'failed').length, total: cases.length, evidence }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
