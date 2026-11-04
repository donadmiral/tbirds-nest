/** Exact-anchor disposable QA transforms. Production files stay unchanged in git. */
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Expected one native input observation anchor: ' + anchor.slice(0, 90));
  return source.replace(anchor, replacement);
}
function introduce(source, relativePath) {
  if (source.includes('nativeInputTrace')) throw new Error('Native input observation is already installed.');
  return `const nativeInputTrace = require('${relativePath}');\n` + source;
}
function touchProps(control) {
  return ['TouchStart', 'TouchEnd', 'TouchCancel', 'PressIn', 'PressOut'].map((name, index) =>
    `on${name}={() => { nativeInputTrace.record('${control}-${['touch-start', 'touch-end', 'touch-cancel', 'press-in', 'press-out'][index]}'); }}`).join(' ');
}
function liveUiInputOverlay(source) {
  let result = introduce(source, '../../tests/native/input-diagnostics.cjs');
  return once(result, 'accessibilityHint="Set up a camera preview. You choose when to start broadcasting." onPress={onCreate}',
    'accessibilityHint="Set up a camera preview. You choose when to start broadcasting." ' + touchProps('start-live') +
    ' onPress={nativeInputTrace.wrapCallback(\'start-live\', onCreate)}');
}
function liveDirectoryInputOverlay(source) {
  return once(introduce(source, '../../../tests/native/input-diagnostics.cjs'),
    "onCreate={()=>navigation.navigate('NewLive')}",
    "onCreate={()=>nativeInputTrace.observeNavigation(navigation.navigate, navigation, ['NewLive'])}");
}
function navigationInputOverlay(source) {
  let result = introduce(source, '../../tests/native/input-diagnostics.cjs');
  result = once(result, 'const navigationRef = React.createRef<any>();',
    'const navigationRef = React.createRef<any>();\nconst nativeInputNavigation = nativeInputTrace.navigationObservers(navigationRef);');
  const anchor = '<NavigationContainer ref={navigationRef} linking={linking} fallback={<SplashLoader />}';
  if (result.split(anchor).length !== 3) throw new Error('Expected both original root navigation containers.');
  return result.replaceAll(anchor, anchor + '\n          onReady={nativeInputNavigation.onReady} onStateChange={nativeInputNavigation.onStateChange}');
}
function newLiveInputOverlay(source) {
  let result = introduce(source, '../../../tests/native/input-diagnostics.cjs');
  result = once(result, 'export default function NewLiveScreen({ navigation, route }: Props) {',
    `export default function NewLiveScreen({ navigation, route }: Props) {
  React.useLayoutEffect(() => { nativeInputTrace.record('new-live-mount');
    return () => { nativeInputTrace.record('new-live-unmount'); }; }, []);`);
  result = once(result, "    if (owner) void liveRpc('live_directory',", "    if (owner) nativeInputTrace.record('new-live-capability-start', { request: version });\n    if (owner) void liveRpc('live_directory',");
  result = once(result, "p_limit: 1 }).then(data => {", "p_limit: 1 }).then(data => {\n      nativeInputTrace.record('new-live-capability-fulfilled', { request: version });");
  result = once(result, ".catch(() => { if (version === generation.current) setError('Live setup could not load. Tap Retry setup.'); })",
    ".catch(() => { nativeInputTrace.record('new-live-capability-rejected', { request: version }); if (version === generation.current) setError('Live setup could not load. Tap Retry setup.'); })");
  result = once(result, '.finally(() => { if (version === generation.current) setLoading(false); });',
    ".finally(() => { nativeInputTrace.record('new-live-capability-finally', { request: version }); if (version === generation.current) setLoading(false); });");
  return once(result, '    return () => { generation.current++; };',
    "    return () => { nativeInputTrace.record('new-live-capability-cleanup', { request: version }); generation.current++; };");
}
function memoryInputOverlay(source) {
  let result = introduce(source, '../../../tests/native/input-diagnostics.cjs');
  const state = '  const [opened, setOpened] = useState(false);';
  result = once(result, state, state + `
  React.useLayoutEffect(() => { nativeInputTrace.record('open-book-state-commit', { opened, scopeRevision: authScopeRevision }); }, [opened, authScopeRevision]);`);
  result = once(result, '  const openBook = useCallback(() => {', "  const openBook = useCallback(nativeInputTrace.wrapCallback('open-book', () => {");
  result = once(result, '    completeIntent.current++;setPreparingBook(false);setOpened(true);\n  }, []);',
    '    completeIntent.current++;setPreparingBook(false);setOpened(true);\n  }), []);');
  result = once(result, '    // A route/account change invalidates pending flips and picker responses.',
    "    nativeInputTrace.record('open-book-scope-reset', { scopeRevision: authScopeRevision });\n    // A route/account change invalidates pending flips and picker responses.");
  return once(result, '<TouchableOpacity accessibilityRole="button" onPress={openBook}',
    '<TouchableOpacity accessibilityRole="button" ' + touchProps('open-book') + ' onPress={openBook}');
}
module.exports = { liveUiInputOverlay, liveDirectoryInputOverlay, navigationInputOverlay, newLiveInputOverlay, memoryInputOverlay };
