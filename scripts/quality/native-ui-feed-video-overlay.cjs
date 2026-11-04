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
module.exports = { feedVideoOverlay, feedRefreshOverlay };
