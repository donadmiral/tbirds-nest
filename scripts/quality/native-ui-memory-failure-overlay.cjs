'use strict';

/** One reversible catch around the existing duration await. The original
 * duration helper, player operations, timeout, result and cleanup stay intact. */
const anchor = '   durations[sourceItems[scene.sourceIndex].id]=await videoDuration(uri,signal);';
const replacement = `   try {\n${anchor}\n   } catch (error) {
    try {
     await require('../../tests/native/memory-failure-identity.cjs').observeDurationFailure({
      error, bookId: options.bookId, sourceUri: item.uri, uri, directory: files.directory.uri, signal,
     });
    } catch { /* A diagnostic failure cannot replace the original duration error. */ }
    throw error;
   }`;

function memoryFailureIdentityOverlay(source) {
  if (source.includes('memory-failure-identity.cjs') || source.split(anchor).length !== 2) {
    throw new Error('Expected the one unchanged memory duration await.');
  }
  const generated = source.replace(anchor, replacement);
  if (restoreMemoryFailureIdentityOverlay(generated) !== source) throw new Error('Memory failure overlay is not reversible.');
  return generated;
}
function restoreMemoryFailureIdentityOverlay(source) {
  if (source.split(replacement).length !== 2) throw new Error('Expected one generated memory failure observer.');
  return source.replace(replacement, anchor);
}

const memoryDependencyFiles = {
  'expo-video': ['package.json', 'build/index.js', 'build/VideoPlayer.js', 'src/VideoPlayer.tsx', 'ios/VideoModule.swift', 'ios/VideoPlayer.swift',
    'ios/VideoSourceLoader.swift', 'ios/VideoPlayerItem.swift', 'ios/VideoAsset.swift',
    'ios/Records/VideoSource.swift', 'ios/Utils/URL+MediaLibraryAssets.swift'],
  'expo-file-system': ['package.json', 'src/index.ts', 'src/FileSystem.ts', 'src/ExpoFileSystem.types.ts',
    'ios/FileSystemModule.swift', 'ios/FileSystemFile.swift', 'ios/FileSystemFileHandle.swift'],
  'expo-crypto': ['package.json', 'build/Crypto.js', 'src/Crypto.ts', 'ios/CryptoModule.swift'],
};

module.exports = { memoryFailureIdentityOverlay, restoreMemoryFailureIdentityOverlay, memoryDependencyFiles };
