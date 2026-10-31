import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {extensions} from './live-schema-fixture.mjs';
import {loadBusinessAuthBaseline} from './business-auth-fixture.mjs';
import {splitSql,statementKind} from './business-staged-sql.mjs';
import {catalogRowsSQL,fingerprintSQL,readCatalog} from './business-staged-catalog.mjs';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const originalPath='supabase/migrations/20261030034752_business_bound_auth_sessions.sql';
const originalHash='66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996';
const classifierHash='e350da140fa468ed224fca628885cd6212a78aaf7cb7ae1ff4d8468c0ba52c46';
const hash=text=>createHash('sha256').update(text).digest('hex');
const original=await readFile(resolve(root,originalPath),'utf8');assert.equal(hash(original),originalHash);
const classifierPath=process.env.SUPABASE_MCP_DESTRUCTIVE_SQL_SOURCE;
assert.ok(classifierPath,'Set SUPABASE_MCP_DESTRUCTIVE_SQL_SOURCE to the reviewed official destructive-sql.ts');
assert.equal(hash(await readFile(classifierPath)),classifierHash,'Official classifier source changed; review is required');
const {checkDestructiveQuery}=await import(pathToFileURL(resolve(classifierPath)).href);
const {statements,trailing}=splitSql(original);
assert.equal(statements.map(s=>s.sql).join('')+trailing,original);assert.equal(statements.length,52);
const destinations=new Map([
 [23,'business_session_allowed()'],[24,'business_auth_request_guard()'],
 [29,'triniti_business_signin_check(text,text,text,text,text)'],
 [30,'triniti_business_owner_access(uuid,uuid,uuid,text,text,text,boolean,uuid)'],
 [31,'triniti_business_finish_signin(uuid,uuid,uuid,text)'],
 [32,'triniti_business_cancel_signin(uuid,uuid,uuid)'],
]);
function stagedStatement(index){
 const text=statements[index].sql;
 if(!destinations.has(index))return text;
 const changed=text.replace(/create function public\./,'create function business_auth.');
 assert.notEqual(changed,text);
 // The only transformation is a schema in the CREATE header. In particular,
 // the original cleanup DELETEs stay visible and retain approval classification.
 assert.equal(changed.replace(/create function business_auth\./,'create function public.'),text);
 assert.equal(checkDestructiveQuery(changed),checkDestructiveQuery(text));
 return changed;
}
const groups=[
 {name:'foundation',indices:[3,4,5,6,...Array.from({length:13},(_,i)=>i+8)]},
 {name:'private_guards',indices:[21,22,23,24,25,27]},
 {name:'private_device',indices:[28]},
 {name:'private_member_signin',indices:[29]},
 {name:'private_owner_access',indices:[30]},
 {name:'private_finish_signin',indices:[31]},
 {name:'private_revocation',indices:[32,33,35,37,39]},
];
const activationIndices=[26,34,36,38,40,7,...Array.from({length:10},(_,i)=>i+41)];
const used=[0,1,2,...groups.flatMap(g=>g.indices),...activationIndices,51].sort((a,b)=>a-b);
assert.deepEqual(used,statements.map(s=>s.index),'Every original statement must appear exactly once');

