const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const YAML = require('yaml');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/backend-fixture.cjs');
const { feedVideoOverlay, feedRefreshOverlay } = require('../../scripts/quality/native-ui-feed-video-overlay.cjs');
const root = path.resolve(__dirname, '../..');

test('concurrent feed reads materialize one packaged video and refresh preserves its media identity', async () => {
  let calls = 0;
  const fixture = createFixture(() => {}, { feedVideoSource: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 'file:///packaged/fixture.mp4';
  } });
  const client = createClient('https://uaulhuelcfkjwojtymmw.supabase.co', 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch },
  });
  await client.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  const [first, concurrent] = await Promise.all([client.rpc('get_feed'), client.rpc('get_feed')]);
  const refreshed = await fixture.observeFeedRefresh(async () => await client.rpc('get_feed'));
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(first.data.length, 8); assert.equal(concurrent.data.length, 8);
  assert.deepEqual(refreshed.data[0].media, first.data[0].media);
  assert.equal(first.data[0].media[0].media_type, 'video');
  assert.equal(first.data.at(-1).content, 'Feed scroll checkpoint.');
  assert.equal((await client.from('post_media_tags').select('*')).data.length, 0);
  assert.equal(fixture.receipt.unhandled.length, 0);
  assert.deepEqual(fixture.receipt.feedRefreshes, [{ before: 2, after: 3, completed: true }]);
  const rejected = Promise.reject(new Error('refresh failed'));
  assert.equal(fixture.observeFeedRefresh(() => rejected), rejected);
  await assert.rejects(rejected, /refresh failed/);
  assert.equal(fixture.receipt.feedRefreshes.at(-1).completed, false);
  assert.equal(fixture.receipt.feedRefreshes.at(-1).after, 3);
  await client.auth.signOut();
});

test('the playback gate requires a painted frame, current ownership, ready source and advancing native time', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/PostCarousel.tsx'), 'utf8');
  const changed = feedVideoOverlay(source);
  const ast = ts.createSourceFile('PostCarousel.tsx', changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.throws(() => feedVideoOverlay(changed), /Expected one/);
  const expression = changed.match(/accessibilityLabel=\{(hasFrame[^\n]+)\}/)[1];
  const good = { hasFrame: true, owns: true, sourceReady: true, musicClock: { playing: true, time: 0.5 } };
  assert.equal(vm.runInNewContext(expression, good), 'Native feed video playing');
  for (const bad of [{ hasFrame: false }, { owns: false }, { sourceReady: false },
    { musicClock: { playing: false, time: 1 } }, { musicClock: { playing: true, time: 0 } }]) {
    assert.equal(vm.runInNewContext(expression, { ...good, ...bad }), 'Native feed video waiting');
  }
  const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'tests/native/flows/feed-video.yaml'), 'utf8'))[1].toJSON();
  assert.equal(flow.filter(command => command.extendedWaitUntil?.visible === 'Native feed video playing').length, 4);
  assert.equal(flow.some(command => command.swipe), true);
  assert.equal(flow.some(command => command.launchApp || command.retry), false);
  const feed = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
  const refresh = feedRefreshOverlay(feed);
  assert.equal(ts.createSourceFile('FeedScreen.tsx', refresh, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
  assert.throws(() => feedRefreshOverlay(refresh), /Expected one/);
});

test('clipped media bounds do not establish production autoplay eligibility', () => {
  const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'reportHistoryVisible') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback, 'The actual measured-history visibility callback must exist');
  let visible;
  // Retained ed582 Android geometry: 240px media, 157px above it and 76px below it.
  // The return screenshot exposes 254px of this 473px post in a 445px viewport.
  const scope = {
    historyGeometryScope: { current: 'account:feed' }, feedScopeRef: { current: 'account:feed' },
    historyRef: { current: { getSnapshot: () => ({ before: 0, pages: [{ index: 0, height: 662, rows: [{ id: 'video' }, { id: 'next' }] }] }) } },
    scrollOffsetRef: { current: 219 }, historyHeaderHeight: { current: 0 }, historyViewport: { current: 445 },
    historyRects: { current: new Map([['video', { page: 0, y: 0, height: 473 }], ['next', { page: 0, y: 473, height: 189 }]]) },
    promoRowsRef: { current: [] },
    displayPosts: [{ id: 'video' }, { id: 'next' }], onViewableItemsChanged(value) { visible = value.viewableItems.map(item => item.item.id); },
  };
  vm.runInNewContext(ts.transpileModule('globalThis.report = ' + callback.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  scope.report(); assert.deepEqual(Array.from(visible), ['next'], 'The clipped return position correctly does not activate the video');
  scope.scrollOffsetRef.current = 132; scope.report();
  assert.equal(visible[0], 'video', 'The retained initial playing position meets the same production rule');

});

