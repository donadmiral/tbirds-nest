#!/usr/bin/env node
/** Reproducible local/CI checks. No deployment, external service or load target is contacted. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const output = path.resolve(args.output || path.join(os.tmpdir(), `platinum-release-checks-${process.pid}`));
const files = (folder, pattern) => fs.readdirSync(path.join(root, folder)).filter(name => pattern.test(name)).sort().map(name => path.join(root, folder, name));
const tests = app => [...files(app ? app + '/tests' : 'tests', /\.cjs$/), ...files(app ? app + '/tests/quality' : 'tests/quality', /\.cjs$/)];
const stages = {
  'phone-types': { cwd: root, args: [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'] },
  'web-types': { cwd: path.join(root, 'web'), args: [path.join(root, 'web/node_modules/typescript/bin/tsc'), '--noEmit'] },
  'admin-types': { cwd: path.join(root, 'admin-web'), args: [path.join(root, 'admin-web/node_modules/typescript/bin/tsc'), '--noEmit'] },
  'phone-tests': { cwd: root, args: ['--test', '--test-concurrency=2', ...tests('')] },
  'web-tests': { cwd: path.join(root, 'web'), args: ['--test', '--test-concurrency=2', ...tests('web')] },
  'admin-tests': { cwd: path.join(root, 'admin-web'), args: ['--test', '--test-concurrency=2', ...files('admin-web/tests', /\.cjs$/)] },
  'database-tests': { cwd: root, args: ['--experimental-strip-types', '--test', '--test-concurrency=2', ...files('supabase/tests', /\.test\.(?:cjs|mjs|ts|js)$/)] },
  'rpc-tests': { cwd: path.join(root, 'supabase/tests/rpc-authorization'), args: ['run-all.mjs'] },
};
async function run(name) {
  const stage = stages[name], began = Date.now(), log = path.join(output, name + '.log');
  const fd = fs.openSync(log, 'w');
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, stage.args, { cwd: stage.cwd, stdio: ['ignore', fd, fd], env: { ...process.env,
      PGLITE_MODULE: path.join(root, 'supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/index.cjs'),
      TRINITI_PGLITE_MODULE: path.join(root, 'supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/index.js'),
    } });
    child.once('error', () => resolve({ exitCode: null, failedToStart: true }));
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  fs.closeSync(fd);
  const report = { name, ...result, passed: result.exitCode === 0, durationMs: Date.now() - began, log };
  console.log(`${name}: ${report.passed ? 'PASS' : 'FAIL'} (${report.durationMs}ms); ${log}`);
  return report;
}
async function main() {
  const names = args.suite && args.suite !== 'all' ? args.suite.split(',') : Object.keys(stages);
  if (names.some(name => !Object.hasOwn(stages, name))) throw Error('Unknown suite. Choose: ' + Object.keys(stages).join(', '));
  fs.mkdirSync(output, { recursive: true });
  const reports = [];
  // At most two suites / four test files run together. PGlite WASM uses substantial memory.
  for (let index = 0; index < names.length; index += 2) reports.push(...await Promise.all(names.slice(index, index + 2).map(run)));
  const report = { measuredAt: new Date().toISOString(), node: process.version, passed: reports.every(item => item.passed), stages: reports };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
