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
const GRADLE_ORIGINAL = 'db00bf5669614c5cf1566105fee6e62b305ae50f30c075984c0e07e0ed553842';
const GRADLE_PATCHED = '843508193c2f3d9e2bd214c01fe15f66a2684891058c8023ec3745fbc7e2e3f6';
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

function patchMedia3Dependencies(source, version) {
  if (version !== VERSION) throw new Error('Review Media3 compatibility after changing the pinned expo-video version.');
  const before = digest(source);
  if (before === GRADLE_PATCHED) return source;
  if (before !== GRADLE_ORIGINAL) throw new Error('The installed expo-video Gradle source differs from the reviewed distribution.');
  // The library compiles in its own dependency scope. App runtime alignment
  // does not upgrade that scope, so compile the adapted class against 1.11.1.
  const adapted = source.replace('def androidxMedia3Version = "1.8.0"', 'def androidxMedia3Version = "1.11.1"');
  if (digest(adapted) !== GRADLE_PATCHED) throw new Error('The Media3 dependency adaptation differs from the reviewed result.');
  return adapted;
}

function withMedia3Compatibility(config) {
  return withDangerousMod(config, ['android', async cfg => {
    const manifestPath = require.resolve('expo-video/package.json', { paths: [cfg.modRequest.projectRoot] });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sourcePath = path.join(path.dirname(manifestPath), RELATIVE_SOURCE);
    const gradlePath = path.join(path.dirname(manifestPath), 'android/build.gradle');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    const adapted = patchLoadControl(source, manifest.version);
    const adaptedGradle = patchMedia3Dependencies(gradle, manifest.version);
    // Validate both inputs before writing either file. Source selection itself
    // is Android-only in package.json's supported Expo autolinking setting.
    if (adapted !== source) fs.writeFileSync(sourcePath, adapted);
    if (adaptedGradle !== gradle) fs.writeFileSync(gradlePath, adaptedGradle);
    return cfg;
  }]);
}

module.exports = withMedia3Compatibility;
module.exports.patchLoadControl = patchLoadControl;
module.exports.patchMedia3Dependencies = patchMedia3Dependencies;
