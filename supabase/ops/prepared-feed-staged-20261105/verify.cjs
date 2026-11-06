const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('../../tests/rpc-authorization/node_modules/@electric-sql/pglite');
const {fixture,migration,sql}=require('../../tests/feed-scale-fixture.cjs');
const catalog=`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)end,a.privilege_type,a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(p.proacl)a))order by n.nspname,p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='prepared_feed' or n.nspname='public' and p.proname in('get_feed','drain_prepared_feed_v1','configure_prepared_feed_v1','prepared_feed_status_v1')),
 'columns',(select jsonb_agg(to_jsonb(c)order by table_name,ordinal_position)from information_schema.columns c where table_schema='prepared_feed'),
 'indexes',(select jsonb_agg(to_jsonb(i)order by indexname)from pg_indexes i where schemaname='prepared_feed'),
 'policies',(select jsonb_agg(to_jsonb(p)order by policyname)from pg_policies p where schemaname='prepared_feed'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)order by tgname)from pg_trigger t where tgname like 'prepared_feed_%'),
 'schema_comment',obj_description('prepared_feed'::regnamespace,'pg_namespace'),
 'settings',(select jsonb_agg(s)from prepared_feed.settings s)) result`;
async function setup(db){await db.exec(fixture);await db.exec("create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant execute on function auth.jwt() to authenticated,anon,service_role;");await db.exec(migration);}
(async()=>{const original=new PGlite(),staged=new PGlite();try{
 await setup(original);await setup(staged);
 await original.exec(sql('20261105044917_prepared_feed_snapshots.sql'));
 const baseline=(await staged.query("select pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure) def")).rows[0].def;
 for(const {name} of require('./manifest.json').stages.slice(0,-1)){
  await staged.exec(fs.readFileSync(path.join(__dirname,name),'utf8'));
  assert.equal((await staged.query("select pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure) def")).rows[0].def,baseline);
  assert.equal((await staged.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('drain_prepared_feed_v1','configure_prepared_feed_v1','prepared_feed_status_v1')")).rows[0].n,0);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await staged.query(`select has_schema_privilege('${role}','prepared_feed','usage') allowed`)).rows[0].allowed,false);
  assert.equal((await staged.query("select count(*)::int n from pg_trigger where tgname like 'prepared_feed_%'")).rows[0].n,0);
 }
 await staged.exec(fs.readFileSync(path.join(__dirname,'07_activate_contract.sql'),'utf8'));
 const a=(await original.query(catalog)).rows[0].result,b=(await staged.query(catalog)).rows[0].result;
 assert.deepEqual(b,a);
 console.log('PASS: private stages deny app/service access; unchanged canonical feed until atomic activation; final function definitions, ACLs, owners, columns, indexes, policies, triggers and settings equal original.');
}finally{await original.close();await staged.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