test('platform video acquisition respects Android clipped bounds and the iPhone fixed header', () => {
  const flow = YAML.parseAllDocuments(fs.readFileSync(path.join(root, 'tests/native/flows/feed-video.yaml'), 'utf8'))[1].toJSON();
  function platformCommands(commands, platform) {
    return commands.flatMap(command => command.runFlow?.when?.platform
      ? command.runFlow.when.platform === platform ? platformCommands(command.runFlow.commands, platform) : []
      : [command]);
  }
  for (const platform of ['Android', 'iOS']) {
    const commands = platformCommands(flow, platform);
    const acquisitions = commands.filter(command => command.scrollUntilVisible?.element?.id === 'native-feed-video');
    assert.equal(acquisitions.length, 3, platform + ' must acquire the initial, returned and refreshed video');
    for (const command of acquisitions) assert.deepEqual(command.scrollUntilVisible, {
      element: { id: 'native-feed-video' }, direction: 'DOWN', visibilityPercentage: 100, centerElement: platform === 'Android',
    });
    for (const command of acquisitions) {
      assert.deepEqual(commands[commands.indexOf(command) + 1], {
        extendedWaitUntil: { visible: 'Native feed video playing', timeout: 15000 },
      }, platform + ' must prove actual playback immediately after each acquisition');
    }
  }
  const gates = flow.filter(command => command.extendedWaitUntil?.visible === 'Native feed video playing');
  assert.equal(gates.length, 4);
  for (const gate of gates) assert.equal(gate.extendedWaitUntil.timeout, 15000);

  // e221 iPhone artifact 13388330985 found the final checkpoint fully visible
  // at [0,595][402,646] after 16s. Centering repeatedly requested more scroll
  // beyond the list boundary until the original 20s deadline expired.
  const checkpointBounds = { top: 595, bottom: 646 };
  const viewportBounds = { top: 184, bottom: 840 };
  assert.ok(checkpointBounds.top >= viewportBounds.top && checkpointBounds.bottom <= viewportBounds.bottom);
  const iosCommands = platformCommands(flow, 'iOS');
  const checkpoint = iosCommands.findIndex(command => command.scrollUntilVisible?.element === 'Feed scroll checkpoint.');
  assert.deepEqual(iosCommands[checkpoint], { scrollUntilVisible: {
    element: 'Feed scroll checkpoint.', direction: 'DOWN', visibilityPercentage: 100, timeout: 20000, centerElement: false,
  } });
  assert.deepEqual(iosCommands[checkpoint + 1], { assertNotVisible: 'Native feed video playing' },
    'Reaching the final row must still prove that the first video stopped');
  assert.deepEqual(platformCommands(flow, 'Android').find(command => command.scrollUntilVisible?.element === 'Feed scroll checkpoint.'), {
    scrollUntilVisible: { element: 'Feed scroll checkpoint.', direction: 'DOWN', centerElement: true },
  }, 'Keep the passing Android checkpoint behavior unchanged');

  // Current-source iPhone artifact 13377228916, SHA256
  // be9ed79dced40bd3189b3b9691496bde53a808fbaebf11d55ab3c62c99824db0.
  // Maestro observed playback before centering. The real row was 523px tall,
  // the list viewport [184,840], and centering moved row top from 414 to -92.
  // The media alone was reported 100% visible against the device, although the
  // fixed header obscured it. Exercise the actual production row calculation.
  const source = fs.readFileSync(path.join(root, 'src/screens/feed/FeedScreen.tsx'), 'utf8');
  const ast = ts.createSourceFile('FeedScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'reportHistoryVisible') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback);
  let visible;
  const scope = {
    historyGeometryScope: { current: 'account:feed' }, feedScopeRef: { current: 'account:feed' },
    historyRef: { current: { getSnapshot: () => ({ before: 0, pages: [{ index: 0, height: 1000, rows: [{ id: 'video' }] }] }) } },
    scrollOffsetRef: { current: -230 }, historyHeaderHeight: { current: 0 }, historyViewport: { current: 656 },
    historyRects: { current: new Map([['video', { page: 0, y: 0, height: 523 }]]) },
    promoRowsRef: { current: [] }, displayPosts: [{ id: 'video' }],
    onViewableItemsChanged(value) { visible = value.viewableItems.map(item => item.item.id); },
  };
  vm.runInNewContext(ts.transpileModule('globalThis.report = ' + callback.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  scope.report(); assert.deepEqual(Array.from(visible), ['video']);
  scope.scrollOffsetRef.current = 276; scope.report();
  assert.deepEqual(Array.from(visible), [], '47.2% of the post remains visible after the unnecessary centering scroll');

  // Android artifact 13387079306 reported only [0,531][320,592] for the
  // 240px video. Maestro called that 61px clipped target 100% visible and did
  // not scroll. The post starts at 383 and the viewport is [147,592]. Its
  // header plus video alone is 388px, before any footer, so even the maximum
  // possible initial row visibility is 209/388, below the production 55%.
  // The prior passing artifact 13378276809 had identical initial bounds.
  // Centering scrolled 327px to expose the full video at [0,204][320,444].
  scope.historyViewport.current = 445;
  scope.historyRects.current.get('video').height = 388;
  scope.scrollOffsetRef.current = -236;
  scope.report(); assert.deepEqual(Array.from(visible), [], 'The clipped Android target must not be treated as a playable row');
  scope.scrollOffsetRef.current += 327;
  scope.report(); assert.deepEqual(Array.from(visible), ['video'], 'Android centering restores a playable row in the actual viewport');
});
