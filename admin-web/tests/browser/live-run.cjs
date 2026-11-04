/** Actual admin Live components against a controlled HTTP API, never hosted credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
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

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(output, 'clip.mp4')]);
  const calls = [], checks = [], errors = [], clipFilters = [];
  let moderate = true, failNext = false, browser, page, failure;
  const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    try {
      if (url.pathname.startsWith('/api/live')) {
        if (req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk;
          const command = JSON.parse(body); calls.push({ path: url.pathname, ...command });
          if (failNext) { failNext = false; return json(res, { error: 'Temporary review connection failure. Retry with your saved reason.' }, 503); }
          if (command.action === 'admin_review') clip.moderation_state = command.payload.decision;
          return json(res, { ok: true });
        }
        if (url.pathname === '/api/live/clips') {
          if (url.searchParams.has('format')) return json(res, { url: `http://${req.headers.host}/clip.mp4`, expires_at: new Date(Date.now() + 120000).toISOString() });
          if (url.searchParams.has('clip')) return json(res, { clip, permissions: { moderate }, posts: { items: [] }, connections: { items: [] }, audit: { items: [] }, analytics: { views: 0, shares: 0 } });
          const state=url.searchParams.get('state');clipFilters.push(state);const rendering={...clip,id:id(12),title:'A clip being rendered',state:'processing',moderation_state:'approved'};return json(res, { items: [clip,rendering].filter(item=>!state||(item.state==='review'?'ready':item.state)===state||item.moderation_state===state||item.copyright_state===state), next_cursor: null });
        }
        if (url.searchParams.has('session')) {
          const session = streams.find(item => item.id === url.searchParams.get('session')) || streams[0];
          return json(res, { session, permissions: { moderate }, provider: { configured: true, last_event_at: '2026-11-04T02:00:00Z' }, reports: { items: [{ id: id(21), reason: 'A viewer reported distorted audio.', state: 'open', created_at: '2026-11-04T02:02:00Z' }] }, audit: { items: [] }, messages: { items: [{ id: id(31), author: { full_name: 'Taylor' }, body: 'How did you get started?' }] }, analytics: { current_viewers: 24, peak_viewers: 31, unique_viewers: null, watch_minutes: null, chat_messages: 8, reactions: 3, clips: 1, clip_views: 0, clip_shares: 0 } });
        }
        const filter = url.searchParams.get('state');
        return json(res, { items: streams.filter(item => !filter || item.state === filter), next_cursor: null, capabilities: { create: true, broadcast: true, view: true, recording: true, reminders: true } });
      }
      const name = ['fixture.js', 'fixture.css', 'logo.png', 'pearl.png', 'clip.mp4'].includes(path.basename(url.pathname)) ? path.basename(url.pathname) : 'index.html';
      const body = await fs.readFile(path.join(output, name));
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.mp4') ? 'video/mp4' : 'text/html' }); res.end(body);
    } catch { json(res, { error: 'Fixture request failed' }, 500); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLATINUM_CHROMIUM, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/live`);
    await page.getByRole('cell', { name: 'Inside the creator studio', exact: true }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Admin Live overflow at ${width}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(evidence, `admin-live-${width}.png`), fullPage: true });
    }
    checks.push('Actual admin Live directory fits320,390,768,1440 widths and preserves state labels and unknown counts');
    await page.getByRole('combobox', { name: 'Filter stream state', exact: true }).selectOption('live');
    await page.getByRole('row').filter({ hasText: 'Music after hours' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Review', exact: true }).first().click();
    const reason = page.getByRole('textbox', { name: 'Reason for this action', exact: true }); await reason.waitFor();
    assert.equal(await page.getByRole('button', { name: 'End broadcast', exact: true }).isDisabled(), true);
    await reason.fill('Review the reported audio problem with the host.'); failNext = true;
    await page.getByRole('button', { name: 'Close chat', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Temporary review connection failure' }).waitFor();
    assert.equal(await reason.inputValue(), 'Review the reported audio problem with the host.');
    await page.getByRole('button', { name: 'Close chat', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Action recorded.' }).waitFor();
    assert.equal(calls.length, 2); assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(calls[1].action, 'admin_chat'); assert.equal(calls[1].payload.chat_mode, 'closed');
    checks.push('Moderation requires a reason and failed submission preserves its draft and idempotency key');await page.getByRole('heading',{name:'Moderation',exact:true}).waitFor();
    await page.screenshot({ path: path.join(evidence, 'admin-live-review.png'), fullPage: true });
    moderate = false; await page.getByRole('button', { name: 'Refresh review', exact: true }).click();
    await page.getByText('Your staff role can review this stream. Moderation requires an authorized moderation role.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'End broadcast', exact: true }).count(), 0); checks.push('Read-only staff response removes moderation actions');
    moderate = true; await page.getByRole('tab', { name: 'Clips and sharing', exact: true }).click();
    await page.getByRole('cell').filter({ hasText: 'The idea that started it' }).waitFor();const clipFilter=page.getByRole('combobox',{name:'State',exact:true});await clipFilter.selectOption('processing');await page.getByRole('row').filter({hasText:'The idea that started it'}).waitFor({state:'hidden'});await page.getByRole('cell',{name:'A clip being rendered',exact:false}).waitFor();assert.equal(clipFilters.at(-1),'processing');await clipFilter.selectOption('pending');await page.getByRole('row').filter({hasText:'A clip being rendered'}).waitFor({state:'hidden'});await page.getByRole('cell').filter({hasText:'The idea that started it'}).waitFor();assert.equal(clipFilters.at(-1),'pending');assert.deepEqual(await clipFilter.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','queued','processing','pending','ready','failed','rejected','blocked']);checks.push('Clip filters use render, moderation and copyright database values without unsupported published or deleted choices');await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.getByRole('heading', { name: 'Moderation and copyright', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview horizontal', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    assert.equal(await page.getByRole('button', { name: 'Approve clip', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: 'Reason for this decision', exact: true }).fill('Reviewed the clip and its caption for publication.');
    await page.getByRole('button', { name: 'Approve clip', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Review action recorded.' }).waitFor();
    assert.equal(calls.at(-1).action, 'admin_review'); assert.equal(calls.at(-1).payload.decision, 'approved');
    checks.push('Clip review plays its granted preview and submits an approved decision with the review reason');await page.getByRole('button',{name:'Preview horizontal',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    await page.screenshot({ path: path.join(evidence, 'admin-clips-review.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(evidence, 'admin-clips-390.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) { failure = error; if (page) await page.screenshot({ path: path.join(evidence, 'admin-live-failure.png'), fullPage: true }).catch(() => {}); }
  finally {
    await fs.writeFile(path.join(evidence, 'receipt.json'), JSON.stringify({ checks, errors, failure: failure?.stack || null, scope: 'Actual admin LiveWorkspace, LiveOperations, LiveClipOperations, Workspace and SideRail components with controlled HTTP responses. UI and request behavior, not hosted staff authorization or production data.' }, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure; console.log(JSON.stringify({ passed: checks.length, evidence }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
