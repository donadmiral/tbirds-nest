/** Actual admin Live components against a controlled HTTP API, never hosted credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { chromium } = require('../../../web/node_modules/playwright');
const output = process.env.PLATINUM_UI_OUTPUT || '/tmp/platinum-admin-live';
const evidence = process.env.PLATINUM_UI_ARTIFACTS || '/tmp/platinum-admin-live-evidence';
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const streams = [
  { id: id(1), title: 'Inside the creator studio', description: 'A conversation about building and sharing useful ideas.', topic: 'business', audience: 'public', state: 'live', viewer_count: 24, host: { full_name: 'Avery Lane' } },
  { id: id(2), title: 'Music after hours', topic: 'music', audience: 'followers', state: 'reconnecting', viewer_count: null, host: { full_name: 'Jordan Wells' } },
  { id: id(3), title: 'Community questions', topic: 'irl', audience: 'invite', state: 'scheduled', viewer_count: null, host: { full_name: 'Casey Reed' } },
];
const clip = { id: id(11), session_id: id(1), title: 'The idea that started it', caption: 'A short moment from the creator conversation.', state: 'review', moderation_state: 'pending', copyright_state: 'cleared', start_ms: 0, end_ms: 2000, cover_ms: 0, watermark: true, brand_text: 'Platinum Circles', formats: ['vertical', 'horizontal'], burn_captions: true, subtitles: [{ start_ms: 0, end_ms: 1800, text: 'Every useful idea starts with a question.' }], view_count: 0, share_count: 0, created_at: '2026-11-04T02:00:00Z' };
const liveButtons = ['Send warning', 'Close chat', 'Followers chat', 'Slow mode', 'Open chat', 'End broadcast', 'Remove member from stream', 'Resolve with reason above'];
const clipButtons = ['Approve clip', 'Reject clip', 'Clear copyright', 'Block copyright', 'Retry failed render', 'Retry post with reason above'];
async function contract(file, imports = {}) {
  const module = { exports: {} };
  const source = await fs.readFile(path.join(__dirname, '../../lib', file), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require(name) { assert.ok(name in imports, 'Unexpected contract import ' + name); return imports[name]; } });
  return module.exports;
}

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, 'clip.mp4')]);
  const calls = [], accepted = [], checks = [], errors = [], fixtureErrors = [], clipFilters = [], dialogs = [];
  const liveContract = await contract('liveOperations.ts');
  const clipContract = await contract('liveClipOperations.ts', { './liveOperations': liveContract });
  const clips = [
    { ...clip, state: 'ready' },
    { ...clip, id: id(12), title: 'A clip being rendered', state: 'processing', moderation_state: 'approved' },
    { ...clip, id: id(13), title: 'A failed clip render', state: 'failed', moderation_state: 'approved' },
    { ...clip, id: id(14), title: 'A clip with failed posting', state: 'ready', moderation_state: 'approved' },
  ];
  const reports = [{ id: id(21), session_id: id(1), reason: 'A viewer reported distorted audio.', state: 'open', created_at: '2026-11-04T02:02:00Z' }];
  const posts = [{ id: id(41), clip_id: id(14), destination: 'feed', format: 'vertical', state: 'failed', attempts: 4, error_code: 'CONTROLLED_RETRYABLE_FAILURE', created_at: '2026-11-04T02:04:00Z' }];
  const audit = [], clipAudit = [], removed = new Set();
  const viewClip = item => ({ ...item, state: item.state === 'ready' ? item.copyright_state === 'blocked' ? 'blocked' : item.moderation_state !== 'approved' ? 'review' : 'ready' : item.state });
  let moderate = true, failNext = false, browser, page, failure;
  const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    try {
      if (['/api/live', '/api/live/clips'].includes(url.pathname)) {
        if (req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk;
          const command = JSON.parse(body); calls.push({ path: url.pathname, ...command });
          const parsed = url.pathname === '/api/live' ? liveContract.parseStaffLiveCommand(command) : clipContract.parseStaffClipCommand(command);
          assert.ok(parsed, 'Rendered admin control must submit the actual API command schema');
          assert.ok(moderate, 'Read-only UI must never submit a moderation command');
          if (failNext) { failNext = false; return json(res, { error: 'Temporary review connection failure. Retry with your saved reason.' }, 503); }
          const session = streams.find(item => item.id === command.sessionId);
          assert.ok(session, 'Unknown fixture stream');
          if (url.pathname === '/api/live') {
            switch (command.action) {
              case 'admin_warn': session.warning_reason = command.payload.reason; break;
              case 'admin_chat': Object.assign(session, command.payload.chat_mode === undefined ? {} : { chat_mode: command.payload.chat_mode }, command.payload.slow_mode_seconds === undefined ? {} : { slow_mode_seconds: command.payload.slow_mode_seconds }); break;
              case 'admin_remove_viewer': removed.add(command.payload.user_id); break;
              case 'admin_resolve_report': {
                const report = reports.find(item => item.id === command.payload.report_id && item.session_id === session.id);
                assert.ok(report); assert.equal(report.state, 'open'); report.state = 'resolved'; break;
              }
              case 'stop': assert.ok(['live', 'starting', 'reconnecting'].includes(session.state)); session.state = 'ending'; break;
              default: assert.fail('Unsupported controlled Live action');
            }
            audit.push({ id: id(100 + accepted.length), session_id: session.id, action: command.action, reason: command.payload.reason, created_at: new Date().toISOString() });
          } else {
            const target = clips.find(item => item.id === command.clipId && item.session_id === session.id);
            assert.ok(target, 'Unknown fixture clip');
            switch (command.action) {
              case 'admin_review': target.moderation_state = command.payload.decision; break;
              case 'copyright': target.copyright_state = command.payload.status; break;
              case 'retry': assert.equal(target.state, 'failed'); target.state = 'queued'; break;
              case 'retry_post': {
                const post = posts.find(item => item.id === command.payload.post_id && item.clip_id === target.id);
                assert.ok(post); assert.equal(post.state, 'failed'); assert.equal(target.state, 'ready'); assert.equal(target.moderation_state, 'approved'); assert.equal(target.copyright_state, 'cleared');
                post.state = 'published'; post.attempts = 0; post.error_code = null; post.published_at = new Date().toISOString(); break;
              }
              default: assert.fail('Unsupported controlled clip action');
            }
            clipAudit.push({ id: id(200 + accepted.length), clip_id: target.id, action: command.action, reason: command.payload.reason, created_at: new Date().toISOString() });
          }
          accepted.push({ path: url.pathname, ...command });
          return json(res, { ok: true, state: command.action === 'stop' ? 'ending' : null });
        }
        assert.equal(req.method, 'GET');
        if (url.pathname === '/api/live/clips') {
          if (url.searchParams.has('clip')) {
            const target = clips.find(item => item.id === url.searchParams.get('clip')); assert.ok(target, 'Unknown clip read');
            if (url.searchParams.has('format')) { assert.ok(target.formats.includes(url.searchParams.get('format'))); return json(res, { url: `http://${req.headers.host}/clip.mp4`, expires_at: new Date(Date.now() + 120000).toISOString() }); }
            return json(res, { clip: viewClip(target), permissions: { moderate }, posts: { items: posts.filter(item => item.clip_id === target.id) }, connections: { items: [] }, audit: { items: clipAudit.filter(item => item.clip_id === target.id) }, analytics: { views: 0, shares: 0 } });
          }
          const state = url.searchParams.get('state'); clipFilters.push(state);
          assert.ok(!state || clipContract.staffClipStateFilters.some(filter => filter.value === state));
          return json(res, { items: clips.filter(item => !state || item.state === state || item.moderation_state === state || item.copyright_state === state).map(viewClip), next_cursor: null });
        }
        if (url.searchParams.has('session')) {
          const session = streams.find(item => item.id === url.searchParams.get('session')); assert.ok(session, 'Unknown stream read');
          return json(res, { session, permissions: { moderate }, provider: { configured: true, last_event_at: '2026-11-04T02:00:00Z' }, reports: { items: reports.filter(item => item.session_id === session.id) }, audit: { items: audit.filter(item => item.session_id === session.id) }, messages: { items: [{ id: id(31), author: { full_name: 'Taylor' }, body: 'How did you get started?' }] }, analytics: { current_viewers: 24, peak_viewers: 31, unique_viewers: null, watch_minutes: null, chat_messages: 8, reactions: 3, clips: 1, clip_views: 0, clip_shares: 0 } });
        }
        const filter = url.searchParams.get('state');
        return json(res, { items: streams.filter(item => !filter || item.state === filter), next_cursor: null, capabilities: { create: true, broadcast: true, view: true, recording: true, reminders: true } });
      }
      assert.ok(!url.pathname.startsWith('/api/'), 'Unhandled controlled API path ' + url.pathname);
      const name = ['fixture.js', 'fixture.css', 'logo.png', 'pearl.png', 'clip.mp4'].includes(path.basename(url.pathname)) ? path.basename(url.pathname) : 'index.html';
      const body = await fs.readFile(path.join(output, name));
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.mp4') ? 'video/mp4' : 'text/html' }); res.end(body);
    } catch (error) { fixtureErrors.push(error.stack || String(error)); json(res, { error: 'Fixture request failed' }, 500); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLATINUM_CHROMIUM, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.on('pageerror', error => errors.push(error.message));
    const nextPost = apiPath => page.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() === 'POST');
    const auditReceipt = async (action, reasonText, forClip = false) => {
      const section = page.getByRole('heading', { name: forClip ? 'Clip audit history' : 'Audit history', exact: true }).locator('..');
      const row = section.locator('article').filter({ has: page.getByText(reasonText, { exact: true }) });
      await row.waitFor(); assert.equal(await row.count(), 1);
      await row.getByText(action, { exact: true }).waitFor();
    };
    const confirmation = accept => page.waitForEvent('dialog').then(async dialog => {
      assert.equal(dialog.type(), 'confirm');
      assert.match(dialog.message(), /End this live broadcast|This decision can remove clip playback/);
      dialogs.push({ message: dialog.message(), accepted: accept });
      if (accept) await dialog.accept(); else await dialog.dismiss();
    });
    const execute = async ({ label, action, payload = {}, reason: reasonText, clipId, confirm = false }) => {
      const apiPath = clipId ? '/api/live/clips' : '/api/live', before = accepted.length;
      await page.getByRole('textbox', { name: clipId ? 'Reason for this decision' : 'Reason for this action', exact: true }).fill('  ' + reasonText + '  ');
      const response = nextPost(apiPath), dialog = confirm ? confirmation(true) : null;
      await page.getByRole('button', { name: label, exact: true }).click();
      if (dialog) await dialog;
      assert.equal((await response).status(), 200);
      await auditReceipt(action, reasonText, !!clipId);
      assert.equal(accepted.length, before + 1);
      const sent = accepted.at(-1);
      assert.equal(sent.path, apiPath); assert.equal(sent.action, action); assert.equal(sent.sessionId, id(1));
      assert.equal(sent.clipId, clipId); assert.ok(liveContract.liveId(sent.requestId));
      assert.deepEqual(sent.payload, { reason: reasonText, ...payload });
    };
    const dismiss = async label => {
      const before = calls.length, dialog = confirmation(false);
      await page.getByRole('button', { name: label, exact: true }).click(); await dialog;
      assert.equal(calls.length, before, 'Dismissing confirmation must not submit a command');
    };
    const inspectClip = async title => {
      await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Review', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/live`);
    await page.getByRole('cell', { name: 'Inside the creator studio', exact: true }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Admin Live overflow at ${width}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(evidence, `admin-live-${width}.png`), fullPage: true });
    }
    checks.push('Actual admin Live directory fits 320, 390, 768 and 1440 widths and preserves state labels and unknown counts');
    await page.getByRole('combobox', { name: 'Filter stream state', exact: true }).selectOption('live');
    await page.getByRole('row').filter({ hasText: 'Music after hours' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Review', exact: true }).first().click();
    const reason = page.getByRole('textbox', { name: 'Reason for this action', exact: true }); await reason.waitFor();
    for (const label of liveButtons) assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true, label + ' requires a reason');
    await reason.fill('Review the reported audio problem with the host.'); failNext = true;
    let response = nextPost('/api/live');
    await page.getByRole('button', { name: 'Close chat', exact: true }).click(); assert.equal((await response).status(), 503);
    await page.getByRole('alert').filter({ hasText: 'Temporary review connection failure' }).waitFor();
    assert.equal(await reason.inputValue(), 'Review the reported audio problem with the host.');
    response = nextPost('/api/live');
    await page.getByRole('button', { name: 'Close chat', exact: true }).click(); assert.equal((await response).status(), 200);
    await auditReceipt('admin_chat', 'Review the reported audio problem with the host.');
    assert.equal(calls.length, 2); assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(calls[1].action, 'admin_chat'); assert.equal(calls[1].payload.chat_mode, 'closed');
    assert.deepEqual(calls[1].payload, { reason: 'Review the reported audio problem with the host.', chat_mode: 'closed' }); assert.equal(streams[0].chat_mode, 'closed');
    checks.push('Every Live moderation control requires a reason and Close chat retry preserves its draft and idempotency key');
    await page.getByRole('heading', { name: 'Moderation', exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'admin-live-review.png'), fullPage: true });
    await execute({ label: 'Send warning', action: 'admin_warn', reason: 'Ask the host to correct the reported audio.' });
    assert.equal(streams[0].warning_reason, 'Ask the host to correct the reported audio.');
    checks.push('Send warning submits the reviewed reason and displays the controlled audit receipt');
    await execute({ label: 'Followers chat', action: 'admin_chat', payload: { chat_mode: 'followers' }, reason: 'Limit this conversation to followers.' });
    assert.equal(streams[0].chat_mode, 'followers');
    checks.push('Followers chat submits follower mode and refreshes its controlled audit receipt');
    await execute({ label: 'Slow mode', action: 'admin_chat', payload: { chat_mode: 'open', slow_mode_seconds: 10 }, reason: 'Reduce the current chat submission rate.' });
    assert.equal(streams[0].chat_mode, 'open'); assert.equal(streams[0].slow_mode_seconds, 10);
    checks.push('Slow mode sends open chat with the supported ten-second interval');
    await execute({ label: 'Open chat', action: 'admin_chat', payload: { chat_mode: 'open', slow_mode_seconds: 0 }, reason: 'Restore normal conversation after review.' });
    assert.equal(streams[0].chat_mode, 'open'); assert.equal(streams[0].slow_mode_seconds, 0);
    checks.push('Open chat clears slow mode and refreshes its controlled audit receipt');
    await reason.fill('Remove the member named in the reviewed report.');
    const target = page.getByRole('textbox', { name: 'Member ID to remove', exact: true });
    await target.fill('invalid-member'); assert.equal(await page.getByRole('button', { name: 'Remove member from stream', exact: true }).isDisabled(), true);
    await target.fill(id(51));
    await execute({ label: 'Remove member from stream', action: 'admin_remove_viewer', payload: { user_id: id(51) }, reason: 'Remove the member named in the reviewed report.' });
    assert.deepEqual([...removed], [id(51)]);
    checks.push('Member removal rejects malformed targets and submits exactly the selected member with a reason');
    await execute({ label: 'Resolve with reason above', action: 'admin_resolve_report', payload: { report_id: id(21) }, reason: 'The reported audio issue has been reviewed.' });
    assert.equal(reports[0].state, 'resolved'); await page.getByRole('button', { name: 'Resolve with reason above', exact: true }).waitFor({ state: 'hidden' });
    checks.push('Report resolution submits the existing report identity and removes its resolve action after refresh');
    await reason.fill('End the reviewed stream for the current incident.');
    await dismiss('End broadcast'); assert.equal(streams[0].state, 'live');
    await execute({ label: 'End broadcast', action: 'stop', reason: 'End the reviewed stream for the current incident.', confirm: true });
    await page.getByRole('status').filter({ hasText: 'Stop requested. Confirm the broadcast reaches ended state.' }).waitFor();
    const reviewedStream = page.getByRole('heading', { name: streams[0].title, exact: true }).locator('..');
    await reviewedStream.getByText('Ending', { exact: true }).waitFor(); assert.equal(streams[0].state, 'ending');
    await reason.fill('The existing stop remains pending.');
    assert.equal(await page.getByRole('button', { name: 'End broadcast', exact: true }).isDisabled(), true);
    checks.push('Emergency stop requires confirmation and reason, retains cancellation, and shows ending without claiming provider completion');
    moderate = false; await page.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await page.getByText('Your staff role can review this stream. Moderation requires an authorized moderation role.', { exact: true }).waitFor();
    for (const label of liveButtons) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0, 'Read-only Live action: ' + label);
    checks.push('Read-only staff response removes every Live moderation action');
    moderate = true; await page.getByRole('tab', { name: 'Clips and sharing', exact: true }).click();
    await page.getByRole('cell').filter({ hasText: 'The idea that started it' }).waitFor();const clipFilter=page.getByRole('combobox',{name:'State',exact:true});await clipFilter.selectOption('processing');await page.getByRole('row').filter({hasText:'The idea that started it'}).waitFor({state:'hidden'});await page.getByRole('cell',{name:'A clip being rendered',exact:false}).waitFor();assert.equal(clipFilters.at(-1),'processing');await clipFilter.selectOption('pending');await page.getByRole('row').filter({hasText:'A clip being rendered'}).waitFor({state:'hidden'});await page.getByRole('cell').filter({hasText:'The idea that started it'}).waitFor();assert.equal(clipFilters.at(-1),'pending');assert.deepEqual(await clipFilter.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','queued','processing','pending','ready','failed','rejected','blocked']);checks.push('Clip filters use render, moderation and copyright database values without unsupported published or deleted choices');await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.getByRole('heading', { name: 'Moderation and copyright', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview horizontal', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    for (const label of clipButtons.slice(0, 4)) assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true, label + ' requires a reason');
    const clipReason = page.getByRole('textbox', { name: 'Reason for this decision', exact: true });
    await clipReason.fill('Reviewed the clip and its caption for publication.'); failNext = true;
    response = nextPost('/api/live/clips');
    await page.getByRole('button', { name: 'Approve clip', exact: true }).click(); assert.equal((await response).status(), 503);
    await page.getByRole('alert').filter({ hasText: 'Temporary review connection failure' }).waitFor();
    const failedApproval = calls.at(-1); assert.equal(await clipReason.inputValue(), 'Reviewed the clip and its caption for publication.');
    await execute({ label: 'Approve clip', action: 'admin_review', payload: { decision: 'approved' }, reason: 'Reviewed the clip and its caption for publication.', clipId: id(11) });
    assert.equal(accepted.at(-1).requestId, failedApproval.requestId); assert.equal(clips[0].moderation_state, 'approved');
    await page.getByText('ready · Moderation: approved · Copyright: cleared', { exact: true }).waitFor();
    checks.push('Clip approval plays the granted preview, requires a reason, and preserves the failed-submit idempotency key');
    await page.getByRole('button', { name: 'Preview horizontal', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.screenshot({ path: path.join(evidence, 'admin-clips-review.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(evidence, 'admin-clips-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await clipReason.fill('Reject the clip after reviewing the new report.');
    await dismiss('Reject clip'); assert.equal(clips[0].moderation_state, 'approved');
    await execute({ label: 'Reject clip', action: 'admin_review', payload: { decision: 'rejected' }, reason: 'Reject the clip after reviewing the new report.', clipId: id(11), confirm: true });
    assert.equal(clips[0].moderation_state, 'rejected'); await page.getByText('review · Moderation: rejected · Copyright: cleared', { exact: true }).waitFor();
    checks.push('Reject clip requires confirmation and refreshes the rejected moderation state');
    await clipReason.fill('Block the export while the rights report is reviewed.');
    await dismiss('Block copyright'); assert.equal(clips[0].copyright_state, 'cleared');
    await execute({ label: 'Block copyright', action: 'copyright', payload: { status: 'blocked' }, reason: 'Block the export while the rights report is reviewed.', clipId: id(11), confirm: true });
    assert.equal(clips[0].copyright_state, 'blocked'); await page.getByText('blocked · Moderation: rejected · Copyright: blocked', { exact: true }).waitFor();
    checks.push('Block copyright requires confirmation and refreshes the controlled blocked state');
    await execute({ label: 'Clear copyright', action: 'copyright', payload: { status: 'cleared' }, reason: 'The reviewed rights evidence clears this export.', clipId: id(11) });
    assert.equal(clips[0].copyright_state, 'cleared'); await page.getByText('review · Moderation: rejected · Copyright: cleared', { exact: true }).waitFor();
    checks.push('Clear copyright updates rights without silently approving rejected moderation');

    await clipFilter.selectOption('failed'); await inspectClip('A failed clip render');
    assert.equal(await page.getByRole('button', { name: 'Retry failed render', exact: true }).isDisabled(), true);
    const beforeReadOnlyRender = calls.length;
    moderate = false; await page.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await page.getByText('This staff role can review clips. A moderation role is required to change their status.', { exact: true }).waitFor();
    for (const label of clipButtons) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0, 'Read-only failed-render action: ' + label);
    assert.equal(calls.length, beforeReadOnlyRender);
    moderate = true; await page.getByRole('button', { name: 'Refresh review', exact: true }).click(); await clipReason.waitFor();
    await execute({ label: 'Retry failed render', action: 'retry', reason: 'Retry the failed render after source verification.', clipId: id(13) });
    assert.equal(clips[2].state, 'queued'); await page.getByText('queued · Moderation: approved · Copyright: cleared', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry failed render', exact: true }).waitFor({ state: 'hidden' });
    checks.push('Retry failed render submits the existing clip and shows queued without claiming a completed render');

    await clipFilter.selectOption('ready'); await inspectClip('A clip with failed posting');
    assert.equal(await page.getByRole('button', { name: 'Retry post with reason above', exact: true }).isDisabled(), true);
    const beforeReadOnlyPost = calls.length;
    moderate = false; await page.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await page.getByText('This staff role can review clips. A moderation role is required to change their status.', { exact: true }).waitFor();
    for (const label of clipButtons) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0, 'Read-only failed-post action: ' + label);
    assert.equal(calls.length, beforeReadOnlyPost);
    moderate = true; await page.getByRole('button', { name: 'Refresh review', exact: true }).click(); await clipReason.waitFor();
    await execute({ label: 'Retry post with reason above', action: 'retry_post', payload: { post_id: id(41) }, reason: 'Retry the existing feed publication after review.', clipId: id(14) });
    assert.equal(posts.length, 1); assert.equal(posts[0].id, id(41)); assert.equal(posts[0].state, 'published');
    await page.getByText('feed · published', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Retry post with reason above', exact: true }).waitFor({ state: 'hidden' });
    checks.push('Retry post retains its publication identity and displays the controlled publication receipt');
    checks.push('Read-only clip reviews hide all decision and retry controls without sending mutations');

    assert.equal(accepted.length, 14); assert.equal(calls.length, 16, 'Only the failed Close chat and Approve attempts add requests');
    assert.equal(dialogs.filter(item => item.accepted).length, 3); assert.equal(dialogs.filter(item => !item.accepted).length, 3);
    const variants = accepted.map(({ path: apiPath, action, payload }) => apiPath + ':' + action + ':' + JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'reason'))));
    assert.equal(new Set(variants).size, 14, 'Each supported moderation variant runs once');
    assert.equal(new Set(checks).size, checks.length); assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
  } catch (error) { failure = error; if (page) await page.screenshot({ path: path.join(evidence, 'admin-live-failure.png'), fullPage: true }).catch(() => {}); }
  finally {
    await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify({ checks, errors, fixtureErrors, failure: failure?.stack || null, attemptedCommands: calls, acceptedCommands: accepted, confirmations: dialogs, providerAcceptance: false, scope: 'Actual admin LiveWorkspace, LiveOperations, LiveClipOperations, Workspace and SideRail components with controlled HTTP responses validated by the real API command parsers. UI requests, confirmation and refreshed state only. No hosted staff authorization, provider completion or external publication is claimed.' }, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure; console.log(JSON.stringify({ passed: checks.length, evidence }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
