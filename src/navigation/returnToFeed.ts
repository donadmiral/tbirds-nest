/** Exit creation/viewing through the actual Main → Feed → FeedMain hierarchy. */
export function returnToFeed(navigation: any, params?: Record<string, unknown>): void {
  let root = navigation;
  const seen = new Set<any>();
  while (root?.getParent && !seen.has(root)) {
    seen.add(root);
    const parent = root.getParent();
    if (!parent) break;
    root = parent;
  }
  const state = root?.getState?.();
  if (state?.routes?.some((route: any) => route.name === 'Main') && root.navigate) {
    root.navigate('Main', { screen: 'Feed', params: { screen: 'FeedMain', params } });
    return;
  }
  // A story opened from a deep link can be the only route in the root stack.
  if (root?.reset) {
    root.reset({ index: 0, routes: [{ name: 'Main', state: { index: 0, routes: [{ name: 'Feed', state: { index: 0, routes: [{ name: 'FeedMain', params }] } }] } }] });
    return;
  }
  if (root?.navigate) root.navigate('Main', { screen: 'Feed', params: { screen: 'FeedMain', params } });
  else if (navigation?.canGoBack?.()) navigation.goBack();
}
