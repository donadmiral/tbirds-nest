import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {loadLiveSchema,extensions} from './live-schema-fixture.mjs';

const db=new PGlite({extensions});
const ids=Object.fromEntries(['buyer','seller','stranger'].map(name=>[name,randomUUID()]));
const sessions=Object.fromEntries(Object.keys(ids).map(name=>[name,randomUUID()]));
const listing=randomUUID();
const candidate=new URL('../../migrations/20261030181000_market_offer_response_serialization.sql',import.meta.url);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>Object.values((await q(sql,args))[0]||{})[0];

async function as(name,sql,args=[],role='authenticated',overrides={}) {
 await db.exec('savepoint request');
 try {
  await db.exec(`set local role ${role}`);
  const claims={sub:ids[name]||null,role,session_id:sessions[name]||null,is_anonymous:false,...overrides};
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
   [claims.sub||'',role,JSON.stringify(claims)]);
  const result=await value(sql,args);
  await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true),set_config('request.jwt.claims','{}',true)");
  await db.exec('release savepoint request');
  return result;
 } catch(error) {
  await db.exec('rollback to savepoint request;release savepoint request');
  throw error;
 }
}
const capabilities=(name='seller',overrides={},role='authenticated')=>as(name,'select public.offer_response_capabilities()',[],role,overrides);
const respond=(id,action,amount=null,name='seller',overrides={},role='authenticated')=>
 as(name,'select public.respond_offer($1,$2,$3)',[id,action,amount],role,overrides);
async function offer({proposer=ids.buyer,buyer=ids.buyer,seller=ids.seller,currency='USD',status='pending'}={}) {
 return value(`insert into public.listing_offers(listing_id,buyer_id,seller_id,proposer_id,amount,currency,status)
  values($1,$2,$3,$4,12.34,$5,$6) returning id`,[listing,buyer,seller,proposer,currency,status]);
}
const snapshot=async()=>({
 offers:await q('select to_jsonb(o) row from public.listing_offers o order by id'),
 messages:await q('select to_jsonb(m) row from public.messages m order by id'),
 conversations:await q('select to_jsonb(c) row from public.conversations c order by id'),
});

before(async()=>{
 await loadLiveSchema(db);
 const oldDefinition=await value("select pg_get_functiondef('public.respond_offer(uuid,text,numeric)'::regprocedure)");
 assert.equal(await value("select md5(pg_get_functiondef('public.respond_offer(uuid,text,numeric)'::regprocedure))"),'ff552c77266afb38f9674d912028fb35');
 const migration=await readFile(candidate,'utf8');
 await db.exec("alter function public.respond_offer(uuid,text,numeric) set search_path='pg_catalog'");
 await assert.rejects(db.exec(migration),/OFFER_RESPONSE_BASELINE_DRIFT/);
 await db.exec('rollback');
 assert.equal(await value("select to_regprocedure('public.offer_response_capabilities()')"),null);
 await db.exec(oldDefinition);
 for(const [name,id] of Object.entries(ids)) {
  await q('insert into auth.users(id,email) values($1,$2)',[id,`offers-${name}@example.test`]);
  await q("update public.profiles set username=$1,full_name=$1,account_type='personal' where id=$2",[`offers_${name}`,id]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')",[sessions[name],id]);
 }
 await q("insert into public.marketplace_listings(id,seller_id,title,price,currency,category,images) values($1,$2,'Synthetic offer listing',12.34,'USD','Other','{}')",[listing,ids.seller]);
 await offer({status:'declined'});
 const beforeInstall=await snapshot();
 await db.exec(migration);
 assert.deepEqual(await snapshot(),beforeInstall,'install preserves existing offer/conversation/message rows');
});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());

test('capability advertises the unchanged serialized contract and grants only authenticated callers',async()=>{
 assert.deepEqual(await capabilities(),{version:1,serialized:true,replay:false,fractionDigits:2,maxAmount:'9999999999.99'});
 for(const signature of ['public.offer_response_capabilities()','public.respond_offer(uuid,text,numeric)']) {
  const row=(await q(`select pg_get_userbyid(proowner) owner,proconfig,pg_get_function_result(oid) result,
   has_function_privilege('anon',oid,'EXECUTE') anon_execute,
   has_function_privilege('authenticated',oid,'EXECUTE') app_execute,
   has_function_privilege('service_role',oid,'EXECUTE') service_execute
   from pg_proc where oid=$1::regprocedure`,[signature]))[0];
  assert.equal(row.owner,'postgres');assert.deepEqual(row.proconfig,['search_path=""']);
  assert.equal(row.anon_execute,false);assert.equal(row.app_execute,true);assert.equal(row.service_execute,false);
  if(signature.includes('respond_offer'))assert.equal(row.result,'void');
 }
 await assert.rejects(capabilities('seller',{},'anon'),/permission denied/);
 await assert.rejects(capabilities('seller',{},'service_role'),/permission denied/);
 const id=await offer();
 await assert.rejects(respond(id,'accepted',null,'seller',{},'anon'),/permission denied/);
 await assert.rejects(respond(id,'accepted',null,'seller',{},'service_role'),/permission denied/);
});

