'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { LocalPsqlSession } = require('../../supabase/tests/local-psql-session.cjs');
const root = path.resolve(__dirname, '../..');
const databases = new Set(['pc_scale_foundation_feed', 'pc_scale_foundation_media']);

function assertLocalEnvironment(env = process.env) {
  if (!databases.has(env.PGDATABASE) || !env.PGHOST?.startsWith('/') || !env.PC_TEST_PSQL) {
    throw Error('Capacity validation requires an explicit local Unix socket and disposable foundation database');
  }
  if (env.PGSERVICE || env.PGSERVICEFILE || env.PGHOSTADDR || env.PGOPTIONS) {
    throw Error('Connection overrides are forbidden for isolated capacity validation');
  }
}
function createSession() {
  assertLocalEnvironment();
  const session = new LocalPsqlSession();
  const originalQuery = session.query.bind(session);
  session.query = async (sql, deadlineMs = 35000) => {
    let timer;
    try {
      return await Promise.race([originalQuery(sql), new Promise((_, reject) => {
        timer = setTimeout(() => {
          session.child.kill('SIGKILL');
          reject(Object.assign(Error('Local database operation deadline'), { code: 'query_deadline' }));
        }, deadlineMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  session.json = async sql => {
    const raw = await session.query(sql);
    return raw === 't' ? true : raw === 'f' ? false : raw === '' ? null : JSON.parse(raw);
  };
  return session;
}
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function manifest(files) {
  return Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(source(file)).digest('hex')]));
}
function sourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
function outputReport(report, output) {
  if (!output) throw Error('An explicit report path is required');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ kind: report.kind, passed: report.passed, output }));
}
module.exports = { assertLocalEnvironment, createSession, source, manifest, sourceCommit, outputReport };
