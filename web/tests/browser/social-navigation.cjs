/** Actual Home/Messages components, deliberately held synthetic reads, real Chromium frames. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const frameTurns = (page, count) => page.evaluate(count => new Promise(resolve => {
  const next = () => { if (--count <= 0) resolve(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);

async function startProbe(page, destination) {
  await page.evaluate(destination => {
    const probe = { destination, startedAt: null, stopped: false, frames: [] };
    window.__warmNavigationProbe = probe;
    document.addEventListener('click', () => { probe.startedAt = performance.now(); }, { capture: true, once: true });
    const visible = element => {
      if (!element?.isConnected) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        if (ancestor !== element) {
          const bounds = ancestor.getBoundingClientRect();
          if (style.overflowX !== 'visible') { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
          if (style.overflowY !== 'visible') { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
        }
      }
      return right > left && bottom > top;
    };
    const sample = time => {
      if (probe.stopped) return;
      const home = document.querySelector('[data-feed-owner]');
      const posts = [...document.querySelectorAll('[data-feed-content] [data-pid]')];
      const conversation = document.querySelector('[aria-label="Conversation"]');
      const messages = [...(conversation?.querySelectorAll('[data-message-id]') ?? [])];
      const list = conversation?.querySelector('[class~="overflow-y-auto"]');
      const draft = document.querySelector('textarea[aria-label="Message"]');
      const search = document.querySelector('input[aria-label="Search conversations"]');
      const observedAt = performance.now();
      if (probe.startedAt !== null) probe.frames.push({ time, observedAt, sinceClickMs: observedAt - probe.startedAt,
        path: location.pathname, home: !!home, posts: posts.length, visiblePosts: posts.filter(visible).length,
        conversation: !!conversation, messages: messages.length, visibleMessages: messages.filter(visible).length,
        windowTop: scrollY, messageTop: list?.scrollTop ?? null, draft: draft?.value ?? null,
        query: search?.value ?? null, detailsOpen: !!document.querySelector('aside[aria-label="Conversation details"]'),
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, destination);
}

async function stopProbe(page, expected) {
  const result = await page.evaluate(() => {
    const probe = window.__warmNavigationProbe;
    probe.stopped = true;
    return { ...probe, stoppedAt: performance.now() };
  });
  assert.ok(result.frames.length >= 30, 'the delayed interval must include sustained animation-frame observations');
  const incoming = result.frames.filter(frame => frame.path === result.destination && (result.destination === '/home' ? frame.home : frame.conversation));
  assert.ok(incoming.length >= 30, 'the destination was observed throughout the held refresh');
  const blank = result.frames.filter(frame => frame.visiblePosts + frame.visibleMessages === 0);
  assert.equal(blank.length, 0, 'no animation frame may lose both outgoing and incoming loaded content');
  for (const frame of incoming) {
    if (result.destination === '/home') {
      assert.equal(frame.posts, expected.posts, 'loaded Home rows remain while the refresh is held');
      assert.ok(Math.abs(frame.windowTop - expected.top) <= 1, `Home scroll moved from ${expected.top} to ${frame.windowTop} at ${frame.sinceClickMs}ms`);
    } else {
      assert.equal(frame.messages, expected.messages, 'the restored conversation does not become a loading placeholder');
      assert.ok(Math.abs(frame.messageTop - expected.top) <= 1, `conversation scroll moved from ${expected.top} to ${frame.messageTop} at ${frame.sinceClickMs}ms`);
      assert.equal(frame.draft, expected.draft); assert.equal(frame.query, expected.query);
      assert.equal(frame.detailsOpen, expected.detailsOpen);
    }
  }
  return { destination: result.destination, clickAt: result.startedAt, stoppedAt: result.stoppedAt,
    firstDestinationFrameMs: incoming[0].sinceClickMs, sampledFrames: result.frames.length,
    destinationFrames: incoming.length, blankContentFrames: blank.length, expected,
    maxFrameIntervalMs: Math.max(...result.frames.slice(1).map((frame, index) => frame.time - result.frames[index].time)),
    frames: result.frames };
}

async function runWarmNavigation(browser, origin, artifacts) {
  const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const probes = [];
  try {
    await page.goto(origin + '/home');
    await page.getByText('A slower morning on the coast.', { exact: false }).waitFor();
    await page.evaluate(() => { window.__socialFixture.prepareNavigationRows(); window.dispatchEvent(new Event('pc-refresh-feed')); });
    await page.waitForFunction(() => document.querySelectorAll('[data-feed-content] [data-pid]').length === 16);
    await page.evaluate(() => scrollTo({ top: 780, behavior: 'instant' })); await frameTurns(page, 3);
    const homeTop = await page.evaluate(() => scrollY); assert.ok(homeTop > 500);
    await page.getByRole('link', { name: 'Messages', exact: true }).first().click();
    await page.getByRole('button', { name: 'Open conversation with Jordan Ellis', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Conversation"] [data-message-id]').length === 34);
    const draft = 'A warm navigation draft stays with this account.';
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(draft);
    await page.getByRole('textbox', { name: 'Search conversations', exact: true }).fill('Jordan');
    await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
    await page.evaluate(() => { document.querySelector('[aria-label="Conversation"] [class~="overflow-y-auto"]').scrollTop = 247; });
    await frameTurns(page, 3);
    const messageTop = await page.evaluate(() => document.querySelector('[aria-label="Conversation"] [class~="overflow-y-auto"]').scrollTop);
    assert.equal(messageTop, 247);
    await page.evaluate(() => { window.__socialFixture.clear(); window.__socialFixture.holdNavigationReads(['feed', 'conversations', 'messages']); });

    await startProbe(page, '/home');
    await page.getByRole('link', { name: 'Home', exact: true }).first().click();
    await page.waitForFunction(() => window.__socialFixture.receipt.some(row => row.operation === 'heldNavigationRead' && row.kind === 'feed' && !row.finishedAt));
    await frameTurns(page, 36);
    probes.push(await stopProbe(page, { posts: 16, top: homeTop }));
    await page.screenshot({ path: path.join(artifacts, 'warm-home-refresh-held.png') });
    await page.evaluate(() => window.__socialFixture.releaseNavigationReads(['feed']));
    await frameTurns(page, 5);
    assert.equal(await page.evaluate(() => scrollY), homeTop, 'completing the Home refresh does not move the visible page');

    await startProbe(page, '/messages');
    await page.getByRole('link', { name: 'Messages', exact: true }).first().click();
    await page.waitForFunction(() => window.__socialFixture.receipt.some(row => row.operation === 'heldNavigationRead' && row.kind === 'conversations' && !row.finishedAt));
    await frameTurns(page, 36);
    await page.evaluate(() => window.__socialFixture.releaseNavigationReads(['conversations']));
    await page.waitForFunction(() => window.__socialFixture.receipt.some(row => row.operation === 'heldNavigationRead' && row.kind === 'messages' && !row.finishedAt));
    await frameTurns(page, 36);
    probes.push(await stopProbe(page, { messages: 34, top: messageTop, draft, query: 'Jordan', detailsOpen: false }));
    await page.screenshot({ path: path.join(artifacts, 'warm-messages-refresh-held.png') });
    await page.evaluate(() => window.__socialFixture.releaseNavigationReads(['messages']));
    await frameTurns(page, 5);
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), draft);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Conversation"] [class~="overflow-y-auto"]').scrollTop), messageTop);
    assert.deepEqual(errors, []);
    const held = await page.evaluate(() => window.__socialFixture.receipt.filter(row => row.operation === 'heldNavigationRead'));
    assert.ok(held.some(row => row.kind === 'feed') && held.some(row => row.kind === 'conversations') && held.some(row => row.kind === 'messages'));
    assert.ok(held.every(row => row.finishedAt > row.startedAt && !row.aborted));
    const receipt = { checkedAt: new Date().toISOString(), runtime: await browser.version(),
      scope: 'Actual HomeFeed, MessagesApp, navigation cache and scroll logic in Chromium. Auth/database reads and Next routing are synthetic local adapters. requestAnimationFrame samples inspect layout and content paintability; this is not GPU frame-time, real-network or hosted Next-routing measurement.',
      viewport: { width: 1586, height: 992 }, probes, heldReads: held, browserErrors: errors };
    await fs.writeFile(path.join(artifacts, 'warm-navigation-frames.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'warm-navigation-failure.png') });
    await fs.writeFile(path.join(artifacts, 'warm-navigation-failure.json'), JSON.stringify({ error: String(error), probes,
      pendingProbe: await page.evaluate(() => window.__warmNavigationProbe ?? null), browserErrors: errors }, null, 2) + '\n');
    throw error;
  } finally {
    await page.evaluate(() => window.__socialFixture?.releaseNavigationReads(['feed', 'conversations', 'messages'])).catch(() => {});
    await context.close();
  }
}

module.exports = { runWarmNavigation };
