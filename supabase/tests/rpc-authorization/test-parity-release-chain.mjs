import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { extensions, loadLiveSchema } from './live-schema-fixture.mjs';
import { captureMusicState, assertMusicUnchanged } from './non-music-release-assertions.mjs';

// The installed visual release is the baseline. The subsequent candidates are
// kept explicit so an unrelated migration cannot silently enter this check.
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('supabase/ops/production-rollout-20261029.json', root), 'utf8'));
const candidates = [
  '20261022211448_business_publishing_and_receipts',
  '20261022211637_hiring_workflow_quality',
  '20261029080548_marketplace_purchase_reviews',
  '20261022211701_admin_payment_reporting_and_support',
  '20261029074217_home_marketplace_recommendations',
  '20261029074530_story_post_voice_playback',
  '20261029075401_studio_draft_retry_identity',
];
const releaseManifest = JSON.parse(await readFile(new URL('supabase/ops/parity-rollout-20261029.json', root), 'utf8'));
assert.deepEqual(releaseManifest.units.map(unit => unit.name), candidates, 'The verified chain must match the explicit release manifest');
for (const unit of releaseManifest.units) {
  for (const file of unit.files) {
    const sql = await readFile(new URL(file.path, root), 'utf8');
    assert.equal(createHash('sha256').update(sql).digest('hex'), file.sha256, file.path);
    assert.doesNotMatch(sql, /admin_ops\.|triniti_platinum_admin_command|triniti_admin_provision|triniti_admin_deletion_requests|admin_support_triage|moderate_seller_review/i, 'The narrowed release must not recreate excluded admin capabilities');
  }
}
const db = new PGlite({ extensions });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const checks = [];
let phase = 'live schema fixture';
const check = async (name, fn) => { phase = name; await fn(); checks.push(name); };
const as = async (user, sql, args = [], role = 'authenticated', claims = {}) => {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '', role, JSON.stringify({ sub: user, role, aal: 'aal1', ...claims })]);
    const rows = await q(sql, args);
    await db.exec('commit');
    return rows;
  } catch (error) { await db.exec('rollback'); throw error; }
};

