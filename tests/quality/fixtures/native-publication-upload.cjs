const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.resolve(__dirname, '../../../src/services/uploadNativeFile.ts');
const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

// Run the actual phone upload adapter with small cache files and the test's transport.
module.exports = function nativePublicationUpload(context) {
  const { EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY } = context.process.env;
  const modules = {
    'expo-file-system': { File: class { size = 128; } }, 'expo/fetch': {},
    './resumableUpload': { STORAGE_CHUNK_BYTES: 6 * 1024 * 1024 },
    './supabase': { SUPABASE_URL: EXPO_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY: EXPO_PUBLIC_SUPABASE_ANON_KEY },
  };
  const transport = { ...context, exports: {}, require: name => modules[name] };
  vm.runInNewContext(outputText, transport, { filename: file });
  return transport.exports.uploadNativeFile;
};
