const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function homePage(getServerViewer) {
  const file = path.join(__dirname, '../app/home/page.tsx');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const HomeFeed = () => null;
  const modules = {
    'next/navigation': { redirect: url => { throw new Error(`redirect:${url}`); } },
    '@/components/HomeFeed': { __esModule: true, default: HomeFeed },
    '@/lib/serverViewer': { getServerViewer },
    'react/jsx-runtime': require('react/jsx-runtime'),
  };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => {
      if (!(name in modules)) throw new Error(`Unexpected blocking dependency: ${name}`);
      return modules[name];
    },
  });
  return { Page: module.exports.default, HomeFeed };
}

test('Home mounts its pending account-scoped feed immediately after verified authentication', async () => {
  let databaseReads = 0;
  const supabase = new Proxy({}, { get() { databaseReads++; throw new Error('Page must not wait for feed or profile data'); } });
  const { Page, HomeFeed } = homePage(async () => ({ user: { id: 'alice' }, supabase }));
  const result = await Page();
  assert.equal(result.type, HomeFeed);
  assert.equal(result.key, 'alice');
  assert.equal(result.props.seed.owner, 'alice');
  assert.equal(result.props.seed.pending, true);
  assert.equal(result.props.seed.preferencesReady, false);
  assert.equal(result.props.seed.error, null);
  assert.equal(result.props.seed.rows.length, 0);
  assert.equal(databaseReads, 0);
});

test('Home waits for verified authentication and never mounts another account while it is unresolved', async () => {
  let resolveViewer;
  const viewer = new Promise(resolve => { resolveViewer = resolve; });
  const { Page } = homePage(() => viewer);
  let rendered = false;
  const pending = Page().then(value => { rendered = true; return value; });
  await Promise.resolve();
  assert.equal(rendered, false);
  resolveViewer({ user: { id: 'bob' } });
  assert.equal((await pending).props.seed.owner, 'bob');
});

test('Home redirects signed-out users and propagates failed authentication without a feed', async () => {
  await assert.rejects(homePage(async () => ({ user: null })).Page(), /redirect:\/login/);
  await assert.rejects(homePage(async () => { throw new Error('verification unavailable'); }).Page(), /verification unavailable/);
});
