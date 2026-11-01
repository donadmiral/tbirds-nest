/** Test-only observers preserve navigation, loading and visible content. */
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Expected one native navigation timing anchor.');
  return source.replace(anchor, replacement);
}
function navigationTimingOverlay(source) {
  return replaceOnce(source, '    <Tab.Navigator\n',
    `    <Tab.Navigator\n      screenListeners={({ route }) => ({ tabPress: () => (globalThis as any).__platinumNativeNavigationTiming?.record('tab-press', route.name) })}\n`);
}
function inboxTimingOverlay(source) {
  const anchor = '  const unpinned = filtered.filter(c => !c.is_pinned);';
  let result = replaceOnce(source, anchor, anchor + `

  React.useLayoutEffect(() => {
    if (navigation.isFocused() && !loading && filtered.length > 0) {
      (globalThis as any).__platinumNativeNavigationTiming?.record('inbox-commit', 'Messages', filtered.length);
    }
  }, [navigation, loading, filtered.length]);
  useFocusEffect(useCallback(() => {
    if (loading || filtered.length === 0) return;
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (navigation.isFocused()) (globalThis as any).__platinumNativeNavigationTiming?.record('inbox-frame', 'Messages', filtered.length);
      });
    });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  }, [navigation, loading, filtered.length]));
`);
  return replaceOnce(result, '        style={[s.card, item.is_archived && s.cardArchived]}',
    `        onLayout={() => { if (navigation.isFocused()) (globalThis as any).__platinumNativeNavigationTiming?.record('inbox-row-layout', 'Messages', filtered.length); }}
        style={[s.card, item.is_archived && s.cardArchived]}`);
}
module.exports = { navigationTimingOverlay, inboxTimingOverlay };
