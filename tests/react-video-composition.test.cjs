const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/reactVideoComposition.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, scope);
const { buildReactTimeline, trimReactTimeline, reactSourceAt, replaceReactSourceWindow, reactRects, validateReactRequest, validateReactResult } = scope.exports;
const events = [{ at: 0, sourceTime: 0, playing: true, volume: .7 }, { at: 8, sourceTime: 8, playing: false, volume: .7 }, { at: 20, sourceTime: 8, playing: true, volume: .7 }];
const timeline = () => buildReactTimeline(events, 32, 20, 'video');
const plain = value => JSON.parse(JSON.stringify(value));
const request = () => ({ id: 'react-test-export', sourceUri: 'file:///cache/source.mp4', sourceKind: 'video', cameraUri: 'file:///cache/camera.mp4', outputUri: 'file:///cache/pc-react-export-test.mp4', width: 720, height: 1280, cameraStart: 0, duration: 32, segments: timeline(), sourceRect: { x: 0, y: 0, width: .5, height: 1 }, faceRect: { x: .5, y: 0, width: .5, height: 1 }, voiceVolume: 1, sourceZoom: 1, cutout: false });

test('a 20-second source plus a 12-second explanation exports a continuous 32-second take', () => {
  const segments = timeline();
  assert.deepEqual(plain(segments), [
    { start: 0, end: 8, sourceStart: 0, playing: true, volume: .7 },
    { start: 8, end: 20, sourceStart: 8, playing: false, volume: 0 },
    { start: 20, end: 32, sourceStart: 8, playing: true, volume: .7 },
  ]);
  for (const time of [8, 10, 19.999]) assert.deepEqual(plain(reactSourceAt(segments, time)), { time: 8, playing: false, volume: 0 });
  assert.equal(reactSourceAt(segments, 20).time, 8);
  assert.equal(reactSourceAt(segments, 31).time, 19);
  validateReactRequest(request());
});

test('replaying and seeking change only source time while camera output remains continuous', () => {
  const segments = buildReactTimeline([{ at: 0, sourceTime: 4, playing: true, volume: 1 }, { at: 6, sourceTime: 2, playing: true, volume: .2 }, { at: 11, sourceTime: 17, playing: false, volume: .2 }], 16, 30, 'video');
  assert.equal(reactSourceAt(segments, 5).time, 9);
  assert.equal(reactSourceAt(segments, 6).time, 2);
  assert.equal(reactSourceAt(segments, 10).time, 6);
  assert.equal(reactSourceAt(segments, 11).time, 17);
  assert.equal(segments.at(-1).end, 16);
  assert.equal(segments[1].volume, .2);
  assert.equal(segments[2].volume, 0);
});

test('source end automatically becomes a silent final-frame hold and never stops the camera', () => {
  const segments = buildReactTimeline([{ at: 0, sourceTime: 0, playing: true, volume: 1 }], 32, 20, 'video');
  assert.equal(segments.length, 2); assert.equal(segments[0].end, 20);
  assert.equal(segments[1].start, 20); assert.equal(segments[1].end, 32); assert.equal(segments[1].playing, false); assert.equal(segments[1].volume, 0);
  assert.ok(segments[1].sourceStart < 20 && segments[1].sourceStart >= 19.9);
});

test('a photo supplies a held source throughout the moving camera and microphone take', () => {
  const segments = buildReactTimeline([{ at: 0, sourceTime: 0, playing: true, volume: 1 }, { at: 3, sourceTime: 0, playing: false, volume: .2 }], 14, 0, 'image');
  assert.deepEqual(plain(segments), [{ start: 0, end: 14, sourceStart: 0, playing: false, volume: 0 }]);
});

