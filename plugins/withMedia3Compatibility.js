const { withDangerousMod } = require('@expo/config-plugins');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Expo 54's video module vendors its load-control implementation. Media3
// 1.11.1 adds the player identity to two interface methods; the existing
// allocator and preloading decisions remain exactly the same.
const VERSION = '3.0.16';
const ORIGINAL = 'edc43515ed73af65f4ec142684f7e95ee2b9f84475619df7fcfa28a0f0ff3ae1';
const PATCHED = 'f628d5385071a6c2139cd17d9c7adf833dfd27e6eef52958101558b2849deb0d';
const RELATIVE_SOURCE = 'android/src/main/java/expo/modules/video/player/DefaultLoadControl.java';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function patchLoadControl(source, version) {
  if (version !== VERSION) throw new Error('Review Media3 compatibility after changing the pinned expo-video version.');
  const before = digest(source);
  if (before === PATCHED) return source;
  if (before !== ORIGINAL) throw new Error('The installed expo-video load-control source differs from the reviewed distribution.');
  const replacements = [
    ['public Allocator getAllocator() {', 'public Allocator getAllocator(PlayerId playerId) {'],
    ['public boolean shouldContinuePreloading(\n    Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {',
      'public boolean shouldContinuePreloading(\n    PlayerId playerId, Timeline timeline, MediaPeriodId mediaPeriodId, long bufferedDurationUs) {'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('The reviewed Media3 compatibility signature is missing or ambiguous.');
    source = source.replace(before, after);
  }
  if (digest(source) !== PATCHED) throw new Error('The Media3 compatibility result differs from the reviewed adaptation.');
  return source;
}

function withMedia3Compatibility(config) {
  return withDangerousMod(config, ['android', async cfg => {
    const manifestPath = require.resolve('expo-video/package.json', { paths: [cfg.modRequest.projectRoot] });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sourcePath = path.join(path.dirname(manifestPath), RELATIVE_SOURCE);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const adapted = patchLoadControl(source, manifest.version);
    if (adapted !== source) fs.writeFileSync(sourcePath, adapted);
    return cfg;
  }]);
}

module.exports = withMedia3Compatibility;
module.exports.patchLoadControl = patchLoadControl;
