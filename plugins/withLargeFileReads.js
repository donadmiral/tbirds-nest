const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// SDK 54 narrows the remaining bytes to Int before comparing them with the
// requested read size. At 3 GiB that converts to a negative array length.
const original = `      val buffer = ByteBuffer.allocate(length.coerceAtMost((fileChannel.size() - fileChannel.position()).toInt()))
      fileChannel.read(buffer)
      return buffer.array()`;
const bounded = `      val remaining = (fileChannel.size() - fileChannel.position()).coerceAtLeast(0L)
      val buffer = ByteBuffer.allocate(minOf(length.toLong(), remaining).toInt())
      while (buffer.hasRemaining()) {
        if (fileChannel.read(buffer) <= 0) return buffer.array().copyOf(buffer.position())
      }
      return buffer.array()`;

function patchFileReads(source, version) {
  if (version !== '19.0.24') throw new Error('Review large Android file reads after upgrading expo-file-system.');
  if (source.includes(bounded) && !source.includes(original)) return source;
  if (source.split(original).length !== 2) throw new Error('The installed Android file reader differs from the reviewed SDK.');
  return source.replace(original, bounded);
}

module.exports = config => withDangerousMod(config, ['android', cfg => {
  const manifest = require.resolve('expo-file-system/package.json', { paths: [cfg.modRequest.projectRoot] });
  const target = path.join(path.dirname(manifest), 'android/src/main/java/expo/modules/filesystem/FileSystemFileHandle.kt');
  const before = fs.readFileSync(target, 'utf8');
  const after = patchFileReads(before, JSON.parse(fs.readFileSync(manifest, 'utf8')).version);
  if (before !== after) fs.writeFileSync(target, after);
  return cfg;
}]);
module.exports.patchFileReads = patchFileReads;
