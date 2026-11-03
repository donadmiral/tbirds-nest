import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSegments, selectVariant, sourceUrl } from '../source.mjs';
import { captionsVtt } from '../render.mjs';
const playlist = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4,\n1.ts\n#EXTINF:4,\n2.ts\n#EXTINF:4,\n3.ts\n';
test('live clipping snapshots complete covering segments with an exact seek offset', () => {
  const result = selectSegments(playlist, 5100, 10500);
  assert.deepEqual(result.segments.map(s => s.uri), ['2.ts', '3.ts']);
  assert.equal(result.seekSeconds, 1.1); assert.equal(result.durationSeconds, 5.4);
  assert.throws(() => selectSegments(playlist, 5100, 14000), /source_not_ready/);
});
test('rolling windows, encryption and unsupported remote subresources are rejected', () => {
  assert.throws(() => selectSegments(playlist.replace('SEQUENCE:0', 'SEQUENCE:15'), 0, 2000), /timeline/);
  assert.throws(() => selectSegments(playlist + '#EXT-X-KEY:METHOD=AES-128,URI="https://private.invalid"', 0, 2000), /unsupported/);
  const root = 'https://live.synthetic.invalid/_live/token/live/session/instance/master.m3u8';
  for (const value of ['https://attacker.invalid/media.ts', '//attacker.invalid/media.ts', '../../../../secret', '%2e%2e/secret', 'https://user:pass@live.synthetic.invalid/secret']) {
    assert.throws(() => sourceUrl(value, root));
  }
  assert.equal(sourceUrl('720p/segment.ts', root), root.replace('master.m3u8', '720p/segment.ts'));
});
test('highest supported HLS variant is chosen and malformed master playlists fail', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\n360/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080\n1080/index.m3u8\n';
  assert.equal(selectVariant(master, 'https://example.invalid/live/master.m3u8'), 'https://example.invalid/live/1080/index.m3u8');
  assert.throws(() => selectVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n', 'https://example.invalid/live/master.m3u8'));
});
test('captions validate timeline and safely encode text for WebVTT', () => {
  const vtt = captionsVtt([{ start_ms: 0, end_ms: 2000, text: '<b>Hello</b>\n\nWorld' }], 3000);
  assert.ok(vtt.includes('00:00:00.000 --> 00:00:02.000'));
  assert.ok(vtt.includes('&lt;b&gt;Hello&lt;/b&gt;\nWorld'));
  assert.throws(() => captionsVtt([{ start_ms: 10, end_ms: 5000, text: 'Too long' }], 3000));
});
