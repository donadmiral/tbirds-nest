// Derive a forward-only QA delta from the reviewed production candidate and
// actual read-only QA catalog. No hosted operations or user rows are involved.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const productionPath='supabase/migrations/20261029234214_database_access_hardening.sql';
const qaPath='supabase/ops/qa/20261029235400_qa_database_access_hardening_forward.sql';
const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/quality/QA_DATABASE_HARDENING_PREFLIGHT_20261029.json'),'utf8'));
let sql=fs.readFileSync(path.join(root,productionPath),'utf8');
const original=JSON.parse(sql.match(/\$expected\$(.*?)\$expected\$/s)[1]);
const guards=original.filter(x=>!baseline.absentProviderHooks.includes(x.identity)).map(x=>{
 const actual=baseline.functions.find(f=>f.identity===x.identity);assert.ok(actual,x.identity);
 return {...x,definition_md5:x.definition_md5===null?null:actual.definition_md5,acl:actual.acl};
});
const inner=baseline.functions.find(x=>x.identity==='public.content_media_manifest_before_sound_rights(jsonb)');
assert.ok(inner);guards.push({identity:inner.identity,definition_md5:inner.definition_md5,acl:inner.acl});
sql=sql.replace(/\$expected\$(.*?)\$expected\$/s,()=>`$expected$${JSON.stringify(guards)}$expected$`);
sql=sql.replace(/\$tables\$(.*?)\$tables\$/s,()=>`$tables$${JSON.stringify(baseline.tables.map(({schema_name,name,acl})=>({schema_name,name,acl})))}$tables$`);
for(const identity of baseline.absentProviderHooks) {
 const line=`REVOKE EXECUTE ON FUNCTION ${identity} FROM PUBLIC, anon, authenticated;`;
 assert.equal(sql.split(line).length,2);sql=sql.replace(line,'');
}
const absence=baseline.absentProviderHooks.map(identity=>`to_regprocedure('${identity}') is not null`).join('\n    or ');
sql=sql.replace("  if to_regprocedure('public.can_view_story_highlight(uuid)')",`  if ${absence} then raise exception 'HARDENING_QA_PROVIDER_HOOK_DRIFT'; end if;\n  if to_regprocedure('public.can_view_story_highlight(uuid)')`);
const projection="old_source:=pg_get_functiondef('public.content_media_manifest(jsonb)'::regprocedure);";
assert.equal(sql.split(projection).length,2);
sql=sql.replace(projection,"old_source:=pg_get_functiondef('public.content_media_manifest_before_sound_rights(jsonb)'::regprocedure);");
sql=`-- QA-only exact catalog delta. Apply after the inspected QA admin/media\n-- adapters and account-erasure candidates. Preserves the sound-rights wrapper,\n-- entitlement helper, every existing account/session/staff/profile/Storage row,\n-- bucket setting and provider configuration. Do not apply to production.\n-- Derived from ${productionPath}.\n${sql}`;
fs.writeFileSync(path.join(root,qaPath),sql);
console.log(JSON.stringify({path:qaPath,sha256:crypto.createHash('sha256').update(sql).digest('hex'),guards:guards.length,absentProviderHooks:baseline.absentProviderHooks.length},null,2));
