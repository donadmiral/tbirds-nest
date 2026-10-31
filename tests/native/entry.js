/** This entry is installed only in disposable CI Simulator/Emulator builds. */
import 'react-native-url-polyfill/auto';
import { Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { createFixture, FixtureWebSocket } from './backend-fixture.cjs';

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
globalThis.fetch = fixture.fetch;
globalThis.WebSocket = FixtureWebSocket;
Linking.addEventListener('url', ({ url }) => {
  if (!url.startsWith('platinum-circles-qa://ui-fixture/')) return;
  const query = new URL(url).searchParams;
  fixture.configure({ offline: query.get('offline') === '1', delayMs: Number(query.get('delay') || 0) });
});
// Require after replacing transports. Every real production component and
// service is imported through App, including the actual Supabase SDK.
const { registerRootComponent } = require('expo');
const App = require('../../App').default;
registerRootComponent(App);
