const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(
  process.env.PGLITE_MODULE ||
    "./rpc-authorization/node_modules/@electric-sql/pglite",
);
const B = "10000000-0000-4000-8000-000000000001",
  S = "10000000-0000-4000-8000-000000000002",
  X = "10000000-0000-4000-8000-000000000003",
  A = "10000000-0000-4000-8000-000000000004";
const L = "20000000-0000-4000-8000-000000000001",
  O = "30000000-0000-4000-8000-000000000001",
  SESSION = "40000000-0000-4000-8000-000000000001",
  KEY = "50000000-0000-4000-8000-000000000001";
let db;
async function as(uid, sql, args = [], role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      uid || "",
    ]);
    const r = await db.query(sql, args);
    await db.exec("commit");
    return Object.values(r.rows[0] || {})[0];
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const submit = (user = B, order = O, rating = 5, comment = "Excellent") =>
  as(user, "select submit_seller_review($1,$2,$3,$4)", [
    user,
    order,
    rating,
    comment,
  ]);
const page = (user = B, cursor) =>
  as(user, "select seller_review_page($1,null,$2,$3,$4)", [
    S,
    cursor?.created_at || null,
    cursor?.id || null,
    2,
  ]);
const report = (id, user = X) =>
  as(user, "select report_seller_review($1,$2,$3,$4)", [
    user,
    id,
    "harassment",
    "Abusive language",
  ]);
const moderate = (
  id,
  action = "hide",
  key = KEY,
  actor = A,
  session = SESSION,
) =>
  as(
    null,
    "select moderate_seller_review($1,$2,$3,$4,$5,$6,1)",
    [actor, session, key, id, action, "Reviewed evidence"],
    "service_role",
  );
