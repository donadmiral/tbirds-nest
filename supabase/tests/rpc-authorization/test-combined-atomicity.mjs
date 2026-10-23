import {readCandidate} from './migration-source.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const base = new URL('./', import.meta.url);
const read = name => readFile(new URL(name, base), 'utf8');
const candidate = await readCandidate();
const push = await read('save-push-token-fixture.sql');
const group = await read('community-group-fixture.sql');
// Both disposable fixtures create the same synthetic auth roles/helper. Reuse
// push's scaffolding, preserving every group table/function/trigger source byte.
const marker = 'CREATE TABLE public.communities';
assert.equal(group.split(marker).length, 2);
const fixture = push+'\n'+group.slice(group.indexOf(marker));
const db = new PGlite();
const results = [];
const signature = 'public.save_push_token(uuid,text,text,text)';
const originalPush = '9f833a61f74da9f64f6996af04fb1196';
const snapshot = async () => (await db.query(`SELECT md5(pg_get_functiondef($1::regprocedure)) AS hash,
  (SELECT count(*)::int FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure) AS acl_count`, [signature])).rows[0];
try {
  await db.exec('BEGIN');
  await db.exec(fixture);
  for (const [name, drift] of [
    ['later function source drift rejects and rolls back the earlier push change', "ALTER FUNCTION public.community_admit(uuid,uuid,uuid) SET search_path=''"],
    ['later ACL drift rejects and rolls back the earlier push change', 'REVOKE EXECUTE ON FUNCTION public.community_admit(uuid,uuid,uuid) FROM anon']
  ]) {
    await db.exec('SAVEPOINT isolated_drift');
    await db.exec(drift);
    await db.exec('SAVEPOINT migration');
    await assert.rejects(() => db.exec(candidate), error => /Community\/group (source|ACL) changed/.test(error.message));
    await db.exec('ROLLBACK TO SAVEPOINT migration; RELEASE SAVEPOINT migration');
    assert.deepEqual(await snapshot(), {hash: originalPush, acl_count: 5});
    await db.exec('ROLLBACK TO SAVEPOINT isolated_drift; RELEASE SAVEPOINT isolated_drift');
    results.push(name);
  }
  await db.exec(candidate);
  assert.deepEqual(await snapshot(), {hash:'58b6505e591d48b25630474bb0699d54', acl_count:3});
  const rows = (await db.query(`SELECT proname, md5(pg_get_functiondef(oid)) AS hash,
    has_function_privilege('anon',oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',oid,'EXECUTE') AS service
    FROM pg_proc WHERE oid IN ('public.community_admit(uuid,uuid,uuid)'::regprocedure,
      'public.get_or_create_group_conversation(text,uuid,text,text,uuid)'::regprocedure) ORDER BY proname`)).rows;
  assert.deepEqual(rows, [
    {proname:'community_admit',hash:'bd8c75ce328111a56f26f3a44bf43a0d',anon:false,authenticated:false,service:true},
    {proname:'get_or_create_group_conversation',hash:'70e63e6529edf42d58358cc750e3123a',anon:false,authenticated:true,service:true}
  ]);
  results.push('combined migration applies all three expected definitions and restrictive ACLs');
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query("SELECT to_regclass('public.user_push_tokens') AS push, to_regclass('public.communities') AS community")).rows[0], {push:null,community:null});
  results.push('outer rollback removes both synthetic fixture schemas and data');
  const receipt = {hostedWrites:false,testCount:results.length,tests:results,candidateSha256:createHash('sha256').update(candidate).digest('hex')};
  console.log(JSON.stringify(receipt,null,2));
} finally { try{await db.exec('ROLLBACK')}catch{} await db.close(); }
