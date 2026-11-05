import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {splitSql} from '../../tests/rpc-authorization/business-staged-sql.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=fileURLToPath(new URL('./',import.meta.url));
const source=fs.readFileSync(root+'supabase/migrations/20261105044917_prepared_feed_snapshots.sql','utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');const digest=hash(source);
const statements=splitSql(source).statements;const s=i=>statements[i].sql;
const header="begin;\nset local lock_timeout='3s';\nset local statement_timeout='30s';\n";
const marker=n=>`prepared-feed:${digest}:${n}`;
const guard=n=>`do $$begin if obj_description('prepared_feed'::regnamespace,'pg_namespace') is distinct from '${marker(n)}' then raise exception 'PREPARED_FEED_STAGE_MISMATCH';end if;end$$;\n`;
const fence="\nrevoke all on schema prepared_feed from public,anon,authenticated,service_role;\nrevoke all on all tables in schema prepared_feed from public,anon,authenticated,service_role;\nrevoke all on all functions in schema prepared_feed from public,anon,authenticated,service_role;\n";
const finish=n=>`comment on schema prepared_feed is '${marker(n)}';\ncommit;\n`;
const privateCreate=i=>s(i).replace('create function public.','create function prepared_feed.');
const dynamic=s(31),tailStart=dynamic.indexOf(" execute format('create function prepared_feed.tail"),wrapperStart=dynamic.indexOf(" execute format('create function public.get_feed");
const prelude="do $$declare result_type text;projection text;begin select t.result_type,t.projection into result_type,projection from prepared_feed.install_contract t;";
const metadata=`\ncreate table prepared_feed.install_contract as select pg_get_function_result(p.oid) result_type,string_agg(case when name='sort_key' then 'chosen.key' else 'card.'||quote_ident(name)end,', ' order by ord)projection,md5(pg_get_functiondef(p.oid)) baseline from pg_proc p,unnest(p.proargnames,p.proargmodes)with ordinality a(name,mode,ord)where p.oid='public.get_feed(text,double precision,uuid,integer)'::regprocedure and mode='t' group by p.oid;\nalter table prepared_feed.install_contract enable row level security;\n`;
const stages=[
 ['01_private_foundation.sql',header+Array.from({length:28},(_,i)=>s(i+3)).join('')+fence+finish(1)],
 ['02_private_rank.sql',header+guard(1)+[32,33,34,35].map(s).join('')+fence+finish(2)],
 ['03_private_worker.sql',header+guard(2)+privateCreate(36)+"\nrevoke all on function prepared_feed.drain_prepared_feed_v1(integer) from public,anon,authenticated,service_role;\n"+finish(3)],
 ['04_private_controls.sql',header+guard(3)+s(37)+privateCreate(42)+privateCreate(43)+metadata+fence+finish(4)],
 ['05_private_tail.sql',header+guard(4)+prelude+dynamic.slice(tailStart,wrapperStart)+'end$$;'+fence+finish(5)],
 ['06_private_dispatch.sql',header+prelude+dynamic.slice(wrapperStart,dynamic.lastIndexOf('end$$;')).replace('create function public.get_feed','create function prepared_feed.dispatch')+'end$$;\nrevoke all on function prepared_feed.dispatch(text,double precision,uuid,integer) from public,anon,authenticated,service_role;\n'+finish(6)],
 ['07_activate_contract.sql',header+guard(6)+`do $$begin if (select baseline from prepared_feed.install_contract) is distinct from md5(pg_get_functiondef('public.get_feed(text,double precision,uuid,integer)'::regprocedure)) then raise exception 'PREPARED_FEED_CANONICAL_DRIFT';end if;end$$;\nalter function public.get_feed(text,double precision,uuid,integer) set schema prepared_feed;\nalter function prepared_feed.get_feed(text,double precision,uuid,integer) rename to canonical;\nalter function prepared_feed.dispatch(text,double precision,uuid,integer) set schema public;\nalter function public.dispatch(text,double precision,uuid,integer) rename to get_feed;\nalter function prepared_feed.drain_prepared_feed_v1(integer) set schema public;\nalter function prepared_feed.configure_prepared_feed_v1(boolean) set schema public;\nalter function prepared_feed.prepared_feed_status_v1() set schema public;\n`+[38,39,40,41,44,45,46,47,48,49].map(s).join('')+'\ngrant usage on schema prepared_feed to authenticated;\ngrant select on prepared_feed.demand,prepared_feed.snapshots to authenticated;\ndrop table prepared_feed.install_contract;\ncomment on schema prepared_feed is null;'+s(50)+'\ncommit;\n']
];
for(const[name,sql]of stages){if(name!=='01_private_foundation.sql'&&Buffer.byteLength(sql)>=4000)throw Error(name+' too large '+Buffer.byteLength(sql));fs.writeFileSync(directory+name,sql);}
for(const name of ['02_private_workers.sql','03_activate_contract.sql'])if(fs.existsSync(directory+name))fs.unlinkSync(directory+name);
fs.writeFileSync(directory+'manifest.json',JSON.stringify({original:{path:'supabase/migrations/20261105044917_prepared_feed_snapshots.sql',sha256:digest,bytes:Buffer.byteLength(source)},stages:stages.map(([name,sql])=>({name,sha256:hash(sql),bytes:Buffer.byteLength(sql)})),preserved:'Original function bodies byte-identical. Public CREATE headers temporarily use private schema; all functions moved atomically at final activation. Original canonical swap, grants and invalidation triggers activate in one transaction. Private stages deny app and service-role schema, table and function access. All stages retain 3s lock and 30s statement timeouts. Temporary contract metadata is removed at activation.'},null,2)+'\n');
console.log(stages.map(([name,sql])=>({name,bytes:Buffer.byteLength(sql)})));
