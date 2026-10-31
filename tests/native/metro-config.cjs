const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
module.exports = function nativeUiConfig(root) {
  if (process.env.CI !== 'true' || process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
    || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
    throw new Error('The isolated Metro adapter cannot bundle a production app.');
  }
  const config = getDefaultConfig(root);
  const modal = path.join(root, 'src/components/memory/MemoryMovieExport.tsx');
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'expo/fetch') return { type: 'sourceFile', filePath: path.join(root, 'tests/native/expo-fetch-fixture.cjs') };
    if (context.originModulePath === modal && moduleName === '../../services/memoryMovieExport') {
      return { type: 'sourceFile', filePath: path.join(root, 'tests/native/memory-export-adapter.ts') };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
  return config;
};
