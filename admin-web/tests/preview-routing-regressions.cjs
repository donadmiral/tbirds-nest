const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { unstable_getResponseFromNextConfig } = require('next/experimental/testing/server');

function loadConfig(vercelEnvironment) {
  const source = fs.readFileSync(path.join(__dirname, '../next.config.ts'), 'utf8');
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    process: { env: { VERCEL_ENV: vercelEnvironment } },
  });
  return module.exports.default;
}

async function route(environment, url) {
  return unstable_getResponseFromNextConfig({
    nextConfig: loadConfig(environment),
    url,
    headers: { host: new URL(url).host },
  });
}

for (const environment of ['preview', 'development', undefined]) {
  test(`admin ${environment ?? 'local'} deployment keeps its own origin`, async () => {
    const response = await route(environment, 'https://admin-review.vercel.app/login?next=%2Fpayments');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
  });
}

test('production Vercel alias redirects to canonical admin with path and query intact', async () => {
  const response = await route('production', 'https://admin-web.vercel.app/payments/reports?currency=USD&range=month');
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://admin.platinumcircles.app/payments/reports?currency=USD&range=month');
});

test('production custom admin domain does not redirect to itself', async () => {
  const response = await route('production', 'https://admin.platinumcircles.app/login');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

test('production redirect does not match a hostname with an extra suffix', async () => {
  const response = await route('production', 'https://admin-web.vercel.app.example.com/login');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});
