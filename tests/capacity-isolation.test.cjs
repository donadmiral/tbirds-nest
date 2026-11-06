const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertLocalEnvironment } = require('../tools/performance/local-capacity-db.cjs');

test('destructive capacity setup cannot use a hosted URL, ordinary database, or libpq override', () => {
  const local = { PGDATABASE: 'pc_scale_foundation_feed', PGHOST: '/tmp/pc-capacity-foundation', PC_TEST_PSQL: '/usr/bin/psql' };
  assert.doesNotThrow(() => assertLocalEnvironment(local));
  for (const override of [{ PGHOST: '127.0.0.1' }, { PGHOST: 'db.example.supabase.co' }, { PGDATABASE: 'postgres' },
    { PGSERVICE: 'production' }, { PGHOSTADDR: '1.2.3.4' }, { PGSERVICEFILE: '/tmp/connection' }, { PGOPTIONS: '-c role=postgres' }]) {
    assert.throws(() => assertLocalEnvironment({ ...local, ...override }));
  }
});
