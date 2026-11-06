import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { source } from './deployed-media-baseline.mjs';

test('the staff catalog walks all tied rows and scopes complete report counts to each listing', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create table public.marketplace_listings(id uuid primary key, created_at timestamptz, title text);
    create table public.listing_reports(id uuid primary key,listing_id uuid,created_at timestamptz,status text,reason text);
    grant select on public.marketplace_listings,public.listing_reports to service_role;
    insert into public.marketplace_listings
      select lpad(to_hex(n),32,'0')::uuid, timestamptz '2026-11-01 00:00:00.123456+00', case when n=1 then '100% collectible' else 'Item '||n end from generate_series(1,251)n;
    insert into public.listing_reports select gen_random_uuid(),lpad('1',32,'0')::uuid,now(),case when n%2=0 then 'closed' else 'open' end,'reason-'||n from generate_series(1,1005)n;`);
  await db.exec(await source('supabase/migrations/20261106221400_admin_market_catalog_page.sql'));
  const read = async (date=null,id=null,q='') => (await db.query('select * from public.admin_market_catalog_page_v1($1,$2,$3)',[date,id,q])).rows.map(r=>r.admin_market_catalog_page_v1);
  await db.exec('set role service_role');
  let cursor=null;const all=[];
  for (;;) {
   const page=await read(cursor?.created_at,cursor?.id);
   const rows=page.slice(0,100);all.push(...rows);cursor=rows.at(-1);
   if(page.length<=100)break;
  }
  assert.equal(all.length,251);assert.equal(new Set(all.map(r=>r.id)).size,251);
  const [target]=await read(null,null,'100%'); assert.equal(target.id,all.at(-1).id);
  assert.equal(target._report_summary.total,1005);assert.equal(target._report_summary.open,503);
  assert.equal(target._report_summary.reasons.length,3);
  assert.equal((await read(null,null,target.id)).length,1);
  await assert.rejects(read(null,null,'ab'),/INVALID_MARKET_CATALOG_QUERY/);
  for(const role of ['anon','authenticated']){
   await db.exec('reset role; set role '+role);await assert.rejects(read(),/permission denied/);
  }
 } finally { await db.close(); }
});
