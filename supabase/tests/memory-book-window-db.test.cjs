const { test,before,after,beforeEach,afterEach }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {fixture,legacy,migration,login,BOOK,PRIVATE_BOOK,OWNER,VIEWER,id}=require('./paged-readers-fixture.cjs');
const {LocalPsqlSession}=require('./local-psql-session.cjs');
const real=!!process.env.PC_TEST_PSQL;
let db;
const sqlValue=value=>value===null?'null':"'"+String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")+"'";
async function scalar(sql,args=[]){
 if(!real)return Object.values((await db.query(sql,args)).rows[0])[0];
 const expanded=sql.replace(/\$(\d+)/g,(_,n)=>sqlValue(args[Number(n)-1]));
 return Object.values(JSON.parse(await db.query('select to_jsonb(q) from ('+expanded+') q')))[0];
}
async function exec(sql){return real?db.query(sql):db.exec(sql);}
async function rejects(sql,pattern){
 await exec('savepoint expected_failure;');
 try{
  if(!real)await assert.rejects(db.query(sql),pattern);
  else {
   // Exception is caught server-side so the local psql harness stays open.
   const message=await scalar(`select test_window_error($1)`,[sql]);
   assert.match(message,pattern);
  }
 }finally{await exec('rollback to savepoint expected_failure;release savepoint expected_failure;');}
}
const window=(anchor,revision='0',before=12,after=35,album=BOOK)=>scalar('select public.get_memory_book_window_v3($1,$2,$3,$4,$5)',[album,anchor,revision,before,after]);
before(async()=>{
 if(real){assert.match(process.env.PGDATABASE,/^pc_scale_book_window/);db=new LocalPsqlSession();await exec('drop schema if exists read_paging cascade;drop schema if exists memory_creative cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');}
 else{const{PGlite}=require('./rpc-authorization/node_modules/@electric-sql/pglite');db=new PGlite();}
 await exec(fixture+legacy+migration+fs.readFileSync(path.join(__dirname,'../migrations/20261102091728_bounded_memory_book_windows.sql'),'utf8'));
 if(real)await exec(`create function public.test_window_error(q text) returns text language plpgsql as $$begin execute q;return 'NO_ERROR';exception when others then return sqlerrm;end$$;grant execute on function public.test_window_error(text) to authenticated;`);
});
beforeEach(async()=>exec('reset role;begin;update read_paging.settings set books_ready=true;'+login()));
afterEach(async()=>exec('rollback;reset role;'));
after(async()=>db?.close());
test('bidirectional windows exactly match the canonical book including equal sort keys',async()=>{
 const full=await scalar('select public.get_memory_book($1)',[BOOK]);
 for(const at of [0,1,23,40,60,82])for(const [before,after]of [[12,35],[35,12]]){
  const start=Math.max(0,at-before),end=Math.min(full.pages.length,at+after+1),r=await window(full.pages[at].id,'0',before,after);
  assert.deepEqual(r.pages,full.pages.slice(start,end));assert.equal(r.anchor_index,at-start);
  assert.equal(r.has_previous,start>0);assert.equal(r.has_more,end<full.pages.length);assert.ok(r.pages.length<=48);
 }
});
test('the continuation cursor resumes directly after the returned window',async()=>{
 const full=await scalar('select public.get_memory_book($1)',[BOOK]),r=await window(full.pages[40].id,'0',12,12);
 const next=await scalar('select public.get_memory_book_page_v2($1,$2,10)',[BOOK,r.next_cursor]);
 assert.deepEqual(next.pages,full.pages.slice(53,63));
});
test('owner-only links open a bounded first page with full cover and count metadata',async()=>{
 await exec(`reset role;update memory_albums set is_default=true where id='${BOOK}';`+login());
 const r=await scalar('select public.get_default_memory_book_page_v3($1)',[OWNER]);
 assert.equal(r.count,83);assert.equal(r.pages.length,24);assert.equal(r.cover_page.id,id(2078));
 assert.equal((await scalar('select public.get_paged_reader_capabilities()')).books_window,true);
});
test('privacy denial contains no private book, revision, title or page identifiers',async()=>{
 const r=await window(id(2099),'0',12,35,PRIVATE_BOOK);
 assert.deepEqual(r,{version:3,can_view:false,pages:[]});
 await exec(`reset role;insert into blocked_users values('${VIEWER}','${OWNER}');`+login());
 assert.deepEqual(await window(id(2040)),{version:3,can_view:false,pages:[]});
});
test('stale revisions, other-book anchors and oversized windows fail visibly',async()=>{
 await rejects(`select public.get_memory_book_window_v3('${BOOK}','${id(2040)}','99',12,35)`,/MEMORY_BOOK_CHANGED/);
 await rejects(`select public.get_memory_book_window_v3('${BOOK}','${id(999999)}','0',12,35)`,/MEMORY_BOOK_CHANGED/);
 await rejects(`select public.get_memory_book_window_v3('${BOOK}','${id(2040)}','0',40,40)`,/INVALID_BOOK_WINDOW/);
});
test('disabled readers and anonymous/backend roles cannot use the member window',async()=>{
 assert.equal(await scalar("select has_function_privilege('anon','public.get_memory_book_window_v3(uuid,uuid,text,integer,integer)','execute')"),false);
 assert.equal(await scalar("select has_function_privilege('service_role','public.get_memory_book_window_v3(uuid,uuid,text,integer,integer)','execute')"),false);
 await exec('reset role;update read_paging.settings set books_ready=false;'+login());
 await rejects(`select public.get_memory_book_window_v3('${BOOK}','${id(2040)}','0',12,35)`,/NOT_READY/);
});