try {
  await loadLiveSchema(db);
  await db.exec("alter table auth.users add column if not exists created_at timestamptz default now(); alter table storage.objects add column if not exists version text; alter table storage.objects add column if not exists user_metadata jsonb; grant usage on schema auth to authenticated; insert into storage.buckets(id,name,public) values('chat-media','chat-media',true),('chat-files','chat-files',true),('post-media','post-media',true),('story-media','story-media',true),('media','media',true),('avatars','avatars',true),('market-media','market-media',true);");
  assert.equal(manifest.units.length, 18, 'This test must start from the deployed 18-unit visual release');
  for (const unit of manifest.units) {
    phase = `baseline: ${unit.name}`;
    const sources = [];
    for (const file of unit.files) {
      const sql = await readFile(new URL(file.path, root), 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), file.sha256, file.path);
      sources.push(sql);
    }
    await db.exec(sources.length > 1 ? `begin;\n${sources.join('\n')}\ncommit;` : sources[0]);
  }
  const music = await captureMusicState(db);
  const legacyStudio = await one("select pg_get_functiondef('public.studio_save_post(uuid,text,text,text,uuid,jsonb,jsonb,timestamptz)'::regprocedure) as definition");
  const bucketState = await q('select to_jsonb(b) as bucket from storage.buckets b order by id');
  const existingAdminFunctions = await q("select p.proname name,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'triniti_%' or p.proname like 'admin_%' or p.proname in ('is_admin','admin_role')) order by 1");
  for (const candidate of candidates) {
    phase = `candidate: ${candidate}`;
    await db.exec(await readFile(new URL(`supabase/migrations/${candidate}.sql`, root), 'utf8'));
  }
  await check('the explicit release chain compiles without additional migrations', async () => {
    const required = [
      'public.home_marketplace_recommendations(integer)',
      'public.seller_review_page(uuid,uuid,timestamptz,uuid,integer)',
      'public.submit_seller_review(uuid,uuid,integer,text)',
      'public.report_seller_review(uuid,uuid,text,text)',
      'public.report_market_listing(uuid,uuid,text,text)',
      'public.guard_story_reference_cards()',
      'public.studio_applicant_page(uuid,text,timestamptz,uuid,integer)',
      'public.business_catalog(timestamptz,uuid,integer)',
      'public.admin_payment_summary()',
      'public.studio_save_post_once(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamptz)',
    ];
    for (const signature of required) assert.ok((await one('select to_regprocedure($1) as rpc', [signature])).rpc, signature);
  });
  await check('no admin command, provisioning, destructive moderation or triage layer is installed', async () => {
    assert.equal((await one("select to_regnamespace('admin_ops')::text namespace")).namespace, null);
    for (const name of ['triniti_platinum_admin_command', 'triniti_admin_provision', 'triniti_admin_deletion_requests', 'admin_support_triage_read', 'admin_support_triage_update', 'admin_seller_review_reports', 'moderate_seller_review']) {
      assert.equal((await one("select count(*)::integer n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=$1", [name])).n, 0, name);
    }
    const after = await q("select p.proname name,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'triniti_%' or p.proname like 'admin_%' or p.proname in ('is_admin','admin_role')) and p.proname not in ('admin_payment_report','admin_payment_summary') order by 1");
    assert.deepEqual(after, existingAdminFunctions.filter(row => !['admin_payment_report', 'admin_payment_summary'].includes(row.name)));
  });
  phase = 'synthetic profiles and listings';
  const viewer = randomUUID(), strong = randomUUID(), low = randomUUID(), legacy = randomUUID(), hiddenReview = randomUUID(), verified = randomUUID();
  const user = async (id = randomUUID(), extra = {}) => {
    await q('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
    await q('insert into public.profiles(id,username,full_name,email) values($1,$2,$3,$4) on conflict(id) do update set username=excluded.username,full_name=excluded.full_name', [id, `test_${id.replaceAll('-', '')}`, `Test ${id.slice(0, 8)}`, `${id}@example.test`]);
    for (const [column, value] of Object.entries(extra)) {
      assert.ok(['is_verified', 'deactivated_at', 'restricted_until', 'account_type'].includes(column));
      await q(`update public.profiles set ${column}=$2 where id=$1`, [id, value]);
    }
    return id;
  };
  for (const id of [viewer, strong, low, legacy, hiddenReview]) await user(id);
  await user(verified, { is_verified: true });
  const listing = async (seller, extra = {}) => {
    const fields = { id: randomUUID(), seller_id: seller, title: 'Test listing', price: 25, currency: 'USD', category: 'other', images: ['https://example.test/item.jpg'], status: 'available', stock_quantity: 5, ...extra };
    const names = Object.keys(fields);
    assert.ok(names.every(name => ['id', 'seller_id', 'title', 'price', 'currency', 'category', 'images', 'status', 'stock_quantity', 'hidden_at', 'updated_at'].includes(name)));
    await q(`insert into public.marketplace_listings(${names.join(',')}) values(${names.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(fields));
    return fields.id;
  };
  const strongListings = [await listing(strong), await listing(strong), await listing(strong)];
  const lowListing = await listing(low), legacyListing = await listing(legacy), hiddenReviewListing = await listing(hiddenReview);
  await listing(verified);
  for (let i = 0; i < 7; i++) await listing(await user());
  const excluded = [];
  excluded.push(await listing(viewer));
  excluded.push(await listing(low, { stock_quantity: 0 }));
  excluded.push(await listing(low, { hidden_at: new Date().toISOString() }));
  excluded.push(await listing(low, { status: 'sold' }));
  excluded.push(await listing(low, { images: [] }));
  excluded.push(await listing(low, { images: ['http://example.test/insecure.jpg'] }));
  for (const key of ['deactivated_at', 'restricted_until']) {
    excluded.push(await listing(await user(undefined, { [key]: new Date(Date.now() + 86400000).toISOString() })));
  }
  for (const reverse of [false, true]) {
    const blocked = await user();
    await q('insert into public.blocked_users(blocker_id,blocked_id) values($1,$2)', reverse ? [blocked, viewer] : [viewer, blocked]);
    excluded.push(await listing(blocked));
  }
  const muted = await user();
  await q('insert into public.muted_authors(user_id,author_id) values($1,$2)', [viewer, muted]);
  excluded.push(await listing(muted));
  const completedOrder = async (seller, item) => {
    const order = randomUUID();
    await q("insert into marketplace_ops.orders(id,request_key,buyer_id,seller_id,listing_id,title,quantity,unit_minor,delivery_minor,total_minor,currency,fulfilment,status,reservation,completed_at) values($1,$2,$3,$4,$5,'Test purchase',1,2500,0,2500,'USD','pickup','completed','committed',now())", [order, randomUUID(), viewer, seller, item]);
    return order;
  };
  for (let i = 0; i < 6; i++) {
    const order = await completedOrder(strong, strongListings[0]);
    await as(viewer, 'select public.submit_seller_review($1,$2,5,$3)', [viewer, order, 'Verified completed purchase']);
  }
  await as(viewer, 'select public.submit_seller_review($1,$2,1,$3)', [viewer, await completedOrder(low, lowListing), 'Verified completed purchase']);
  const hiddenOrder = await completedOrder(hiddenReview, hiddenReviewListing);
  const hiddenId = (await as(viewer, 'select public.submit_seller_review($1,$2,5,$3) as id', [viewer, hiddenOrder, 'Moderated purchase review']))[0].id;
  await q("update public.seller_reviews set moderation_status='hidden' where id=$1", [hiddenId]);
  // Legacy testimonials are deliberately not verified purchases.
  for (let i = 0; i < 20; i++) await q('insert into public.seller_reviews(seller_id,reviewer_id,listing_id,rating) values($1,$2,$3,5)', [legacy, viewer, legacyListing]);
  await check('purchase reviews and caller-bound reports work without staff command dependencies', async () => {
    const review = await one('select id,order_id from public.seller_reviews where seller_id=$1 and order_id is not null limit 1', [strong]);
    const report = async () => (await as(low, "select public.report_seller_review($1,$2,'other','Please review this rating') as id", [low, review.id]))[0].id;
    const first = await report(); assert.equal(await report(), first);
    const listingReport = async () => (await as(low, "select public.report_market_listing($1,$2,'other','Please review this listing') as id", [low, strongListings[0]]))[0].id;
    assert.equal(await listingReport(), await listingReport());
    await assert.rejects(() => as(low, "select public.report_seller_review($1,$2,'other','Account mismatch')", [viewer, review.id]), /ACCOUNT_CHANGED/);
    await assert.rejects(() => as(viewer, "select public.report_seller_review($1,$2,'other','Own review')", [viewer, review.id]), /REVIEW_UNAVAILABLE/);
    await assert.rejects(() => as(low, "select public.submit_seller_review($1,$2,5,'Not my order')", [low, review.order_id]), /COMPLETED_PURCHASE_REQUIRED/);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(() => as(low, 'select * from public.seller_review_reports', [], role), /permission denied/);
    }
  });
  const recommendations = async (limit = 12) => as(viewer, 'select * from public.home_marketplace_recommendations($1)', [limit]);
  await check('verified completed-purchase reputation outranks unverified legacy reviews and new sellers', async () => {
    const rows = await recommendations();
    assert.equal(rows[0].seller_id, strong); assert.equal(rows[1].seller_id, strong);
    assert.equal(rows[0].review_count, 6); assert.equal(Number(rows[0].rating), 5); assert.equal(rows[0].completed_sales, 6);
    const legacyRows = await as(viewer, 'select * from public.home_marketplace_recommendations(12) where seller_id=$1', [legacy]);
    assert.equal(legacyRows[0].review_count, 0); assert.equal(legacyRows[0].rating, null);
    const page = (await as(viewer, 'select public.seller_review_page($1) as data', [hiddenReview]))[0].data;
    assert.equal(page.summary.review_count, 0);
    const hiddenRows = rows.filter(row => row.seller_id === hiddenReview);
    assert.ok(hiddenRows.every(row => row.review_count === 0 && row.rating === null));
  });
  await check('market recommendations exclude unavailable, hidden, unsafe, own, muted, and either blocked seller direction', async () => {
    const rows = await recommendations();
    assert.ok(rows.length > 0);
    assert.equal(rows.some(row => excluded.includes(row.id)), false);
    assert.equal(rows.filter(row => row.seller_id === strong).length, 2);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.equal(rows.length, 12); assert.equal((await recommendations(100)).length, 12);
    assert.equal((await recommendations(0)).length, 1); assert.equal((await recommendations(null)).length, 8);
    await assert.rejects(() => as(null, 'select * from public.home_marketplace_recommendations(8)', [], 'anon'), /permission denied/);
    await assert.rejects(() => as(null, 'select * from public.home_marketplace_recommendations(8)'), /AUTH_REQUIRED/);
  });
  await check('home feed excludes market cards before cursor pagination while preserving ordinary posts and job cards', async () => {
    const normal = [], excludedPosts = [];
    const post = async content => (await one("insert into public.posts(user_id,content,audience,created_at) values($1,$2,'everyone',now()-interval '2 hours') returning id", [strong, content])).id;
    for (let i = 0; i < 7; i++) normal.push(await post(`Ordinary post ${i}`));
    const jobPost = await post('Job card remains in feed'); normal.push(jobPost);
    await q("insert into public.post_products(post_id,sort_order,title,link_url) values($1,0,'Job','/jobs/'||$2::text)", [jobPost, randomUUID()]);
    const marketPost = await post('Market listing post'); excludedPosts.push(marketPost);
    await q("insert into public.post_products(post_id,sort_order,title,listing_id) values($1,0,'Listing',$2)", [marketPost, strongListings[0]]);
    const legacyPost = await post('Legacy market link'); excludedPosts.push(legacyPost);
    await q("insert into public.post_products(post_id,sort_order,title,link_url) values($1,0,'Listing','/market/'||$2::text||'?from=feed')", [legacyPost, legacyListing]);
    let cursor = null; const seen = [];
    for (let page = 0; page < 6; page++) {
      const rows = await as(viewer, 'select * from public.get_feed($1,$2,$3,3)', ['recent', cursor?.sort_key ?? null, cursor?.post_id ?? null]);
      if (!rows.length) break;
      seen.push(...rows.map(row => row.post_id)); cursor = rows.at(-1);
    }
    assert.equal(new Set(seen).size, seen.length, 'Paging must not duplicate rows');
    assert.deepEqual(new Set(seen), new Set(normal));
    assert.equal(seen.some(id => excludedPosts.includes(id)), false);
  });
  await check('business, hiring, review and staff read RPCs execute against the complete release schema', async () => {
    const catalog = (await as(strong, 'select public.business_catalog() as data'))[0].data;
    assert.equal(catalog.rows.length, 3);
    assert.equal((await as(strong, 'select public.business_receipts() as data'))[0].data.rows.length, 0);
    assert.equal((await as(strong, 'select public.promo_daily_performance($1) as data', [strong]))[0].data.length, 30);
    const job = (await one("insert into public.jobs(posted_by,title,company,description) values($1,'Test role','Test employer','Test description') returning id", [strong])).id;
    const applicants = (await as(strong, 'select public.studio_applicant_page($1) as data', [job]))[0].data;
    assert.equal(applicants.applications.length, 0); assert.equal(applicants.counts.all, 0);
    await assert.rejects(() => as(viewer, 'select public.studio_applicant_page($1)', [job]), /Only the job owner/);
    const before = await q('select to_jsonb(p) as payment from public.chat_payments p order by id');
    assert.equal((await as(null, 'select public.admin_payment_report() as data', [], 'service_role'))[0].data.rows.length, 0);
    assert.equal((await as(null, 'select public.admin_payment_summary() as data', [], 'service_role'))[0].data.completed_week, 0);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(() => as(viewer, 'select public.admin_payment_report()', [], role), /permission denied/);
      await assert.rejects(() => as(viewer, 'select public.admin_payment_summary()', [], role), /permission denied/);
    }
    assert.deepEqual(await q('select to_jsonb(p) as payment from public.chat_payments p order by id'), before);
  });
  await check('Studio new-draft retries preserve identity and recheck account, role, payload and deleted drafts', async () => {
    assert.deepEqual(await one("select pg_get_functiondef('public.studio_save_post(uuid,text,text,text,uuid,jsonb,jsonb,timestamptz)'::regprocedure) as definition"), legacyStudio);
    const business = await user(undefined, { account_type: 'business' }), member = randomUUID(), studioSession = randomUUID(), key = randomUUID();
    await q("insert into public.business_access_members(id,business_id,display_name,role,code_hash) values($1,$2,'Editor','editor','synthetic-placeholder')", [member, business]);
    await q('insert into public.studio_session_members(session_id,business_id,member_id) values($1,$2,$3)', [studioSession, business, member]);
    const save = (request = key, content = 'Review before publishing', actor = business, expected = actor, role = 'authenticated') => as(actor, 'select public.studio_save_post_once($1,$2,$3) as id', [expected, request, content], role, { session_id: studioSession });
    const saved = (await save())[0].id;
    assert.equal((await save())[0].id, saved);
    assert.equal((await one('select count(*)::int as n from public.studio_scheduled_posts where owner_id=$1', [business])).n, 1);
    assert.equal((await one('select count(*)::int as n from marketplace_ops.studio_draft_requests where actor_id=$1', [business])).n, 1);
    await assert.rejects(() => save(key, 'Changed payload'), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(() => save(key, 'Review before publishing', business, viewer), /ACCOUNT_CHANGED/);
    await assert.rejects(() => save(key, 'Review before publishing', null, business), /AUTH_REQUIRED/);
    await assert.rejects(() => save(key, 'Review before publishing', null, business, 'anon'), /permission denied/);
    await assert.rejects(() => as(business, 'select * from marketplace_ops.studio_draft_requests'), /permission denied/);
    await q("update public.business_access_members set role='recruiter' where id=$1", [member]);
    await assert.rejects(() => save(), /cannot do this/);
    await q("update public.business_access_members set role='editor' where id=$1", [member]);
    const otherDraft = (await save(key, 'Different account draft', viewer))[0].id;
    assert.notEqual(otherDraft, saved); assert.equal((await one('select owner_id from public.studio_scheduled_posts where id=$1', [otherDraft])).owner_id, viewer);
    const invalidKey = randomUUID(); await assert.rejects(() => save(invalidKey, ''), /needs text or media/);
    assert.equal((await one('select count(*)::int as n from marketplace_ops.studio_draft_requests where request_key=$1', [invalidKey])).n, 0);
    await q('delete from public.studio_scheduled_posts where id=$1', [saved]);
    await assert.rejects(() => save(), /SAVED_DRAFT_REMOVED/);
    assert.equal((await one('select count(*)::int as n from public.studio_scheduled_posts where owner_id=$1', [business])).n, 0);
  });
  await check('music catalogue, permissions, and storage bucket configuration remain unchanged', async () => {
    await assertMusicUnchanged(db, music);
    assert.deepEqual(await q('select to_jsonb(b) as bucket from storage.buckets b order by id'), bucketState);
  });
  console.log(JSON.stringify({ ok: true, baselineUnits: manifest.units.length, candidateUnits: candidates.length, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, phase, message: error.message, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
