// Opt-in query-shape experiment. Synthetic rows only, Unix socket only, and a
// dedicated disposable database. This is not a production capacity certificate.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { LocalPsqlSession } = require('./local-psql-session.cjs');
const { fixture, legacy, migration, login, id, OWNER, VIEWER, FOREIGN, BOOK } = require('./paged-readers-fixture.cjs');
async function run() {
  if (!process.env.PC_TEST_PSQL) { console.log('Skipped: set the local PostgreSQL fixture variables to run.'); return; }
  assert.equal(process.env.PGDATABASE, 'pc_scale_paging');
  const session = new LocalPsqlSession();
  try {
    assert.equal(await session.query("select current_database()='pc_scale_paging' and inet_server_addr() is null;"), 't');
    await session.query('drop schema if exists read_paging cascade;drop schema if exists memory_creative cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;');
    await session.query("set timezone='UTC';set jit=off;set statement_timeout='120s';");
    await session.query(fixture + legacy);
    await session.query(`insert into stories(id,user_id,media_url,media_type)
      select ('00000000-0000-0000-0000-'||lpad((1000000+n)::text,12,'0'))::uuid,'${OWNER}','synthetic-'||n,'image' from generate_series(1,20000)n;
      insert into memory_pages(id,album_id,user_id,story_id,sort_order,created_at)
      select ('00000000-0000-0000-0000-'||lpad((2000000+n)::text,12,'0'))::uuid,'${BOOK}','${OWNER}',
      ('00000000-0000-0000-0000-'||lpad((1000000+n)::text,12,'0'))::uuid,100,'2026-02-01' from generate_series(1,20000)n;
      insert into conversations(id,user_1,user_2,last_message,last_message_time)
      select ('00000000-0000-0000-0000-'||lpad((3000000+n)::text,12,'0'))::uuid,
      case when n<=2000 then '${VIEWER}'::uuid else '${FOREIGN}'::uuid end,'${OWNER}','Synthetic preview',
      '2026-03-01'::timestamptz+n*interval '1 second' from generate_series(1,22000)n;
      insert into messages(id,conversation_id,sender_id,receiver_id,created_at,read_at)
      select ('00000000-0000-0000-0000-'||lpad((4000000+n)::text,12,'0'))::uuid,
      ('00000000-0000-0000-0000-'||lpad((3000000+(n%2000)+1)::text,12,'0'))::uuid,'${OWNER}','${VIEWER}',
      '2026-03-01'::timestamptz+n*interval '1 second',case when (n/2000)%10<>0 then '2026-04-01'::timestamptz end
      from generate_series(1,500000)n;
      analyze memory_pages;analyze stories;analyze conversations;analyze messages;`);
    const pageQuery = `select mp.id from memory_pages mp join stories s on s.id=mp.story_id and s.user_id='${OWNER}'
      where mp.album_id='${BOOK}' and mp.user_id='${OWNER}'
      and (mp.sort_order,mp.created_at,mp.id)>(100,'2026-02-01'::timestamptz,'${id(2018000)}'::uuid)
      order by mp.sort_order,mp.created_at,mp.id limit 41`;
    const selectedIds = Array.from({ length: 50 }, (_, n) => "'" + id(3000001 + n) + "'").join(',');
    const unreadQuery = `select conversation_id,count(*) from messages where receiver_id='${VIEWER}'
      and conversation_id=any(array[${selectedIds}]::uuid[]) and sender_id<>'${VIEWER}'
      and read_at is null and deleted_at is null group by conversation_id`;
    const plan = async query => JSON.parse(await session.query(`explain (analyze,buffers,format json) ${query};`))[0];
    const before = { book: await plan(pageQuery), unread: await plan(unreadQuery) };
    await session.query(migration);
    await session.query('update read_paging.settings set books_ready=true,inbox_ready=true;analyze memory_pages;analyze messages;');
    const after = { book: await plan(pageQuery), unread: await plan(unreadQuery) };
    await session.query(login());
    const start = performance.now();
    const response = await session.query('select public.get_inbox_page_v2(p_limit=>50);');
    const result = JSON.parse(response);
    const report = { runtime: await session.query('select version();'), synthetic: { book_pages: 20083, viewer_conversations: 2128, unrelated_conversations: 20002, messages: 500854 },
      before, after, inbox_rpc: { elapsed_ms: Math.round(performance.now() - start), response_bytes: Buffer.byteLength(response), rows: result.items.length, has_more: result.has_more },
      caveat: 'Local synthetic single-reader query-shape test, not production or mixed-load capacity proof. First-page book metadata remains proportional to book size; inbox candidates to viewer membership count.' };
    if (process.env.PC_TEST_REPORT) fs.writeFileSync(process.env.PC_TEST_REPORT, JSON.stringify(report, null, 2) + '\n');
    const summarize = entry => {
      const nodes = [];
      function walk(node) { nodes.push({ type: node['Node Type'], index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], filtered: node['Rows Removed by Filter'], heap_fetches: node['Heap Fetches'] }); (node.Plans || []).forEach(walk); }
      walk(entry.Plan); return { execution_ms: entry['Execution Time'], nodes };
    };
    console.log(JSON.stringify({ before: { book: summarize(before.book), unread: summarize(before.unread) }, after: { book: summarize(after.book), unread: summarize(after.unread) }, inbox_rpc: report.inbox_rpc }, null, 2));
  } finally { await session.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