test.beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;
 create table profiles(id uuid primary key,full_name text,avatar_url text);insert into profiles(id,full_name) values('${B}','Real buyer'),('${S}','Seller'),('${X}','Another member'),('${A}','Moderator');
 create table marketplace_listings(id uuid primary key,seller_id uuid,title text,status text);insert into marketplace_listings values('${L}','${S}','Test item','available');
 create schema marketplace_ops;create table marketplace_ops.orders(id uuid primary key,buyer_id uuid,seller_id uuid,listing_id uuid,title text,completed_at timestamptz,reservation text);insert into marketplace_ops.orders values('${O}','${B}','${S}','${L}','Test item',now(),'committed');
 create table seller_reviews(id uuid primary key default gen_random_uuid(),seller_id uuid,reviewer_id uuid,listing_id uuid,rating int check(rating between 1 and 5),comment text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint seller_reviews_seller_id_reviewer_id_listing_id_key unique(seller_id,reviewer_id,listing_id));
 alter table seller_reviews enable row level security;create policy seller_reviews_read on seller_reviews for select using(auth.uid() is not null);create policy seller_reviews_write on seller_reviews for all using(reviewer_id=auth.uid()) with check(reviewer_id=auth.uid());grant all on seller_reviews to anon,authenticated,service_role;
 create table listing_reports(id uuid primary key default gen_random_uuid(),listing_id uuid,reporter_id uuid,reason text,detail text,status text default 'open',unique(listing_id,reporter_id));grant all on listing_reports to authenticated,service_role;
 create schema admin_ops;create table admin_ops.commands(command_key uuid primary key,actor_id uuid,operation text,payload jsonb,result jsonb);
 create table admin_audit_log(id uuid primary key default gen_random_uuid(),admin_id uuid,action text,target_kind text,target_id text,reason text,before jsonb,after jsonb);
 -- Boundary stand-in: the production require_session owns staff, expiry and MFA policy.
 create function admin_ops.require_session(p_actor_id uuid,p_session_id uuid,p_permission text) returns void language plpgsql as $$begin if p_actor_id<>'${A}' or p_session_id<>'${SESSION}' or p_permission<>'report_listing' or p_actor_id is null or p_session_id is null then raise exception 'STAFF_SESSION_REQUIRED';end if;end$$;
 `);
  await db.exec(
    fs.readFileSync(
      path.join(
        __dirname,
        "../migrations/20261025073211_marketplace_verified_reviews.sql",
      ),
      "utf8",
    ),
  );
});
test.afterEach(async () => db.close());
test("reviews require the authenticated completed buyer; direct writes and impersonation are denied", async () => {
  await assert.rejects(
    () => as(null, "select seller_review_page($1)", [S], "anon"),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      as(
        B,
        "insert into seller_reviews(seller_id,reviewer_id,rating) values($1,$2,5)",
        [S, B],
      ),
    /permission denied/,
  );
  await assert.rejects(
    () => as(B, "select submit_seller_review($1,$2,5)", [X, O]),
    /ACCOUNT_CHANGED/,
  );
  await assert.rejects(() => submit(X), /COMPLETED_PURCHASE_REQUIRED/);
  await db.exec("update marketplace_ops.orders set completed_at=null");
  await assert.rejects(() => submit(), /COMPLETED_PURCHASE_REQUIRED/);
  await db.exec(
    "update marketplace_ops.orders set completed_at=now(),reservation='reserved'",
  );
  await assert.rejects(() => submit(), /COMPLETED_PURCHASE_REQUIRED/);
  await db.exec(
    `update marketplace_ops.orders set reservation='committed',seller_id='${B}'`,
  );
  await assert.rejects(() => submit(), /COMPLETED_PURCHASE_REQUIRED/);
});
test("the order fixes buyer/seller/listing identity and retries update one review, with bounded input", async () => {
  const id = await submit();
  assert.equal(await submit(B, O, 4, "Updated"), id);
  const row = (await db.query("select * from seller_reviews")).rows[0];
  assert.equal(row.seller_id, S);
  assert.equal(row.reviewer_id, B);
  assert.equal(row.listing_id, L);
  assert.equal(row.order_id, O);
  assert.equal(row.rating, 4);
  assert.equal(
    (await db.query("select count(*)::int n from seller_reviews")).rows[0].n,
    1,
  );
  await assert.rejects(() => submit(B, O, 0), /INVALID_REVIEW/);
  await assert.rejects(() => submit(B, O, 6), /INVALID_REVIEW/);
  await assert.rejects(
    () => submit(B, O, 5, "x".repeat(2001)),
    /INVALID_REVIEW/,
  );
});
test("verified pages join public profiles directly and exclude legacy unbound ratings", async () => {
  await db.exec(
    `insert into seller_reviews(seller_id,reviewer_id,rating) values('${S}','${X}',1)`,
  );
  const id = await submit();
  const p = await page();
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].id, id);
  assert.equal(p.rows[0].reviewer.full_name, "Real buyer");
  assert.equal(p.summary.review_count, 1);
  assert.equal(p.summary.avg_rating, 5);
  assert.equal(p.eligible_orders[0].id, O);
  assert.equal((await page(X)).eligible_orders.length, 0);
  assert.equal(await as(B, "select count(*)::int from seller_reviews"), 1);
  assert.equal(
    await as(B, "select review_count from get_seller_rating($1)", [S]),
    1,
  );
});
test("stable cursor pagination does not skip equal-timestamp reviews and does not expose orders to other users", async () => {
  for (let i = 1; i <= 5; i++) {
    const o = `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (i > 1)
      await db.query(
        "insert into marketplace_ops.orders select $1,buyer_id,seller_id,listing_id,title,completed_at,reservation from marketplace_ops.orders where id=$2",
        [o, O],
      );
    await submit(B, o);
  }
  await db.exec("update seller_reviews set created_at='2026-10-01T00:00:00Z'");
  const a = await page(X),
    b = await page(X, a.next_cursor),
    c = await page(X, b.next_cursor);
  assert.equal(a.rows.length, 2);
  assert.equal(b.rows.length, 2);
  assert.equal(c.rows.length, 1);
  assert.equal(c.has_more, false);
  assert.equal(
    new Set([...a.rows, ...b.rows, ...c.rows].map((x) => x.id)).size,
    5,
  );
  assert.deepEqual(a.eligible_orders, []);
  await assert.rejects(
    () => as(B, "select seller_review_page($1,null,now(),null)", [S]),
    /INVALID_CURSOR/,
  );
});
test("review reports are private, actor-bound, reject self-reporting and cannot reset a resolved outcome", async () => {
  const review = await submit();
  await assert.rejects(() => report(review, B), /REVIEW_UNAVAILABLE/);
  const id = await report(review);
  assert.equal(await report(review), id);
  await assert.rejects(
    () => as(X, "select * from seller_review_reports"),
    /permission denied/,
  );
  await assert.rejects(
    () => as(X, "select report_seller_review($1,$2,$3)", [S, review, "fake"]),
    /ACCOUNT_CHANGED/,
  );
  await moderate(id, "dismiss");
  assert.equal(await report(review), id);
  assert.equal(
    (await db.query("select status from seller_review_reports")).rows[0].status,
    "dismissed",
  );
});
test("moderation requires the shared staff session boundary; hide and restore update visibility, aggregates and audit atomically", async () => {
  const review = await submit(),
    id = await report(review);
  await assert.rejects(
    () =>
      as(X, "select moderate_seller_review($1,$2,$3,$4,$5,$6,1)", [
        A,
        SESSION,
        KEY,
        id,
        "hide",
        "Valid reason",
      ]),
    /permission denied/,
  );
  await assert.rejects(
    () => moderate(id, "hide", KEY, X),
    /STAFF_SESSION_REQUIRED/,
  );
  await assert.rejects(
    () => moderate(id, "hide", KEY, A, KEY),
    /STAFF_SESSION_REQUIRED/,
  );
  const result = await moderate(id);
  assert.equal(result.success, true);
  assert.deepEqual(await moderate(id), result);
  assert.equal((await page()).rows.length, 0);
  assert.equal((await page()).summary.review_count, 0);
  assert.equal(await as(B, "select count(*)::int from seller_reviews"), 0);
  await assert.rejects(() => submit(), /REVIEW_UNDER_MODERATION/);
  assert.equal(
    (await db.query("select count(*)::int n from admin_audit_log")).rows[0].n,
    1,
  );
  await assert.rejects(() => moderate(id, "restore"), /COMMAND_KEY_REUSED/);
  await moderate(id, "restore", "50000000-0000-4000-8000-000000000002");
  assert.equal((await page()).rows.length, 1);
  assert.equal(
    (await db.query("select count(*)::int n from admin_audit_log")).rows[0].n,
    2,
  );
});
test("staff reports list uses the same permission boundary and customer cannot invoke it", async () => {
  const review = await submit(),
    id = await report(review);
  const p = await as(
    null,
    "select admin_seller_review_reports($1,$2)",
    [A, SESSION],
    "service_role",
  );
  assert.equal(p.rows[0].id, id);
  assert.equal(p.rows[0].order_id, O);
  await assert.rejects(
    () => as(X, "select admin_seller_review_reports($1,$2)", [A, SESSION]),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      as(
        null,
        "select admin_seller_review_reports($1,$2)",
        [X, SESSION],
        "service_role",
      ),
    /STAFF_SESSION_REQUIRED/,
  );
});
test("listing reports cannot spoof identity, report own items, exceed bounds or rewrite staff status", async () => {
  const args = [B, L, "scam", "Potential fraud"];
  const id = await as(B, "select report_market_listing($1,$2,$3,$4)", args);
  await db.query("update listing_reports set status='resolved' where id=$1", [
    id,
  ]);
  assert.equal(
    await as(B, "select report_market_listing($1,$2,$3,$4)", args),
    id,
  );
  assert.equal(
    (await db.query("select status from listing_reports")).rows[0].status,
    "resolved",
  );
  await assert.rejects(
    () => as(B, "update listing_reports set status='open'"),
    /permission denied/,
  );
  await assert.rejects(
    () => as(S, "select report_market_listing($1,$2,$3)", [S, L, "scam"]),
    /LISTING_UNAVAILABLE/,
  );
  await assert.rejects(
    () => as(B, "select report_market_listing($1,$2,$3)", [X, L, "scam"]),
    /ACCOUNT_CHANGED/,
  );
  await assert.rejects(
    () =>
      as(B, "select report_market_listing($1,$2,$3,$4)", [
        B,
        L,
        "scam",
        "a".repeat(1001),
      ]),
    /INVALID_REPORT/,
  );
});

