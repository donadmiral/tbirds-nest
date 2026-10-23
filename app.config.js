const fs = require('node:fs');

const PROJECTS = {
  qa: 'uaulhuelcfkjwojtymmw',
  production: 'prlkikhckbifseosbukl',
};

module.exports = ({ config }) => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV || 'production';
  if (!Object.hasOwn(PROJECTS, environment)) throw new Error('Unknown Platinum application environment.');
  const configuredUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.hostname !== `${PROJECTS[environment]}.supabase.co` || url.port || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error(`The ${environment} application must use its matching Platinum backend.`);
    }
  } else if (process.env.EAS_BUILD === 'true') {
    throw new Error('A native build requires its explicit Platinum backend configuration.');
  }
  if (environment !== 'qa') return config;
  const android = { ...config.android, package: 'app.platinumcircles.mobile.qa' };
  // Firebase files are application-ID specific. Never ship production FCM
  // credentials in the separately installed QA application.
  delete android.googleServicesFile;
  const qaServices = process.env.GOOGLE_SERVICES_JSON_QA;
  if (qaServices) {
    const firebase = JSON.parse(fs.readFileSync(qaServices, 'utf8'));
    if (!firebase.client?.some(client => client.client_info?.android_client_info?.package_name === android.package)) {
      throw new Error('The QA Firebase file does not contain the QA application ID.');
    }
    android.googleServicesFile = qaServices;
  }
  return {
    ...config,
    name: 'Platinum QA',
    scheme: 'platinum-circles-qa',
    ios: { ...config.ios, bundleIdentifier: 'app.platinumcircles.mobile.qa' },
    android,
    extra: { ...config.extra, environment: 'qa' },
  };
};
