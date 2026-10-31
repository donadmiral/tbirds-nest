import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../../../',import.meta.url);
export const qaMediaBaseline=JSON.parse(await readFile(new URL('docs/quality/QA_MEDIA_BASELINE_20261029.json',root),'utf8')).catalog;
export const qaMediaQuery=await readFile(new URL('supabase/ops/check-qa-media-completion-preflight.sql',root),'utf8');
export async function installQaMediaBaseline(db) {
 // All definitions are inspected catalog data, not user rows or credentials.
 const entitlement=JSON.parse(await readFile(new URL('docs/quality/QA_MEDIA_ENTITLEMENT_DEPENDENCY_20261029.json',root),'utf8'));
 // Empty structural dependency for the existing QA reader; no finance rows,
 // provider settings, catalogue rights or held migration are installed.
 const columnSql=entitlement.columns.map(c=>{assert.match(c.name,/^[a-z_]+$/);assert.match(c.type,/^[a-z ]+$/);return `${c.name} ${c.type}${c.notNull?' not null':''}`;}).join(',');
 await db.exec(`create table creator_finance.subscription_periods(${columnSql}); alter table creator_finance.subscription_periods enable row level security; revoke all on creator_finance.subscription_periods from public,anon,authenticated,service_role;`);
 const dependencies=JSON.parse(await readFile(new URL('docs/quality/QA_MEDIA_DEPENDENCIES_20261029.json',root),'utf8')).functions;
 for(const fn of [entitlement.function,...dependencies,...qaMediaBaseline.functions]) {
  await db.exec(fn.definition);
  const signature=fn.signature.includes('.')?fn.signature:`public.${fn.signature}`;
  await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role`);
  if(/(?:^\{|,)=X\/postgres(?:,|})/.test(fn.acl))await db.exec(`grant execute on function ${signature} to public`);
  for(const role of ['anon','authenticated','service_role'])if(fn.acl.includes(`${role}=X/postgres`))await db.exec(`grant execute on function ${signature} to ${role}`);
 }
 for(const p of qaMediaBaseline.policies) {
  assert.match(p.name,/^[a-z_]+$/);p.roles.forEach(role=>assert.match(role,/^(public|authenticated|anon|service_role)$/));
  await db.exec(`drop policy if exists ${p.name} on storage.objects`);
  const command={r:'select',a:'insert',w:'update',d:'delete','*':'all'}[p.cmd];assert.ok(command);
  await db.exec(`create policy ${p.name} on storage.objects as ${p.permissive?'permissive':'restrictive'} for ${command} to ${p.roles.join(',')}${p.using?` using(${p.using})`:''}${p.check?` with check(${p.check})`:''}`);
 }
 for(const t of qaMediaBaseline.triggers) {
  assert.match(t.name,/^[a-z_]+$/);assert.match(t.table,/^[a-z_]+$/);
  await db.exec(`drop trigger if exists ${t.name} on public.${t.table}`);await db.exec(t.definition);
 }
 await db.exec("update storage.buckets set public=false where id in('post-media','story-media','media','chat-media','chat-files')");
 assert.deepEqual((await db.query(qaMediaQuery)).rows[0].preflight,qaMediaBaseline,'Exact QA media catalog and 1/1/1/15 preservation fixture must match');
}
export async function qaDataSnapshot(db) {
 const data={};
 for(const table of ['auth.users','auth.sessions','public.profiles','public.admin_users','storage.objects','storage.buckets'])data[table]=(await db.query(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows;
 return data;
}
