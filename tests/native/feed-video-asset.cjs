/** The actual native decoder reads packaged bytes, with no provider request. */
const { Asset } = require('expo-asset');
const { Platform } = require('react-native');
let pending;
function feedVideoSource() {
  if (!pending) pending = (async () => {
    let asset = Asset.fromModule(require('./assets/memory-capture-video.mp4'));
    const resource = Platform.OS === 'android' && /^[a-z0-9_]+$/.test(asset.uri);
    if (!asset.uri.startsWith('file://') && !resource) throw new Error('The native feed video must be packaged.');
    if (resource) asset = new Asset({ name: asset.name, type: asset.type, hash: asset.hash, uri: asset.uri });
    await asset.downloadAsync();
    if (!asset.localUri?.startsWith('file://')) throw new Error('The native feed fixture is not a local file.');
    return asset.localUri;
  })();
  return pending;
}
module.exports = { feedVideoSource };
