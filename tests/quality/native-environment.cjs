const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const profiles = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
function configure(env, overrides = {}) {
  const context = { module: { exports: {} }, require, URL, process: { env } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.config.js'), 'utf8'), context);
  return context.module.exports({ config: { name: 'PlatinumCircles', scheme: 'platinum-circles', ios: { bundleIdentifier: 'app.platinumcircles.mobile' }, android: { package: 'app.platinumcircles.mobile', googleServicesFile: 'production.json' }, extra: { eas: { projectId: 'existing-project' } }, ...overrides } });
}
function checkScreenCaptureExtension(config) {
  const extensions = config.extra.eas.build.experimental.ios.appExtensions;
  const extension = extensions.find(item => item.targetName === 'ScreenCaptureExtension');
  assert.equal(extensions.filter(item => item.targetName === 'ScreenCaptureExtension').length, 1);
  assert.equal(extension.bundleIdentifier, `${config.ios.bundleIdentifier}.ScreenCaptureExtension`);
  assert.equal(extension.entitlements['com.apple.security.application-groups'].length, 1);
  assert.equal(extension.entitlements['com.apple.security.application-groups'][0], `group.${config.ios.bundleIdentifier}`);
  assert.equal(config.extra.eas.projectId, 'existing-project');
}
test('internal builds use isolated backend and separately installed app IDs', () => {
  for (const name of ['development', 'preview']) {
    const env = profiles.build[name].env;
    assert.equal(new URL(env.EXPO_PUBLIC_SUPABASE_URL).hostname, 'uaulhuelcfkjwojtymmw.supabase.co');
    const result = configure(env);
    assert.equal(result.android.package, 'app.platinumcircles.mobile.qa');
    assert.equal(result.ios.bundleIdentifier, 'app.platinumcircles.mobile.qa');
    assert.equal(result.android.googleServicesFile, undefined);
    assert.equal(result.scheme, 'platinum-circles-qa');
    checkScreenCaptureExtension(result);
  }
});
test('a mixed QA and production build is rejected', () => {
  assert.throws(() => configure({ EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_URL: profiles.build.production.env.EXPO_PUBLIC_SUPABASE_URL }), /matching Platinum backend/);
  assert.throws(() => configure({ EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: profiles.build.preview.env.EXPO_PUBLIC_SUPABASE_URL }), /matching Platinum backend/);
  assert.throws(() => configure({ EAS_BUILD: 'true' }), /explicit Platinum backend/);
});
test('production application identity stays stable', () => {
  const result = configure(profiles.build.production.env);
  assert.equal(result.android.package, 'app.platinumcircles.mobile');
  assert.equal(result.ios.bundleIdentifier, 'app.platinumcircles.mobile');
  assert.equal(result.android.googleServicesFile, 'production.json');
  checkScreenCaptureExtension(result);
});
test('screen capture credentials preserve existing EAS configuration and unrelated extensions', () => {
  const otherExtension = { targetName: 'NotificationExtension', bundleIdentifier: 'app.platinumcircles.mobile.notification' };
  const extra = { customValue: 'preserved', eas: { projectId: 'existing-project', build: {
    anotherBuildSetting: 'preserved', experimental: { anotherExperiment: 'preserved', ios: {
      anotherIosSetting: 'preserved', appExtensions: [otherExtension, {
        targetName: 'ScreenCaptureExtension', bundleIdentifier: 'old.bundle',
        entitlements: { 'com.apple.security.application-groups': ['group.old.bundle'] },
      }],
    } },
  } } };
  const before = JSON.stringify(extra);
  for (const profile of ['preview', 'production']) {
    const result = configure(profiles.build[profile].env, { extra });
    checkScreenCaptureExtension(result);
    assert.equal(result.extra.customValue, 'preserved');
    assert.equal(result.extra.eas.build.anotherBuildSetting, 'preserved');
    assert.equal(result.extra.eas.build.experimental.anotherExperiment, 'preserved');
    assert.equal(result.extra.eas.build.experimental.ios.anotherIosSetting, 'preserved');
    assert.equal(result.extra.eas.build.experimental.ios.appExtensions[0], otherExtension);
    assert.equal(JSON.stringify(extra), before);
  }
});
