const { feedVideoOverlay } = require('./native-ui-feed-video-overlay.cjs');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Expected one connected observation boundary: ' + before.slice(0, 90));
  return source.replace(before, after);
}
function carousel(source) {
  source = feedVideoOverlay(source);
  source = replaceOnce(source, "'Native feed video playing' : 'Native feed video waiting'",
    "`Native feed video playing ${uri.includes('/pc-offline-v1/active/') ? 'decrypted-local' : 'remote'} ${mediaId}` : `Native feed video waiting ${mediaId}`");
  source = replaceOnce(source, '<View style={{ width, height, backgroundColor: \'#F0F0F0\' }}>',
    '<View testID={`native-feed-image-${mediaId}`} accessibilityLabel={loadedIdentity === identity && showImage ? `Native feed image displayed ${offline?.kind === \'image\' ? \'decrypted-local\' : \'remote\'} ${mediaId}` : `Native feed image waiting ${mediaId}`} style={{ width, height, backgroundColor: \'#F0F0F0\' }}>');
  source = replaceOnce(source,
    'onDisplay={() => { if (activeRequest.current === request && failedRequestRef.current !== request) setLoadedIdentity(identity); }}',
    "onDisplay={() => { if (activeRequest.current === request && failedRequestRef.current !== request) { setLoadedIdentity(identity); require('../../tests/native/connected-observer.cjs').record('image-displayed', { postId, mediaId, sourceClass: offline?.kind === 'image' ? 'decrypted-local' : 'remote' }); } }}");
  return source;
}
function cache(source) {
  if (source.includes("record('cache-sealed'")) throw new Error('Connected cache observations already installed.');
  source = replaceOnce(source, '      return { bytes: info.size, extension };',
    "      require('../../tests/native/connected-observer.cjs').record('cache-sealed', { postId: candidate.postId, mediaId: candidate.mediaId, kind: candidate.kind, sourceVersion: candidate.sourceVersion, cipherFile: key + '.bin', bytes: info.size, sourceClass: 'remote' });\n      return { bytes: info.size, extension };");
  return replaceOnce(source, '    return output;',
    "    require('../../tests/native/connected-observer.cjs').record('cache-opened', { postId: entry.postId, mediaId: entry.mediaId, kind: entry.kind, sourceVersion: entry.sourceVersion, cipherFile: entry.key + '.bin', plainFile: entry.key + '.' + entry.extension, bytes: entry.bytes, sourceClass: 'decrypted-local' });\n    return output;");
}
module.exports = { carousel, cache };
