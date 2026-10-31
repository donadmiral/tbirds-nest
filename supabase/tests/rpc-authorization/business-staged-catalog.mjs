// Canonical, OID-free catalog inventory shared by the reviewed staged package,
// its interrupted-installation tests and read-only hosted postflight. The
// caller uses SET LOCAL search_path=pg_catalog so deparser output is stable.
export const baselineNames = [
 ['studio_workflow','context'],['public','studio_role'],['public','studio_bind_member'],
 ['public','studio_set_device'],['public','resolve_media_delivery'],['public','triniti_admin_provision'],
];
export const publishedNames = [
 'business_session_allowed','business_auth_request_guard','triniti_business_signin_check',
 'triniti_business_owner_access','triniti_business_finish_signin','triniti_business_cancel_signin',
];
const namedFunctions = [...baselineNames,...publishedNames.map(name=>['public',name])]
 .map(([schema,name])=>`('${schema}','${name}')`).join(',');

// Include ACLs/owners and full function definitions, table structure/defaults,
// constraints/indexes, and every activation object. PG18 additionally records
// NOT NULL as contype='n' constraints; hosted PG17 does not. Fingerprint the
// mandatory attnotnull column flag on both and omit only those duplicate PG18
// catalog rows. All ACL bytes, other constraints and owners remain exact.
// Generated OIDs and volatile row timestamps are absent; data is checked separately.
export const catalogRowsSQL = `
select 'schema' k,nspname::text n,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) v from pg_namespace where nspname='business_auth'
union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='business_auth' or (n.nspname,p.proname) in (${namedFunctions})
union all select 'relation',c.relname,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('r','p','v','m','f','S')
union all select 'column',c.relname||'.'||a.attnum::text,jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='business_auth' and c.relkind in('r','p') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.relname||'.'||t.conname,to_jsonb(pg_get_constraintdef(t.oid)) from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and t.contype<>'n'
union all select 'index',c.relname,to_jsonb(pg_get_indexdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='business_auth' and c.relkind in('i','I')
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled) from pg_trigger t where not t.tgisinternal and t.tgname like 'business_auth_%'
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,jsonb_build_array(p.polpermissive,p.polcmd,(select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) from pg_policy p where p.polname='business_session_required' or p.polrelid in(select oid from pg_class where relnamespace=to_regnamespace('business_auth'))
union all select 'hook',coalesce(r.rolname,'ALL')||':'||coalesce(d.datname,'ALL'),to_jsonb(c) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase cross join lateral unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%' and c<>'pgrst.db_pre_request='
`;
export const fingerprintSQL=`select md5(coalesce(jsonb_agg(jsonb_build_array(k,n,v) order by k,n)::text,'[]')) from (${catalogRowsSQL}) inventory`;

export async function readCatalog(db){
 await db.exec('begin;set local search_path=pg_catalog');
 try{
  const rows=(await db.query(`select k,n,v from (${catalogRowsSQL}) inventory order by k,n`)).rows;
  const fingerprint=(await db.query(fingerprintSQL)).rows[0].md5;
  await db.exec('rollback');return{fingerprint,rows};
 }catch(error){await db.exec('rollback');throw error;}
}
