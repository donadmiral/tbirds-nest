const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

test('memory playback compiles with only web React, and cannot resolve React from shared', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-memory-web-only-'));
  try {
    // Real source and installed web dependencies, with no root node_modules and no paths aliases.
    for (const file of ['shared/memoryPlayback.ts', 'shared/useMemoryPlayback.ts', 'web/lib/useMemoryPlayback.ts']) {
      const target = path.join(fixture, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
    }
    for (const dependency of ['react', '@types/react', 'csstype']) {
      fs.cpSync(path.join(root, 'web/node_modules', dependency), path.join(fixture, 'web/node_modules', dependency), { recursive: true });
    }
    assert.equal(fs.existsSync(path.join(fixture, 'node_modules')), false);
    const wrapper = path.join(fixture, 'web/lib/useMemoryPlayback.ts');
    const factory = path.join(fixture, 'shared/useMemoryPlayback.ts');
    const options = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    };
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([wrapper], options));
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => fixture,
      getNewLine: () => '\n',
    }));
    const runtimeReact = createRequire(wrapper).resolve('react');
    assert.ok(runtimeReact.startsWith(path.join(fixture, 'web/node_modules/react/')));
    assert.ok(runtimeReact.endsWith('.js'), 'React resolves to its real runtime, not a declaration alias');
    const typedReact = ts.resolveModuleName('react', wrapper, options, ts.sys).resolvedModule;
    assert.ok(typedReact.resolvedFileName.startsWith(path.join(fixture, 'web/node_modules/@types/react/')));
    assert.equal(ts.resolveModuleName('react', factory, options, ts.sys).resolvedModule, undefined);

    // A negative control proves that this fixture would catch the original shared React import.
    const invalid = path.join(fixture, 'shared/react-import-regression.ts');
    fs.writeFileSync(invalid, "import { useRef } from 'react'; export const badHook = () => useRef(0);\n");
    const rejected = ts.getPreEmitDiagnostics(ts.createProgram([invalid], options));
    assert.ok(rejected.some(error => error.code === 2307 && ts.flattenDiagnosticMessageText(error.messageText, '\n').includes("'react'")));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