test("deleting a reporter, reviewed content or moderator retains resolvable reports without blocking erasure", async () => {
  const review = await submit(),
    id = await report(review);
  await db.query("delete from profiles where id=$1", [X]);
  let row = (
    await db.query("select * from seller_review_reports where id=$1", [id])
  ).rows[0];
  assert.equal(row.reporter_id, null);
  assert.equal(row.detail, "Abusive language");
  await db.query("delete from seller_reviews where id=$1", [review]);
  const queue = await as(
    null,
    "select admin_seller_review_reports($1,$2)",
    [A, SESSION],
    "service_role",
  );
  assert.equal(queue.rows[0].review_id, null);
  assert.equal(queue.rows[0].id, id);
  await assert.rejects(() => moderate(id), /REVIEW_UNAVAILABLE/);
  await moderate(id, "dismiss");
  await db.query("delete from profiles where id=$1", [A]);
  row = (
    await db.query("select * from seller_review_reports where id=$1", [id])
  ).rows[0];
  assert.equal(row.resolved_by, null);
  assert.equal(row.status, "dismissed");
  const audit = (await db.query("select * from admin_audit_log")).rows[0];
  assert.equal(audit.target_id, id);
  assert.equal(audit.before.report.status, "open");
  assert.equal(audit.after.report.status, "dismissed");
});

test("edits permit a new report but retries do not; moderation rejects a review changed since staff loaded it", async () => {
  const review = await submit(),
    first = await report(review);
  await moderate(first, "dismiss");
  await submit(B, O, 5, "Changed review");
  const second = await report(review);
  assert.notEqual(second, first);
  await submit(B, O, 5, "Changed review");
  assert.equal(await report(review), second);
  assert.equal(
    (await db.query("select content_version from seller_reviews")).rows[0]
      .content_version,
    2,
  );
  await assert.rejects(
    () => moderate(second, "hide", "50000000-0000-4000-8000-000000000002"),
    /REVIEW_CHANGED_REFRESH/,
  );
  const result = await as(
    null,
    "select moderate_seller_review($1,$2,$3,$4,$5,$6,2)",
    [
      A,
      SESSION,
      "50000000-0000-4000-8000-000000000002",
      second,
      "hide",
      "Reviewed updated content",
    ],
    "service_role",
  );
  assert.equal(result.success, true);
});
