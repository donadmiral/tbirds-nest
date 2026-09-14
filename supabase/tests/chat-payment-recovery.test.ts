import test from "node:test";
import assert from "node:assert/strict";
import { createBridgeHandler } from "../functions/crisp-bridge/handler.ts";
import { createRecoveryHandler } from "../functions/crisp-payment-recovery/handler.ts";

const sender = "11111111-1111-4111-8111-111111111111";
const recipient = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const conversation = "44444444-4444-4444-8444-444444444444";
const serviceKey = "local-test-service-key-no-real-credentials";
const body = { recipient_id: recipient, conversation_id: conversation, amount: 12.5, currency: "USD", idempotency_key: "intent-12345678", note: null };

// This models PostgREST responses and uniqueness, not bank execution. No network.
function makeDb() {
  const payments: any[] = [];
  const controls = { failRead: false, failInsert: false, failComplete: false, zeroComplete: false, queries: 0, receipts: 0 };
  class Query {
    table: string; verb = "select"; payload: any; filters: ((r: any) => boolean)[] = []; count = Infinity; orders: any[] = [];
    constructor(table: string) { this.table = table; }
    select(_fields: string) { return this; }
    insert(value: any) { this.verb = "insert"; this.payload = value; return this; }
    update(value: any) { this.verb = "update"; this.payload = value; return this; }
    eq(key: string, value: any) { this.filters.push(row => row[key] === value); return this; }
    lte(key: string, value: any) { this.filters.push(row => row[key] <= value); return this; }
    or(value: string) {
      if (value.startsWith("last_status_check_at")) {
        const cutoff = value.split(".lte.")[1];
        this.filters.push(row => row.last_status_check_at == null || row.last_status_check_at <= cutoff);
      } else this.filters.push(row => [row.user_1, row.user_2].includes(recipient));
      return this;
    }
    limit(value: number) { this.count = value; return this; }
    order(key: string, options: any) { this.orders.push([key, options]); return this; }
    single() { return this.run(true); }
    maybeSingle() { return this.run(true); }
    then(resolve: any, reject: any) { return this.run(false).then(resolve, reject); }
    async run(single: boolean) {
      controls.queries++;
      if (controls.failRead && this.verb === "select" && this.table === "chat_payments") return { data: null, error: { code: "OFFLINE" } };
      let rows = this.table === "chat_payments" ? payments : [{ id: conversation, user_1: sender, user_2: recipient }];
      if (this.verb === "insert") {
        if (controls.failInsert) return { data: null, error: { code: "OFFLINE" } };
        if (payments.some(row => row.sender_id === this.payload.sender_id && row.idempotency_key === this.payload.idempotency_key)) return { data: null, error: { code: "23505" } };
        const row = { ...this.payload, id: crypto.randomUUID(), tx_id: null, error: null, created_at: "2026-01-01T00:00:00.000Z", last_status_check_at: null };
        payments.push(row);
        return { data: structuredClone(row), error: null };
      }
      rows = rows.filter(row => this.filters.every(predicate => predicate(row)));
      for (const [key, options] of this.orders.toReversed()) rows.sort((a, b) => a[key] == null ? (b[key] == null ? 0 : -1) : b[key] == null ? 1 : String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1));
      rows = rows.slice(0, this.count);
      if (this.verb === "update") {
        if (this.payload.status === "completed" && controls.failComplete) return { data: null, error: { code: "RECEIPT_WRITE_FAILED" } };
        if (this.payload.status === "completed" && controls.zeroComplete) return { data: null, error: null };
        for (const row of rows) {
          if (row.status === "pending" && this.payload.status === "completed") controls.receipts++;
          Object.assign(row, this.payload);
        }
      }
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
  }
  return {
    payments, controls,
    auth: { getUser: async (token: string) => ({ data: { user: token === "user-token" ? { id: sender } : token === "stranger-token" ? { id: stranger } : null }, error: null }) },
    from: (table: string) => new Query(table),
  };
}
function canonical(url: URL, init: any, extra: any = {}) {
  const input = init.method === "POST" ? JSON.parse(init.body) : null;
  return Response.json({ success: true, status: "completed",
    tx_id: "55555555-5555-4555-8555-555555555555",
    partner_reference: input?.partner_reference || url.searchParams.get("partner_reference"),
    amount: input?.amount ?? 12.5, currency: input?.currency ?? "USD", ...extra });
}
function setup(fetcher: any = canonical) {
  const db = makeDb();
  const calls: any[] = [];
  const deps = { db, crispUrl: "http://localhost/crisp-api", crispKey: "local-sandbox-key", serviceKey,
    now: () => new Date("2026-09-10T12:00:00.000Z"),
    fetcher: async (...args: any[]) => { calls.push(args); return fetcher(...args); } };
  return { db, calls, deps, handler: createBridgeHandler(deps), worker: createRecoveryHandler(deps) };
}
function request(action: string, input?: any, token = "user-token") {
  return new Request(`http://localhost/crisp-bridge?action=${action}`, {
    method: input === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
}
function pending(db: any, overrides: any = {}) {
  const row = { ...body, sender_id: sender, listing_id: null, id: crypto.randomUUID(), status: "pending", tx_id: null, error: null, created_at: "2026-01-01T00:00:00.000Z", last_status_check_at: null, ...overrides };
  db.payments.push(row); return row;
}

test("sender identity comes from verified JWT", async () => {
  const { handler, calls } = setup();
  const response = await handler(request("pay", { ...body, sender_id: stranger }));
  assert.equal((await response.json()).status, "completed");
  assert.equal(JSON.parse(calls[0][1].body).sender_external_id, sender);
});
test("anonymous user cannot read status or initiate a payment", async () => {
  const { handler, calls, db } = setup();
  assert.equal((await handler(request("pay", body, "bad"))).status, 401);
  assert.equal(calls.length, 0); assert.equal(db.controls.queries, 0);
});
test("old email OTP and password-link actions clearly reject without forwarding credentials", async () => {
  const { handler, calls } = setup();
  for (const action of ["otp-send", "otp-verify", "link-signin"]) {
    const response = await handler(request(action, { email: "synthetic@example.invalid", password: "unused" }));
    assert.equal(response.status, 410); assert.equal((await response.json()).code, "IN_APP_LINK_APPROVAL_REQUIRED");
  }
  assert.equal(calls.length, 0);
});
test("approval code redemption preserves verified external identity", async () => {
  const { handler, calls } = setup();
  await handler(request("link", { code: " abc123de ", external_user_id: stranger }));
  assert.deepEqual(JSON.parse(calls[0][1].body), { code: "ABC123DE", external_user_id: sender });
});
test("money precision and conversation membership are enforced before any provider call", async () => {
  const { handler, calls } = setup();
  for (const amount of [0, -1, 0.001, 100001, "NaN", null]) assert.equal((await handler(request("pay", { ...body, amount }))).status, 400);
  assert.equal((await handler(request("pay", { ...body, recipient_id: stranger }))).status, 403);
  assert.equal(calls.length, 0);
});
test("completion is persisted and a replay never resends", async () => {
  const { handler, calls, db } = setup();
  assert.equal((await (await handler(request("pay", body))).json()).status, "completed");
  const replay = await (await handler(request("pay", body))).json();
  assert.equal(replay.status, "completed"); assert.equal(replay.idempotent, true);
  assert.equal(calls.length, 1); assert.equal(db.controls.receipts, 1);
});
test("same key with changed amount, currency, recipient, note or listing is rejected", async () => {
  const { handler, calls } = setup(); await handler(request("pay", body));
  for (const change of [{ amount: 20 }, { currency: "ZWG" }, { note: "changed" }, { listing_id: stranger }]) {
    const response = await handler(request("pay", { ...body, ...change }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "IDEMPOTENCY_CONFLICT");
  }
  assert.equal(calls.length, 1);
});
test("concurrent requests sharing an intent send to Crisp once", async () => {
  const { handler, calls } = setup(async (url: URL, init: any) => init.method === "GET" ? Response.json({ success: true, status: "not_found" }) : canonical(url, init));
  await Promise.all([handler(request("pay", body)), handler(request("pay", body))]);
  assert.equal(calls.filter(call => call[1].method === "POST").length, 1);
});
test("database lookup and insert errors cannot trigger an untracked payment", async () => {
  for (const field of ["failRead", "failInsert"] as const) {
    const { handler, calls, db } = setup(); db.controls[field] = true;
    assert.equal((await handler(request("pay", body))).status, 503); assert.equal(calls.length, 0);
  }
});
test("lost success response stays pending and canonical GET recovers once", async () => {
  const { handler, calls, db } = setup(async (_url: URL, init: any) => {
    if (init.method === "POST") throw new Error("Response lost after provider commit");
    return canonical(_url, init);
  });
  const initial = await handler(request("pay", body));
  assert.equal(initial.status, 202); assert.equal((await initial.json()).status, "pending");
  const status = await handler(request(`payment-status&idempotency_key=${body.idempotency_key}`));
  assert.equal((await status.json()).status, "completed"); assert.equal(db.controls.receipts, 1);
  await handler(request(`payment-status&idempotency_key=${body.idempotency_key}`));
  assert.equal(calls.filter(call => call[1].method === "POST").length, 1); assert.equal(calls.length, 2);
});
test("5xx, invalid JSON and ambiguous rejection remain pending", async () => {
  for (const response of [() => Response.json({ success: false, error: "unknown" }, { status: 503 }), () => new Response("bad json"), () => Response.json({ success: false }, { status: 400 })]) {
    const { handler, db } = setup(response);
    assert.equal((await (await handler(request("pay", body))).json()).status, "pending");
    assert.equal(db.payments[0].status, "pending");
  }
});
test("explicit confirmed-no-movement rejection is terminal", async () => {
  const { handler, db } = setup(() => Response.json({ success: false, confirmed_not_sent: true }, { status: 400 }));
  assert.equal((await (await handler(request("pay", body))).json()).status, "failed");
  assert.equal(db.payments[0].status, "failed");
});
test("a failed receipt write stays pending and can later recover", async () => {
  const { handler, db } = setup(canonical);
  db.controls.failComplete = true;
  const response = await (await handler(request("pay", body))).json();
  assert.equal(response.status, "pending"); assert.equal(response.code, "RECEIPT_UPDATE_PENDING");
  db.controls.failComplete = false;
  assert.equal((await (await handler(request(`payment-status&payment_id=${response.payment_id}`))).json()).status, "completed");
});
test("a zero-row completion update cannot manufacture a receipt", async () => {
  const { handler, db } = setup(); db.controls.zeroComplete = true;
  assert.equal((await (await handler(request("pay", body))).json()).status, "pending");
  assert.equal(db.controls.receipts, 0);
});
test("status lookup enforces ownership even with a known payment ID", async () => {
  const { handler, db, calls } = setup(); const row = pending(db);
  const response = await handler(request(`payment-status&payment_id=${row.id}`, undefined, "stranger-token"));
  assert.equal(response.status, 404); assert.equal((await response.json()).found, false); assert.equal(calls.length, 0);
});
test("local not-found is distinct from a provider not-found for an existing intent", async () => {
  const { handler, db } = setup(() => Response.json({ success: true, status: "not_found" }));
  assert.equal((await handler(request("payment-status&idempotency_key=missing-intent"))).status, 404);
  const row = pending(db);
  const response = await (await handler(request(`payment-status&payment_id=${row.id}`))).json();
  assert.equal(response.found, true); assert.equal(response.status, "pending");
});
test("mismatched canonical amount or currency does not complete a payment", async () => {
  const { handler, db } = setup((url: URL, init: any) => canonical(url, init, { currency: "ZWG" }));
  const row = pending(db);
  assert.equal((await (await handler(request(`payment-status&payment_id=${row.id}`))).json()).status, "pending");
});
test("worker rejects normal users before database access", async () => {
  const { worker, db, calls } = setup();
  assert.equal((await worker(new Request("http://localhost/recovery", { method: "POST", headers: { Authorization: "Bearer user-token" } }))).status, 401);
  assert.equal(db.controls.queries, 0); assert.equal(calls.length, 0);
});
test("worker is bounded, GET-only, skips fresh work and returns aggregate counts", async () => {
  const { worker, db, calls } = setup(canonical);
  pending(db); pending(db, { idempotency_key: "other-intent-1" }); pending(db, { created_at: "2026-09-10T11:59:45.000Z" });
  const response = await worker(new Request("http://localhost/recovery?limit=1", { method: "POST", headers: { Authorization: `Bearer ${serviceKey}` } }));
  const result = await response.json(); assert.equal(result.checked, 1); assert.equal(result.completed, 1);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].method, "GET"); assert.equal(JSON.stringify(result).includes(sender), false);
});
test("worker rotates unresolved rows so older pending work cannot starve the next row", async () => {
  const { worker, db, calls } = setup(() => Response.json({ success: true, status: "not_found" }));
  pending(db); pending(db, { idempotency_key: "other-intent-2" });
  const makeReq = () => new Request("http://localhost/recovery?limit=1", { method: "POST", headers: { Authorization: `Bearer ${serviceKey}` } });
  await worker(makeReq()); await worker(makeReq());
  assert.notEqual(calls[0][0].searchParams.get("partner_reference"), calls[1][0].searchParams.get("partner_reference"));
  assert.equal(db.payments.every(row => row.status === "pending"), true);
});
test("worker reports provider lookup errors while leaving payment outcome pending", async () => {
  const { worker, db } = setup(() => Response.json({ success: false }, { status: 503 }));
  pending(db);
  const response = await worker(new Request("http://localhost/recovery", { method: "POST", headers: { Authorization: `Bearer ${serviceKey}` } }));
  const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.errors, 1); assert.equal(result.pending, 1);
  assert.equal(db.payments[0].status, "pending");
});
test("initial and recovered receipts require exact scope, amount, currency and UUID transaction", async () => {
  for (const extra of [{ partner_reference: stranger }, { partner_reference: undefined }, { amount: undefined }, { amount: 12.51 }, { currency: undefined }, { currency: "ZWG" }, { tx_id: "not-a-uuid" }, { tx_id: null }]) {
    const { handler, db } = setup((url: URL, init: any) => canonical(url, init, extra));
    const initial = await (await handler(request("pay", body))).json();
    assert.equal(initial.status, "pending");
    const recovered = await (await handler(request(`payment-status&payment_id=${initial.payment_id}`))).json();
    assert.equal(recovered.status, "pending"); assert.equal(db.controls.receipts, 0);
  }
});
test("missing explicit Crisp URL stops before recording or submitting a new payment", async () => {
  const { deps, db, calls } = setup(); deps.crispUrl = "";
  assert.equal((await createBridgeHandler(deps)(request("pay", body))).status, 503);
  assert.equal(db.payments.length, 0); assert.equal(calls.length, 0);
});
test("new non-USD chat payments reject before insert and send while old records remain recoverable", async () => {
  const { handler, db, calls } = setup((url: URL, init: any) => canonical(url, init, { currency: "ZWG" }));
  const rejected = await handler(request("pay", { ...body, currency: "ZWG" }));
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).code, "UNSUPPORTED_CHAT_CURRENCY");
  assert.equal(db.payments.length, 0); assert.equal(calls.length, 0);
  const old = pending(db, { currency: "ZWG" });
  const recovered = await (await handler(request(`payment-status&payment_id=${old.id}`))).json();
  assert.equal(recovered.status, "completed");
  assert.equal(db.payments[0].currency, "ZWG"); assert.equal(calls.every(call => call[1].method === "GET"), true);
});