test('trimming inside a hold preserves the exact source image and trims the microphone on the same clock', () => {
  const segments = trimReactTimeline(timeline(), 10, 25);
  assert.deepEqual(plain(segments), [{ start: 0, end: 10, sourceStart: 8, playing: false, volume: 0 }, { start: 10, end: 15, sourceStart: 8, playing: true, volume: .7 }]);
  const value = { ...request(), cameraStart: 10, duration: 15, segments }; validateReactRequest(value);
  const playingTrim = trimReactTimeline(timeline(), 3, 7); assert.equal(playingTrim[0].sourceStart, 3); assert.equal(playingTrim[0].end, 4);
});

test('editing a source window adds a real hold without removing or extending camera commentary', () => {
  const result = replaceReactSourceWindow(timeline(), { start: 22, end: 27, sourceTime: 4, playing: false, sourceDuration: 20, kind: 'video', volume: .7 });
  assert.equal(result.at(-1).end, 32);
  assert.equal(reactSourceAt(result, 25).time, 4); assert.equal(reactSourceAt(result, 25).volume, 0);
  assert.equal(reactSourceAt(result, 28).time, 16);
  validateReactRequest({ ...request(), segments: result });
});

test('replacing a timing window with replay preserves surrounding holds and bounds source end', () => {
  const result = replaceReactSourceWindow(timeline(), { start: 10, end: 16, sourceTime: 18, playing: true, sourceDuration: 20, kind: 'video', volume: .4 });
  assert.equal(reactSourceAt(result, 10).time, 18); assert.equal(reactSourceAt(result, 11).time, 19);
  assert.equal(reactSourceAt(result, 13).playing, false); assert.equal(reactSourceAt(result, 17).time, 8);
  validateReactRequest({ ...request(), segments: result });
});

test('rapid actions at one output frame use the final action and never emit zero-duration segments', () => {
  const segments = buildReactTimeline([{ at: 0, sourceTime: 0, playing: true, volume: 1 }, { at: 2, sourceTime: 2, playing: false, volume: 1 }, { at: 2, sourceTime: 9, playing: true, volume: .3 }], 5, 20, 'video');
  assert.equal(segments.length, 2); assert.equal(segments[1].sourceStart, 9); assert.equal(segments[1].playing, true);
  assert.ok(segments.every(segment => segment.end > segment.start));
});

test('face movement and resizing stay inside the output frame in PiP and person cutout layouts', () => {
  for (const layout of ['pip', 'cutout']) {
    const { source, face } = reactRects(layout, { x: 2, y: -1, width: 5, height: .01 });
    assert.deepEqual(plain(source), { x: 0, y: 0, width: 1, height: 1 });
    assert.ok(face.x >= 0 && face.y >= 0 && face.x + face.width <= 1.001 && face.y + face.height <= 1.001);
  }
  assert.equal(reactRects('side-by-side').source.width, .5); assert.equal(reactRects('top-bottom').face.y, .5);
});

test('native contracts reject gaps, remote or reused outputs, broken holds and invalid audio values', () => {
  for (const mutate of [value => { value.segments[1].start += .1; }, value => { value.segments[1].volume = .4; }, value => { value.outputUri = value.sourceUri; }, value => { value.cameraUri = 'https://example.com/private.mp4'; }, value => { value.voiceVolume = NaN; }, value => { value.duration = 121; }, value => { value.faceRect.x = .9; }, value => { value.segments[2].end = 31; }]) {
    const value = request(); mutate(value); assert.throws(() => validateReactRequest(value));
  }
  assert.throws(() => buildReactTimeline([{ at: 1, sourceTime: 0, playing: true, volume: 1 }], 4, 10, 'video'));
  assert.throws(() => trimReactTimeline(timeline(), 8, 7));
});

test('completed native output must preserve length, canvas, timeline and microphone mix evidence', () => {
  const input = request(), result = { uri: input.outputUri, duration: 32.02, width: 720, height: 1280, bytes: 90000, segmentCount: 3, voiceMixed: true };
  assert.equal(validateReactResult(input, result), result);
  for (const change of [{ duration: 20 }, { height: 720 }, { bytes: 0 }, { voiceMixed: false }, { segmentCount: 1 }, { uri: input.cameraUri }]) assert.throws(() => validateReactResult(input, { ...result, ...change }));
});