const tag=number=>`business-auth:${originalHash}:stage-${number}`;
const privateFence=`
do $private_stage$
declare t record;
begin
 for t in select oid::regclass name from pg_class where relnamespace='business_auth'::regnamespace and relkind='r' loop
  execute format('alter table %s enable row level security',t.name);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t.name);
 end loop;
end $private_stage$;
revoke all on schema business_auth from public,anon,authenticated,service_role;
revoke all on all functions in schema business_auth from public,anon,authenticated,service_role;
`;
function guard(number,fingerprint){return `
do $stage_guard$
declare stage_relation record;stage_rows bigint;
begin
 if current_user<>'postgres' then raise exception 'BUSINESS_AUTH_POSTGRES_REQUIRED';end if;
 if obj_description(to_regnamespace('business_auth'),'pg_namespace') is distinct from '${tag(number)}' then raise exception 'BUSINESS_AUTH_STAGE_ORDER';end if;
 if (${fingerprintSQL}) is distinct from '${fingerprint}' then raise exception 'BUSINESS_AUTH_STAGED_CATALOG_DRIFT';end if;
 for stage_relation in select oid::regclass name from pg_class where relnamespace=to_regnamespace('business_auth') and relkind='r' loop
  execute format('select count(*) from %s',stage_relation.name) into stage_rows;
  if stage_rows<>0 then raise exception 'BUSINESS_AUTH_STAGED_DATA_REVIEW: %',stage_relation.name;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','creator_finance','marketplace_ops','storage') and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) then raise exception 'BUSINESS_AUTH_UNFENCED_TABLE_REVIEW';end if;
 if exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id where p.account_type='business') then raise exception 'BUSINESS_AUTH_EXISTING_SESSIONS_CUTOVER_REQUIRED';end if;
end $stage_guard$;
`;}
const header=number=>`-- Reviewed business-auth staged installation ${number}; source SHA256 ${originalHash}.
-- No statement is hidden or encoded. Original destructive classifications are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
set local search_path=pg_catalog;
`;
const directory='supabase/ops/qa/business-auth-staged-20261031';
await mkdir(resolve(root,directory),{recursive:true});
const db=new PGlite({extensions}),reference=new PGlite({extensions});
const manifests=[];let previous;
async function baseline(target){
 await loadBusinessAuthBaseline(target,true,true);
 await target.exec("insert into auth.users(id,email) values('e45ecfa4-6bf2-4f90-83c1-a8fb7bf5054a','staged-business@example.invalid');update public.profiles set account_type='business',username='staged_business' where id='e45ecfa4-6bf2-4f90-83c1-a8fb7bf5054a'");
}
async function saveStage(number,name,sql,indices,expectedAfter,extra={}){
 const path=`${directory}/${String(number).padStart(2,'0')}_${name}.sql`;
 await writeFile(resolve(root,path),sql);
 manifests.push({number,name,path,bytes:Buffer.byteLength(sql),sha256:hash(sql),requiresDestructiveConfirmation:checkDestructiveQuery(sql),originalStatementIndices:indices,expectedBeforeFingerprint:previous?.fingerprint??null,expectedAfterFingerprint:expectedAfter.fingerprint,...extra});
 previous=expectedAfter;
}
try{
 await baseline(db);await baseline(reference);
 const before=await readCatalog(db);assert.deepEqual(before,await readCatalog(reference));
 for(const [offset,group]of groups.entries()){
  const number=offset+1;
  const sql=header(number)+(number===1?'':guard(number-1,previous.fingerprint))+group.indices.map(stagedStatement).join('')+privateFence+`comment on schema business_auth is '${tag(number)}';\ncommit;\n`;
  await db.exec(sql);const after=await readCatalog(db);
  await saveStage(number,group.name,sql,group.indices,after,{publicActivation:false});
 }
 const number=groups.length+1;
 // Prevent an Auth session or business-profile transition racing the final
 // cutover preflight. CREATE TRIGGER also holds the profile table lock while
 // the account seed is written. Lock timeout preserves normal live traffic.
 const activation=header(number)+`lock table public.profiles,auth.sessions in share row exclusive mode;\n`+guard(number-1,previous.fingerprint)+[...destinations.values()].map(signature=>`alter function business_auth.${signature} set schema public;`).join('\n')+activationIndices.map(index=>statements[index].sql).join('')+`\ncomment on schema business_auth is null;\n`+statements[51].sql+'\n';
 await db.exec(activation);const after=await readCatalog(db);
 await reference.exec(original);const expected=await readCatalog(reference);
 assert.deepEqual(after,expected,'Staged installation must have the same final catalog as the exact original migration');
 assert.equal((await db.query("select obj_description('business_auth'::regnamespace,'pg_namespace') comment")).rows[0].comment,null);
 const accountRows=target=>target.query('select business_id,bootstrapped_at,created_at is not null has_timestamp from business_auth.accounts order by business_id').then(r=>r.rows);
 assert.deepEqual(await accountRows(db),await accountRows(reference));
 await saveStage(number,'activate',activation,activationIndices,after,{publicActivation:true,locks:['public.profiles SHARE ROW EXCLUSIVE','auth.sessions SHARE ROW EXCLUSIVE']});
 const originalMappings=statements.map(s=>({index:s.index,bytes:Buffer.byteLength(s.sql),sha256:hash(s.sql),firstLine:statementKind(s).split('\n')[0],requiresDestructiveConfirmation:checkDestructiveQuery(s.sql),stagedPrivateSignature:destinations.get(s.index)?`business_auth.${destinations.get(s.index)}`:null}));
 assert.deepEqual(originalMappings.filter(s=>s.requiresDestructiveConfirmation).map(s=>s.index),[29,39]);
 assert.deepEqual(manifests.filter(stage=>stage.requiresDestructiveConfirmation).map(stage=>stage.number),[4,7]);
 assert.ok(manifests[3].bytes<8000,'The approved finite diagnostic must keep the unchanged classified function under8KB');
 const combined=manifests.map(m=>readFile(resolve(root,m.path),'utf8'));
 await writeFile(resolve(root,`${directory}/combined.sql`),(await Promise.all(combined)).join('\n'));
 await writeFile(resolve(root,`${directory}/postflight.sql`),`begin;set local search_path=pg_catalog;select jsonb_build_object('observedAt',clock_timestamp(),'fingerprint',(${fingerprintSQL}),'schemaComment',obj_description(to_regnamespace('business_auth'),'pg_namespace'),'catalog',(select jsonb_agg(jsonb_build_object('kind',k,'name',n,'value',v) order by k,n) from (${catalogRowsSQL}) inventory));rollback;\n`);
 await writeFile(resolve(root,`${directory}/candidate.json`),JSON.stringify({version:1,projectRef:'uaulhuelcfkjwojtymmw',original:{path:originalPath,bytes:Buffer.byteLength(original),sha256:originalHash},classifier:{source:'https://github.com/supabase-community/supabase-mcp/blob/ed5084d1957541c5130f551d5f7e0fee5e3ddfeb/packages/mcp-server-supabase/src/tools/destructive-sql.ts',sha256:classifierHash,scope:'Exact official source executed; classification is retained, not proof of approval or of the remote stall cause.'},generatedBy:relative(root,fileURLToPath(import.meta.url)),baselineFingerprint:before.fingerprint,stages:manifests,originalStatements:originalMappings,transactionBoundaries:{originalIndices:[0,1,2,51],change:'BEGIN/SET LOCAL timeouts/COMMIT are regenerated for each transaction, with an explicit pg_catalog deparser search path. Original substantive statements3–50 are mapped once; six CREATE headers move temporarily to the private schema.'},localEquivalence:{catalogEqual:true,seededAccountIdsEqual:true,allOriginalSubstantiveStatementsMappedOnce:true,newPublicFunctionsRemainPrivateUntilActivation:true,additionalPersistentObjects:false},limits:['No hosted installation is asserted by this generated candidate.','Approval-classified units must retain the provider confirmation path.','The final atomic unit is larger because splitting its activation would change live authorization behavior.','Final policy enumeration depends on the current eligible hosted tables; independent postflight must check complete coverage and exact policy definitions.']},null,2)+'\n');
 console.log(JSON.stringify({directory,baselineFingerprint:before.fingerprint,stages:manifests.map(({number,name,bytes,sha256,requiresDestructiveConfirmation})=>({number,name,bytes,sha256,requiresDestructiveConfirmation})),finalCatalogEquivalent:true},null,2));
}finally{await db.close();await reference.close();}
