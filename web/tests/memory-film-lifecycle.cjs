const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { createFilmHarness } = require('../../tests/helpers/memoryFilmHarness.cjs');

const filmVideo = h => h.nodes().find(node => typeof node.type === 'function' && node.type.name === 'FilmVideo');
const progress = h => h.nodes().find(node => node.props.role === 'progressbar').props['aria-valuenow'];
const videoPages = [
  { id: 'first', media_type: 'video', media_url: 'signed:first-video' },
  { id: 'second', media_type: 'video', media_url: 'signed:second-video' },
];

for (const boundary of [
  { name: 'manual pause', stop: h => h.press('Pause memory film'), resume: h => h.press('Play memory film') },
  { name: 'background', stop: h => h.setForeground(false), resume: h => h.setForeground(true) },
  { name: 'active call', stop: h => h.setCall('connected'), resume: h => h.setCall('idle') },
]) {
  test(`web initial loading deadline excludes ${boundary.name} and restarts on resume`, async () => {
    const h = createFilmHarness(ts, 'web');
    try {
      await h.settle();
      await h.tick(12000);
      boundary.stop(h);
      await h.settle();
      await h.tick(90000);
      assert.doesNotMatch(h.words(), /taking too long|could not play/);
      assert.match(h.words(), /Loading memory/);
      boundary.resume(h);
      await h.settle();
      await h.tick(19000);
      assert.doesNotMatch(h.words(), /taking too long/);
      await h.tick(1000);
      assert.match(h.words(), /taking too long/);
      assert.match(h.words(), /1 \/ 2/);
    } finally { h.dispose(); }
    assert.equal(h.timerCount, 0);
  });
}

test('web late image readiness cannot replace the current ready page or satisfy a new loop', async () => {
  const h = createFilmHarness(ts, 'web');
  try {
    await h.settle();
    const firstReady = h.nodes().find(node => node.type === 'MemoryPageImage').props.onReady;
    h.press('Next memory');
    await h.settle();
    h.mediaReady();
    await h.settle();
    firstReady();
    await h.settle();
    assert.doesNotMatch(h.words(), /Loading memory/);
    await h.tick(3000);
    assert.equal(progress(h), 50);

    h.press('Next memory');
    await h.settle();
    assert.match(h.words(), /1 \/ 2/);
    firstReady();
    await h.settle();
    assert.match(h.words(), /Loading memory/);
    assert.equal(progress(h), 0);
    h.mediaReady();
    await h.settle();
    assert.doesNotMatch(h.words(), /Loading memory/);
  } finally { h.dispose(); }
});

test('web stale video callbacks cannot replace current progress, readiness, or an actionable failure', async () => {
  const h = createFilmHarness(ts, 'web', { pages: videoPages });
  try {
    await h.settle();
    const old = filmVideo(h).props;
    h.press('Next memory');
    await h.settle();
    const current = filmVideo(h).props;
    current.onReady();
    current.onProgress(.6);
    await h.settle();
    old.onReady();
    old.onProgress(.95);
    old.onError();
    old.onEnd();
    await h.settle();
    assert.match(h.words(), /2 \/ 2/);
    assert.doesNotMatch(h.words(), /Loading memory|could not play/);
    assert.equal(progress(h), 60);

    current.onError();
    await h.settle();
    assert.match(h.words(), /could not play/);
    old.onError();
    old.onReady();
    old.onProgress(1);
    await h.settle();
    assert.match(h.words(), /could not play/);
    assert.equal(filmVideo(h).props.active, false);
    assert.equal(progress(h), 60);
    assert.equal(h.audioNode.paused, true);
  } finally { h.dispose(); }
});

test('web stalled video stays stopped across foreground and active changes until remount', async () => {
  const h = createFilmHarness(ts, 'web', { component: 'video' });
  try {
    await h.settle();
    h.nodes().find(node => node.type === 'video').props.onLoadedMetadata();
    await h.settle();
    await h.tick(20000);
    assert.equal(h.failed, 1);
    assert.equal(h.videoNode.paused, true);
    h.setActive(false);
    await h.settle();
    h.setActive(true);
    await h.settle();
    h.setForeground(false);
    await h.settle();
    h.setForeground(true);
    await h.settle();
    const video = h.nodes().find(node => node.type === 'video');
    h.videoNode.currentTime = 5;
    video.props.onTimeUpdate({ currentTarget: h.videoNode });
    video.props.onEnded();
    await h.tick(20000);
    assert.equal(h.failed, 1);
    assert.equal(h.ended, 0);
    assert.equal(h.videoNode.paused, true);
  } finally { h.dispose(); }
  assert.equal(h.timerCount, 0);
});
