/** Exact disposable-build substitutions. Production auth configuration remains unchanged. */
function nativeAuthOverlay(source) {
  const substitutions = [
    ["import { createAuthDeadlineFetch } from '../../shared/authFetch';",
      "import { createAuthDeadlineFetch } from '../../shared/authFetch';\nconst nativeAuthTiming = require('../../tests/native/auth-diagnostics.cjs').nativeAuthDiagnostics();"],
    ["storage: Platform.OS === 'web' ? undefined : AsyncStorage,",
      "storage: Platform.OS === 'web' ? undefined : nativeAuthTiming.wrapStorage(AsyncStorage),"],
    ['lock: processLock,', 'lock: nativeAuthTiming.wrapLock(processLock),'],
  ];
  if (source.includes('nativeAuthTiming') || source.includes('tests/native')) throw new Error('Auth source already contains a native UI overlay.');
  for (const [before] of substitutions) {
    if (source.split(before).length !== 2) throw new Error('Expected one reviewed native auth timing anchor.');
  }
  for (const [before, after] of substitutions) source = source.replace(before, after);
  return source;
}
module.exports = { nativeAuthOverlay };