test('missing, malformed, substituted, anonymous and expired Auth sessions cannot respond',async()=>{
 const id=await offer(),before=await snapshot();
 for(const claims of [
  {session_id:null},{session_id:'invalid'},{session_id:randomUUID()},
  {session_id:sessions.buyer},{is_anonymous:true},{is_anonymous:'untrusted'},
 ]) {
  await assert.rejects(capabilities('seller',claims),/OFFER_SESSION_REQUIRED/);
  await assert.rejects(respond(id,'accepted',null,'seller',claims),/OFFER_SESSION_REQUIRED/);
 }
 await assert.rejects(capabilities(null),/OFFER_SESSION_REQUIRED/);
 await q("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[sessions.seller]);
 await assert.rejects(respond(id,'accepted'),/OFFER_SESSION_REQUIRED/);
 await q('delete from auth.sessions where id=$1',[sessions.seller]);
 await assert.rejects(respond(id,'accepted'),/OFFER_SESSION_REQUIRED/);
 assert.deepEqual(await snapshot(),before);
});

test('banned, erased, deactivated and currently restricted accounts cannot respond',async()=>{
 const id=await offer(),before=await snapshot();
 for(const mutation of [
  "update auth.users set banned_until='infinity' where id=$1",
  'update auth.users set deleted_at=clock_timestamp() where id=$1',
  'update public.profiles set deactivated_at=clock_timestamp() where id=$1',
  "update public.profiles set restricted_until=clock_timestamp()+interval '1 day' where id=$1",
 ]) {
  await db.exec('savepoint unavailable');await q(mutation,[ids.seller]);
  await assert.rejects(respond(id,'accepted'),/OFFER_SESSION_REQUIRED|OFFER_ACCOUNT_UNAVAILABLE/);
  await db.exec('rollback to savepoint unavailable;release savepoint unavailable');
 }
 assert.deepEqual(await snapshot(),before);
});

test('business identity fails closed without an approved business session contract',async()=>{
 const id=await offer();await q("update public.profiles set account_type='business' where id=$1",[ids.seller]);
 await assert.rejects(capabilities(),/BUSINESS_SESSION_REQUIRED/);
 await assert.rejects(respond(id,'accepted'),/BUSINESS_SESSION_REQUIRED/);
 await db.exec('create function public.business_session_allowed() returns boolean language sql as $$select null::boolean$$');
 await assert.rejects(respond(id,'accepted'),/BUSINESS_SESSION_REQUIRED/);
 await db.exec('create or replace function public.business_session_allowed() returns boolean language sql as $$select false$$');
 await assert.rejects(capabilities(),/BUSINESS_SESSION_REQUIRED/);
 await db.exec('create or replace function public.business_session_allowed() returns boolean language sql as $$select true$$');
 assert.equal((await capabilities()).serialized,true);await respond(id,'accepted');
 assert.equal(await value('select status from public.listing_offers where id=$1',[id]),'accepted');
});

test('a nonparticipant cannot resolve an offer or discover its state',async()=>{
 const id=await offer(),before=await snapshot();
 for(const action of ['accepted','declined','countered','withdrawn']) {
  await assert.rejects(respond(id,action,action==='countered'?'11.00':null,'stranger'),/OFFER_NOT_FOUND/);
 }
 await assert.rejects(respond(randomUUID(),'accepted',null,'stranger'),/OFFER_NOT_FOUND/);
 assert.deepEqual(await snapshot(),before);
});

test('only the opposite participant responds and only the actual proposer withdraws',async()=>{
 const id=await offer(),before=await snapshot();
 for(const action of ['accepted','declined','countered']) {
  await assert.rejects(respond(id,action,action==='countered'?'11.00':null,'buyer'),/OFFER_RESPONSE_FORBIDDEN/);
 }
 await assert.rejects(respond(id,'withdrawn'),/OFFER_RESPONSE_FORBIDDEN/);
 assert.deepEqual(await snapshot(),before);
 await respond(id,'withdrawn',null,'buyer');
 assert.equal(await value('select status from public.listing_offers where id=$1',[id]),'withdrawn');
 const other=await offer({proposer:ids.seller});await respond(other,'declined',null,'buyer');
 assert.equal(await value('select status from public.listing_offers where id=$1',[other]),'declined');
});

test('corrupt participant tuples cannot create messages or counter offers',async()=>{
 for(const args of [{proposer:ids.stranger},{buyer:ids.seller,proposer:ids.seller}]) {
  const id=await offer(args),before=await snapshot();
  await assert.rejects(respond(id,'accepted'),/OFFER_INVALID_PARTICIPANTS/);
  assert.deepEqual(await snapshot(),before);
 }
});

test('invalid actions and amounts leave the offer and its conversation untouched',async()=>{
 const id=await offer(),before=await snapshot();
 for(const action of [null,'accept','pending','Countered','']) {
  await assert.rejects(respond(id,action),/OFFER_INVALID_ACTION/);
 }
 for(const amount of [null,'0','-1','0.001','1.999','10000000000','NaN','Infinity','-Infinity']) {
  await assert.rejects(respond(id,'countered',amount),/OFFER_INVALID_AMOUNT/);
 }
 await assert.rejects(respond(id,'accepted','12.34'),/OFFER_UNEXPECTED_AMOUNT/);
 await assert.rejects(respond(null,'accepted'),/OFFER_INVALID_ACTION/);
 assert.deepEqual(await snapshot(),before);
});

test('a valid counter commits one linked card, canonical amount and reversed proposer',async()=>{
 const id=await offer();await respond(id,'countered','11.01');
 const [parent]=await q('select status,responded_at from public.listing_offers where id=$1',[id]);
 assert.equal(parent.status,'countered');assert.ok(parent.responded_at);
 const [card]=await q("select sender_id,receiver_id,media_url::jsonb meta from public.messages where media_type='offer'");
 assert.equal(card.sender_id,ids.seller);assert.equal(card.receiver_id,ids.buyer);
 assert.equal(card.meta.counter_of,id);assert.equal(card.meta.amount,11.01);assert.equal(card.meta.currency,'USD');
 const [child]=await q('select * from public.listing_offers where id=$1',[card.meta.offer_id]);
 assert.equal(child.status,'pending');assert.equal(child.proposer_id,ids.seller);
 assert.equal(child.buyer_id,ids.buyer);assert.equal(child.seller_id,ids.seller);assert.equal(child.amount,'11.01');
 await assert.rejects(respond(child.id,'accepted'),/OFFER_RESPONSE_FORBIDDEN/);
 await respond(child.id,'accepted',null,'buyer');
 assert.equal(await value('select status from public.listing_offers where id=$1',[child.id]),'accepted');
});

test('exact minimum and maximum amounts work in both supported currencies',async()=>{
 for(const [amount,currency] of [['0.01','USD'],['9999999999.99','ZWG']]) {
  const id=await offer({currency});await respond(id,'countered',amount);
  const meta=await value("select media_url::jsonb from public.messages where media_type='offer' and media_url::jsonb->>'counter_of'=$1",[id]);
  assert.equal(await value('select amount::text from public.listing_offers where id=$1',[meta.offer_id]),amount);
 }
 const invalid=await offer({currency:'XXX'}),before=await snapshot();
 await assert.rejects(respond(invalid,'countered','1.00'),/OFFER_UNSUPPORTED_CURRENCY/);
 assert.deepEqual(await snapshot(),before);
});

test('lost-response retry and stale competing response never duplicate a counter or message',async()=>{
 const id=await offer();await respond(id,'countered','11.00');const committed=await snapshot();
 await assert.rejects(respond(id,'countered','11.00'),error=>error.message==='OFFER_ALREADY_RESOLVED'&&error.code==='55000');
 await assert.rejects(respond(id,'accepted'),/OFFER_ALREADY_RESOLVED/);
 await assert.rejects(respond(id,'withdrawn',null,'buyer'),/OFFER_ALREADY_RESOLVED/);
 assert.deepEqual(await snapshot(),committed);
});

test('every resolved state rejects a stale decision without changing the winning state',async()=>{
 for(const status of ['accepted','declined','countered','withdrawn']) {
  const id=await offer({status}),before=await snapshot();
  await assert.rejects(respond(id,'accepted'),/OFFER_ALREADY_RESOLVED/);
  assert.deepEqual(await snapshot(),before);
 }
});

test('an injected message failure rolls back the parent transition, child and conversation',async()=>{
 const id=await offer(),before=await snapshot();
 await db.exec(`create function public.offer_test_reject_message() returns trigger language plpgsql as $$
  begin raise exception 'SYNTHETIC_MESSAGE_FAILURE';end$$;
  create trigger offer_test_reject_message before insert on public.messages for each row execute function public.offer_test_reject_message();`);
 await assert.rejects(respond(id,'countered','10.00'),/SYNTHETIC_MESSAGE_FAILURE/);
 assert.deepEqual(await snapshot(),before);
});

test('the optional installed erasure fence runs before any offer mutation',async()=>{
 const id=await offer(),before=await snapshot();
 await db.exec(`create schema account_erasure;
  create function account_erasure.assert_writable(uuid) returns void language plpgsql as $$
  begin raise exception 'ACCOUNT_ERASURE_IN_PROGRESS';end$$;`);
 await assert.rejects(respond(id,'accepted'),/ACCOUNT_ERASURE_IN_PROGRESS/);
 assert.deepEqual(await snapshot(),before);
});

test('the offer query obtains a PostgreSQL row lock before evaluating the mutable state',async()=>{
 // EXPLAIN validates the lock operation in PostgreSQL's actual query planner.
 // PGlite has one connection: this is not a multi-session contention claim.
 const id=await offer();
 const plan=await value('explain (format json) select o.* from public.listing_offers o where o.id=$1 and $2::uuid in(o.buyer_id,o.seller_id) for update',[id,ids.seller]);
 assert.match(JSON.stringify(plan),/LockRows/);
 const body=await value("select prosrc from pg_proc where oid='public.respond_offer(uuid,text,numeric)'::regprocedure");
 assert.ok(body.indexOf('for update;')<body.indexOf("v_offer.status<>'pending'"));
});
