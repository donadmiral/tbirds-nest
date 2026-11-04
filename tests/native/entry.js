/** This entry is installed only in disposable CI Simulator/Emulator builds. */
import 'react-native-url-polyfill/auto';
import { Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createFixture, FixtureWebSocket } from './backend-fixture.cjs';
import { installFixtureTransport } from './install-fixture-transport.cjs';
import { installFixtureRuntime } from './fixture-runtime.cjs';
import { observeCaptureBoundary, isCaptureState } from './capture-boundary-trace.cjs';
import { createNavigationTimingRecorder } from './navigation-timing.cjs';
import { installInputDiagnostics, attachPressabilityEmitter, record as recordInput } from './input-diagnostics.cjs';

if (process.env.EXPO_PUBLIC_APP_ENV !== 'qa' || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
  throw new Error('The isolated native UI entry cannot use a provider credential or production configuration.');
}

globalThis.__platinumNativeNavigationTiming = createNavigationTimingRecorder({
  write: value => FileSystem.writeAsStringAsync(FileSystem.documentDirectory + 'native-ui-navigation-timing.json', value),
});

let timer;
let latest;
let writing = Promise.resolve();
function persist(receipt) {
  latest = JSON.stringify(receipt);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const snapshot = latest;
    writing = writing.then(() => FileSystem.writeAsStringAsync(FileSystem.documentDirectory + 'native-ui-receipt.json', snapshot));
  }, 100);
}
const fixture = createFixture(persist, { feedVideoSource: () => require('./feed-video-asset.cjs').feedVideoSource() });
installFixtureRuntime(fixture);
installFixtureTransport(fixture, FixtureWebSocket);
installInputDiagnostics({
  write: value => FileSystem.writeAsStringAsync(FileSystem.documentDirectory + 'native-ui-input-diagnostics.json', value),
});
try {
  // Passive installed RN emitter. It does not replace responder handlers or
  // identify a target; targeted callbacks below supply the control boundary.
  const emitter = require('react-native/Libraries/Pressability/PressabilityPerformanceEventEmitter').default;
  attachPressabilityEmitter(emitter);
} catch { recordInput('pressability-unavailable'); }
Linking.addEventListener('url', ({ url }) => {
  if (typeof url === 'string' && /^platinum-circles-qa:/i.test(url)) {
    observeCaptureBoundary(fixture, 'received', { matched: url === 'platinum-circles-qa://ui-fixture/memory' });
  }
  if (!url.startsWith('platinum-circles-qa://ui-fixture/')) return;
  const query = new URL(url).searchParams;
  fixture.configure({ offline: query.get('offline') === '1', delayMs: Number(query.get('delay') || 0) });
});
// Require after replacing transports. Every real production component and
// service is imported through App, including the actual Supabase SDK.
const { registerRootComponent } = require('expo');
// Match production bootstrap only after the isolated transport is installed.
require('@daily-co/react-native-daily-js');
const { linking } = require('../../src/navigation/linking');
const { getActionFromState } = require('@react-navigation/native');
linking.prefixes.push('platinum-circles-qa://');
linking.config.screens.NativeMemoryCaptureFixture = 'ui-fixture/memory';
const defaultPathState = linking.getStateFromPath;
linking.getStateFromPath = function (path, ...args) {
  try {
    const state = defaultPathState.call(this, path, ...args);
    observeCaptureBoundary(fixture, 'parsed', () => ({ expectedPath: path === 'ui-fixture/memory', matched: isCaptureState(state) }));
    return state;
  } catch (error) {
    observeCaptureBoundary(fixture, 'parse-failed', { expectedPath: path === 'ui-fixture/memory' });
    throw error;
  }
};
const defaultLinkAction = linking.getActionFromState || getActionFromState;
linking.getActionFromState = (state, options) => {
  try {
    // Use the same normal navigation action as production memory navigation.
    // Keep prior screens, providers and the existing signed-in runtime intact.
    // An earlier failed flow or blocking modal still fails the required journey.
    const action = defaultLinkAction(state, options);
    // Linking dispatches after this returns. Mount is observed separately.
    observeCaptureBoundary(fixture, action === undefined ? 'action-empty' : 'action-produced', () => ({ matched: isCaptureState(state), reset: action?.type === 'RESET' }));
    return action;
  } catch (error) {
    observeCaptureBoundary(fixture, 'action-failed', () => ({ matched: isCaptureState(state) }));
    throw error;
  }
};
const App = require('../../App').default;
registerRootComponent(App);
