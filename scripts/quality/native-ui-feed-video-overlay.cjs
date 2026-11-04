/** Observe actual rendered frame and native progress without changing playback. */
function feedVideoOverlay(source) {
  const anchor = "      style={{ width, height, backgroundColor: '#000' }}\n      activeOpacity={1}";
  if (source.includes('testID="native-feed-video"') || source.split(anchor).length !== 2) throw new Error('Expected one real feed video touch surface.');
  return source.replace(anchor, "      testID=\"native-feed-video\"\n      accessibilityLabel={hasFrame && owns && sourceReady && musicClock.playing && musicClock.time > 0.2 ? 'Native feed video playing' : 'Native feed video waiting'}\n" + anchor);
}
function feedRefreshOverlay(source) {
  const anchor = 'onRefresh={() => { setRefreshing(true); loadFeed(false); refreshMarketplace();';
  if (source.split(anchor).length !== 2) throw new Error('Expected one real feed refresh handler.');
  return source.replace(anchor, "onRefresh={() => { setRefreshing(true); require('../../../tests/native/fixture-runtime.cjs').fixtureRuntime().observeFeedRefresh(() => loadFeed(false)); refreshMarketplace();");
}
function livePlaybackFixtureOverlay(source) {
  const anchor = "({ uri: grant.url, contentType: 'hls' as const, useCaching: false, metadata:";
  const listener = "const playing = player.addListener('playingChange', event => {";
  const cleanup = 'return () => { listener.remove(); playing.remove(); };';
  if ([anchor, listener, cleanup].some(value => source.split(value).length !== 2)) throw new Error('Expected original native Live player boundaries.');
  return source.replace(anchor, "({ ...require('../../tests/native/fixture-runtime.cjs').fixtureRuntime().nativeLiveVideoSource(grant), metadata:")
    .replace(listener, "const nativeFixtureProgress = player.addListener('timeUpdate', event => { if (player.playing && active.current) require('../../tests/native/fixture-runtime.cjs').fixtureRuntime().recordLiveProgress(active.current.id, event.currentTime); });\n    " + listener)
    .replace(cleanup, 'return () => { listener.remove(); playing.remove(); nativeFixtureProgress.remove(); };');
}
function liveFrameFixtureOverlay(source) {
  const anchor = '<VideoView player={playback.player} style={StyleSheet.absoluteFill}';
  if (source.split(anchor).length !== 2) throw new Error('Expected one immersive native Live video surface.');
  return source.replace(anchor, '<VideoView testID="native-live-player" onFirstFrameRender={() => require(\'../../../tests/native/fixture-runtime.cjs\').fixtureRuntime().recordLiveFrame(id)} player={playback.player} style={StyleSheet.absoluteFill}');
}
module.exports = { feedVideoOverlay, feedRefreshOverlay, livePlaybackFixtureOverlay, liveFrameFixtureOverlay };
