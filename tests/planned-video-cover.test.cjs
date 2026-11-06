const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../shared/plannedMedia.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const api = {};
new Function('exports', compiled.outputText)(api);

test('a planned video never enters a draft without its real uploaded cover', async () => {
  let writes = 0;
  const source = async () => { writes++; return 'video.mp4'; };
  await assert.rejects(api.preparePlannedMedia(true, source, async () => { throw Error('decode failed'); }), /decode failed/);
  await assert.rejects(api.preparePlannedMedia(true, source, async () => ''), /cover/);
  assert.equal(writes, 0);
  assert.deepEqual(await api.preparePlannedMedia(true, source, async () => 'actual-cover.jpg'),
    { url: 'video.mp4', media_type: 'video', edit: { coverUrl: 'actual-cover.jpg', coverAt: 0 } });
});
test('changing accounts during cover preparation cancels the video upload', async () => {
  let active = true;
  await assert.rejects(api.preparePlannedMedia(true, async () => assert.fail('stale upload'), async () => { active = false; return 'cover'; }, () => active), /selection/);
  assert.deepEqual(await api.preparePlannedMedia(false, async () => 'pic.jpg', async () => assert.fail('unexpected decode')),
    { url: 'pic.jpg', media_type: 'image' });
});
