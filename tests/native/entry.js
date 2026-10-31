/** This entry is installed only in disposable CI Simulator/Emulator builds. */
import 'react-native-url-polyfill/auto';
import { Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createFixture, FixtureWebSocket } from './backend-fixture.cjs';
import { installFixtureTransport } from './install-fixture-transport.cjs';
import { installFixtureRuntime } from './fixture-runtime.cjs';
import { observeCaptureBoundary, isCaptureState } from './capture-boundary-trace.cjs';

if (process.env.EXPO_PUBLIC_APP_ENV !== 'qa' || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
  throw new Error('The isolated native UI entry cannot use a provider credential or production configuration.');
}

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
const fixture = createFixture(persist);
installFixtureRuntime(fixture);
installFixtureTransport(fixture, FixtureWebSocket);
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
const { CommonActions, getActionFromState } = require('@react-navigation/native');
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
    const route = state.routes[0];
    if (state.routes.length === 1 && route?.name === 'NativeMemoryCaptureFixture'
      && route.path === 'ui-fixture/memory') {
      // Remove prior screen-owned Modals even when navigation failed mid-sheet.
      // Only navigator routes change: App providers, auth/account stores, the
      // synthetic transport and its cumulative receipt remain in this process.
      const action = CommonActions.reset({ index: 0, routes: [route] });
      // Linking performs dispatch after this returns. This is only production of
      // an action; the separate mounted observation is a later boundary.
      observeCaptureBoundary(fixture, 'action-produced', () => ({ matched: true, reset: action.type === 'RESET' }));
      return action;
    }
    const action = defaultLinkAction(state, options);
    observeCaptureBoundary(fixture, action === undefined ? 'action-empty' : 'action-produced', () => ({ matched: false, reset: action?.type === 'RESET' }));
    return action;
  } catch (error) {
    observeCaptureBoundary(fixture, 'action-failed', () => ({ matched: isCaptureState(state) }));
    throw error;
  }
};
const App = require('../../App').default;
registerRootComponent(App);
