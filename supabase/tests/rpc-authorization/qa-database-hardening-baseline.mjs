import assert from 'node:assert/strict';
import { source } from './deployed-media-baseline.mjs';
export const qaHardeningBaseline=JSON.parse(await source('docs/quality/QA_DATABASE_HARDENING_PREFLIGHT_20261029.json'));
export async function installQaHardeningAclBaseline(db) {
  // Only ACL ordering differs for these shared functions. The loader verifies
  // their actual definitions first; it never replaces them with convenient stubs.
  for(const fn of qaHardeningBaseline.functions) {
    assert.match(fn.identity,/^public\.[a-z_][a-z_0-9]*\([a-z_ ,\[\]]*\)$/);
    const rows=(await db.query('select md5(pg_get_functiondef(to_regprocedure($1))) hash',[fn.identity])).rows;
    assert.equal(rows[0].hash,fn.definition_md5,fn.identity);
    await db.exec(`revoke all on function ${fn.identity} from public,postgres,anon,authenticated,service_role`);
    for(const item of fn.acl.slice(1,-1).split(',')) {
      const match=item.match(/^(postgres|anon|authenticated|service_role|)=X\/postgres$/);assert.ok(match,item);
      await db.exec(`grant execute on function ${fn.identity} to ${match[1]||'public'}`);
    }
    assert.equal((await db.query('select proacl::text acl from pg_proc where oid=to_regprocedure($1)',[fn.identity])).rows[0].acl,fn.acl);
  }
  for(const identity of qaHardeningBaseline.absentProviderHooks)
    assert.equal((await db.query('select to_regprocedure($1) oid',[identity])).rows[0].oid,null);
}
