/** Installed only by the guarded disposable connected-QA build script. */
import 'react-native-url-polyfill/auto';
if (process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
  || process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY === 'native-ui-synthetic-no-provider-key') {
  throw new Error('Connected physical observations require the existing QA project.');
}
const { registerRootComponent } = require('expo');
require('@daily-co/react-native-daily-js');
require('./connected-observer.cjs').install();
const App = require('../../App').default;
registerRootComponent(App);
