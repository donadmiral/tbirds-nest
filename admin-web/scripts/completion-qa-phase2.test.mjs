import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  QA_ORIGIN, PROJECT_REF, VERCEL_PROJECT, sha256, verifyContract, createQaContext,
  isRpcDenial, cleanupFixtures,
} from './completion-qa-fixtures.mjs';
import {runInteractionsAcceptance, classifyOfferRace, assertOfferCapabilities, assertSupportReceipt} from './completion-qa-interactions-acceptance.mjs';
import {runErasureAcceptance, assertErasureStatus, refreshDenialIsConfirmed, validatePrivateSignedUrl} from './completion-qa-erasure-acceptance.mjs';

const SOURCE = 'f'.repeat(40), START = Date.parse('2026-11-01T06:00:00Z');
const ENV = {VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: VERCEL_PROJECT,
  VERCEL_GIT_COMMIT_REF: 'codex/completion-20261101', VERCEL_GIT_COMMIT_SHA: SOURCE,
  NEXT_PUBLIC_SUPABASE_URL: QA_ORIGIN, SUPABASE_SERVICE_ROLE_KEY: 'offline-test-service', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-test-anon'};
const success = value => ({data: structuredClone(value), error: null, status: 200});
const denial = (code, message, status = 400) => ({data: null, error: {code, message}, status});
const absentUser = () => ({data: {user: null}, error: {code: 'user_not_found', status: 404}});
const missingObject = () => ({data: null, error: {status: 400, statusCode: '404'}});
const capability = {version: 1, serialized: true, replay: false, fractionDigits: 2, maxAmount: '9999999999.99'};

function binding(suite, patch = {}) {
  const gates = ['protectedPreviewVerified', 'ordinaryAuthHooksReviewed', 'isolatedQaFixtureWindow', 'noOutboundProviderDispatch', ...{
    offers: ['offerSerializationInstalled', 'listingAndMessageTriggersReviewed', 'marketAlertsEmpty'],
    support: ['atomicMemberSupportInstalled', 'supportTriggersReviewed'],
    erasure: ['accountErasureInstalled', 'scopedOneUseErasureDispatchInstalled', 'erasureCronActive', 'erasureWorkerHeartbeatFresh',
      'legacyReusableErasureDispatchDisabled', 'privateMediaDeliveryInstalled'],
  }[suite]];
  const identities = {
    offers: ['public.offer_response_capabilities()', 'public.make_offer(uuid,numeric)', 'public.respond_offer(uuid,text,numeric)'],
    support: ['public.send_member_support_reply(uuid,uuid,uuid,text)', 'support_private.reopen_member_ticket()'],
    erasure: ['public.request_account_erasure(uuid,text)', 'public.account_erasure_status(uuid,text)', 'public.claim_account_erasure_run(text,uuid)'],
  }[suite];
  const proof = Buffer.from('offline synthetic evidence; not a hosted receipt');
  const contract = {schemaVersion: 1, accepted: true, suite, projectRef: PROJECT_REF, vercelProjectId: VERCEL_PROJECT,
    observedAt: new Date(START).toISOString(), gates: Object.fromEntries(gates.map(gate => [gate, true])),
    evidence: ['a', 'b'].map(key => ({path: `docs/quality/completion-20261101/offline-${key}.json`, sha256: sha256(proof)})),
    functionIdentities: identities.map(identity => ({identity, definitionSha256: 'a'.repeat(64), aclSha256: 'b'.repeat(64)})), ...patch};
  const contractBytes = Buffer.from(JSON.stringify(contract));
  return {contract, contractBytes, contractSha256: sha256(contractBytes), readEvidence: async () => proof};
}

// A stateful, offline SDK/HTTP double. It retains rows and side effects across
// the complete harness and cleanup, and injects explicit false acknowledgments
// and provider failures. It does not claim hosted database/provider acceptance.
class FakeProvider {
  constructor(faults = {}) {
    this.faults = faults; this.clock = START; this.counter = 1; this.users = new Map(); this.tokens = new Map();
    this.tables = Object.fromEntries(['profiles', 'marketplace_listings', 'market_alerts', 'listing_offers', 'conversations', 'messages', 'support_tickets', 'support_messages'].map(name => [name, []]));
    this.objects = new Map(); this.calls = []; this.deletedUsers = []; this.deletedFiles = []; this.job = null;
  }
  uuid = () => `10000000-0000-4000-8000-${String(this.counter++).padStart(12, '0')}`;
  now = () => this.clock;
  wait = async ms => { assert.equal(ms, 5000); this.clock += ms; };
  date = () => new Date(this.clock).toISOString();
  clientFactory = (origin, key, options) => {
    assert.equal(origin, QA_ORIGIN);
    const client = {admin: key === ENV.SUPABASE_SERVICE_ROLE_KEY, id: this.tokens.get(options.global.headers?.Authorization?.slice(7)) ?? null};
    client.auth = {
      admin: {
        createUser: async input => {
          assert.equal(client.admin, true); assert.equal(input.email_confirm, true);
          const user = {...input, is_anonymous: false}; delete user.password;
          this.users.set(input.id, user); this.calls.push(['createUser', input.id]);
          this.tables.profiles.push({id: input.id, account_type: 'personal', deactivated_at: null, push_token: null});
          return {data: {user: structuredClone(user)}, error: null};
        },
        getUserById: async id => {
          assert.equal(client.admin, true); const user = this.users.get(id);
          if (!user) return this.faults.authAbsenceUnknown ? {data: {user: null}, error: {status: 500, code: 'unexpected_failure'}} : absentUser();
          return {data: {user: {...structuredClone(user), ...(this.faults.foreignCleanupMarker ? {app_metadata: {completion_qa_fixture: false}} : {})}}, error: null};
        },
        deleteUser: async id => {
          assert.equal(client.admin, true); this.calls.push(['deleteUser', id]); this.deletedUsers.push(id);
          this.users.delete(id); this.tables.profiles = this.tables.profiles.filter(row => row.id !== id);
          return {data: {user: null}, error: null};
        },
      },
      signInWithPassword: async ({email}) => {
        const user = [...this.users.values()].find(row => row.email === email); assert.ok(user);
        client.id = user.id; const token = `offline-access-secret-${user.id}`; this.tokens.set(token, user.id);
        return {error: null, data: {user: structuredClone(user), session: {access_token: token, refresh_token: `offline-refresh-secret-${user.id}`}}};
      },
      refreshSession: async () => this.faults.refreshUnknown
        ? {data: {user: null, session: null}, error: {code: 'unexpected_failure', status: 500, message: 'must-never-log-secret'}}
        : {data: {user: null, session: null}, error: {code: 'user_banned', status: 400}},
    };
    client.from = table => this.query(client, table);
    client.rpc = (name, args) => this.rpc(client, name, args);
    client.storage = {from: bucket => this.storage(client, bucket)};
    return client;
  };
  query(client, table) {
    assert.ok(Object.hasOwn(this.tables, table), `unexpected table ${table}`);
    const query = {op: 'read', filters: [], fields: '*', mode: 'many', payload: null, options: {}};
    const chain = {
      select: (fields = '*', options = {}) => { query.fields = fields; query.options = options; return chain; },
      insert: payload => { query.op = 'insert'; query.payload = payload; return chain; },
      update: payload => { query.op = 'update'; query.payload = payload; return chain; },
      delete: () => { query.op = 'delete'; return chain; },
      eq: (field, value) => { query.filters.push([field, value]); return chain; },
      order: () => chain,
      single: () => { query.mode = 'single'; return chain; },
      maybeSingle: () => { query.mode = 'maybe'; return chain; },
      then: (resolve, reject) => Promise.resolve().then(() => this.executeQuery(client, table, query)).then(resolve, reject),
    }; return chain;
  }
  visible(client, table, row) {
    if (client.admin || table === 'marketplace_listings' || table === 'market_alerts') return true;
    if (table === 'profiles') return row.id === client.id;
    if (table === 'support_tickets') return row.user_id === client.id;
    if (table === 'support_messages') return this.tables.support_tickets.some(ticket => ticket.id === row.ticket_id && ticket.user_id === client.id);
    if (table === 'listing_offers') return [row.seller_id, row.buyer_id].includes(client.id);
    if (table === 'conversations') return [row.user_1, row.user_2].includes(client.id);
    if (table === 'messages') return this.tables.conversations.some(c => c.id === row.conversation_id && [c.user_1, c.user_2].includes(client.id));
    throw new Error('unexpected visibility table');
  }
  executeQuery(client, table, query) {
    this.calls.push([query.op, table]);
    if (table === 'market_alerts' && query.options.head) return {...success(null), count: this.faults.marketAlerts ? 1 : 0};
    const matches = row => query.filters.every(([key, value]) => row[key] === value);
    let rows = this.tables[table].filter(row => matches(row) && this.visible(client, table, row));
    if (query.op === 'insert') {
      const row = {...structuredClone(query.payload), created_at: this.date()};
      if (table === 'marketplace_listings') { assert.equal(row.seller_id, client.id); row.status = 'available'; }
      if (table === 'support_tickets') { assert.equal(row.user_id, client.id); row.status = 'open'; }
      this.tables[table].push(row); rows = [row];
    } else if (query.op === 'update') {
      assert.equal(client.admin, true); rows.forEach(row => Object.assign(row, query.payload));
    } else if (query.op === 'delete') {
      assert.equal(client.admin, true);
      if (this.faults.cleanupFailure && table === 'support_tickets') return denial('42501', 'cleanup denied', 403);
      const ids = rows.map(row => row.id); this.tables[table] = this.tables[table].filter(row => !ids.includes(row.id));
      if (table === 'support_tickets') this.tables.support_messages = this.tables.support_messages.filter(row => !ids.includes(row.ticket_id));
      if (table === 'marketplace_listings') this.tables.listing_offers = this.tables.listing_offers.filter(row => !ids.includes(row.listing_id));
      if (table === 'conversations') this.tables.messages = this.tables.messages.filter(row => !ids.includes(row.conversation_id));
      return success(null);
    }
    const project = row => Object.fromEntries(query.fields.split(',').map(field => [field, row[field]]));
    if (query.mode === 'single' && rows.length !== 1) return denial('PGRST116', 'single failed', 406);
    if (query.mode === 'maybe' && rows.length > 1) return denial('PGRST116', 'maybe failed', 406);
    return success(query.mode === 'many' ? rows.map(project) : rows.length ? project(rows[0]) : null);
  }
  async rpc(client, name, args = {}) {
    this.calls.push(['rpc', name]);
    if (name === 'offer_response_capabilities') return success(capability);
    if (name === 'make_offer') {
      const listing = this.tables.marketplace_listings.find(row => row.id === args.p_listing_id); assert.ok(listing);
      const offer = {id: this.uuid(), listing_id: listing.id, seller_id: listing.seller_id, buyer_id: client.id, proposer_id: client.id,
        amount: args.p_amount, currency: 'USD', status: 'pending', responded_at: null}; this.tables.listing_offers.push(offer);
      const conversation = {id: this.uuid(), user_1: listing.seller_id, user_2: client.id, context: 'market', context_ref_id: listing.id, is_group: false};
      this.tables.conversations.push(conversation);
      this.tables.messages.push({id: this.uuid(), conversation_id: conversation.id, sender_id: client.id, receiver_id: listing.seller_id,
        text: 'synthetic offer', media_type: 'offer', media_url: JSON.stringify({offer_id: offer.id, listing_id: listing.id, status: 'pending', amount: args.p_amount}), is_system_message: false});
      return success(this.faults.missingOfferAck ? null : offer.id);
    }
    if (name === 'respond_offer') {
      const offer = this.tables.listing_offers.find(row => row.id === args.p_offer_id);
      if (!offer || ![offer.seller_id, offer.buyer_id].includes(client.id)) return denial('P0002', 'OFFER_NOT_FOUND', 404);
      if (offer.status !== 'pending') {
        if (this.faults.raceTransport) throw new Error('must-never-log-secret');
        return this.faults.doubleWinner ? success(null) : denial('55000', 'OFFER_ALREADY_RESOLVED');
      }
      offer.status = args.p_action; offer.responded_at = this.date();
      const conversation = this.tables.conversations.find(row => row.context_ref_id === offer.listing_id);
      const message = {id: this.uuid(), conversation_id: conversation.id, sender_id: client.id,
        receiver_id: client.id === offer.seller_id ? offer.buyer_id : offer.seller_id,
        text: args.p_action === 'accepted' ? '✅ Offer accepted' : 'Offer withdrawn', media_type: null, media_url: null, is_system_message: true};
      this.tables.messages.push(message); if (this.faults.duplicateOfferMessage) this.tables.messages.push({...message, id: this.uuid()});
      return success(null);
    }
    if (name === 'send_member_support_reply') {
      assert.deepEqual(Object.keys(args).sort(), ['p_body', 'p_expected_user', 'p_request_id', 'p_ticket_id']);
      if (args.p_expected_user !== client.id) return denial('42501', 'SUPPORT_ACCOUNT_CHANGED', 403);
      const ticket = this.tables.support_tickets.find(row => row.id === args.p_ticket_id && row.user_id === client.id);
      if (!ticket) return denial('42501', 'SUPPORT_TICKET_UNAVAILABLE', 403);
      let message = this.tables.support_messages.find(row => row.id === args.p_request_id), replayed = !!message;
      if (message && (message.body !== args.p_body || message.ticket_id !== ticket.id)) return denial('22023', 'SUPPORT_REQUEST_CONFLICT');
      if (!message) {
        message = {id: args.p_request_id, ticket_id: ticket.id, sender: 'member', sender_id: client.id, body: args.p_body, created_at: this.date()};
        this.tables.support_messages.push(message); if (!this.faults.missingReopen) ticket.status = 'open';
      } else if (this.faults.replayReopens) ticket.status = 'open';
      return success({message_id: message.id, ticket_id: ticket.id, sender_id: client.id, body: message.body,
        created_at: message.created_at, ticket_status: ticket.status, replayed});
    }
    if (name === 'request_account_erasure') {
      if (!this.job) this.job = {id: args.p_request_id, owner: client.id, token: args.p_receipt_token, at: this.clock};
      assert.equal(this.job.id, args.p_request_id); assert.equal(this.job.token, args.p_receipt_token);
      if (this.faults.ambiguousErasureAck) throw new Error('must-never-log-secret');
      return success(this.jobStatus());
    }
    if (name === 'account_erasure_status') return success(this.job && this.job.id === args.p_request_id && this.job.token === args.p_receipt_token ? this.jobStatus() : null);
    if (name === 'issue_content_media_delivery') return denial('42501', 'AUTH_SESSION_REQUIRED', 403);
    throw new Error(`unexpected RPC ${name}`);
  }
  jobStatus() {
    const elapsed = this.clock - this.job.at;
    let erased = elapsed >= 5000 && !this.faults.workerNoProgress, completed = elapsed >= 70000 && !this.faults.workerNoProgress;
    if (erased && !this.faults.completedButFileRemains) this.objects.clear();
    if (completed && !this.faults.completedButAuthRemains) {
      this.users.delete(this.job.owner); this.tables.profiles = this.tables.profiles.filter(row => row.id !== this.job.owner);
    }
    return {requestId: this.job.id, state: completed ? 'completed' : 'queued', reason: null,
      requestedAt: new Date(this.job.at).toISOString(), updatedAt: this.date(), completedAt: completed ? this.date() : null,
      filesTotal: this.faults.booleanFiles ? true : 1, filesErased: erased ? 1 : 0};
  }
  storage(client, bucket) {
    assert.equal(bucket, 'post-media');
    return {
      upload: async (path, bytes, options) => { assert.ok(path.startsWith(client.id + '/')); assert.equal(options.cacheControl, '60');
        this.objects.set(path, Buffer.from(bytes)); return {error: null, data: {path}}; },
      createSignedUrl: async (path, expiry) => { assert.equal(expiry, 1800); return {error: null, data: {signedUrl:
        `${this.faults.foreignSignedUrl ? 'https://elsewhere.invalid' : QA_ORIGIN}/storage/v1/object/sign/post-media/${path}?token=${'x'.repeat(30)}`}}; },
      list: async (prefix, {search}) => this.faults.storageListUnknown ? {data: null, error: {status: 500}} :
        {error: null, data: [...this.objects.keys()].filter(path => path.startsWith(prefix + '/') && path.endsWith('/' + search)).map(path => ({name: path.split('/').at(-1)}))},
      download: async path => this.objects.has(path) ? {data: new Blob([this.objects.get(path)]), error: null} :
        this.faults.storage403 ? {data: null, error: {status: 403, statusCode: '403'}} : missingObject(),
      remove: async paths => { assert.equal(client.admin, true); this.deletedFiles.push(...paths); for (const path of paths) this.objects.delete(path); return {data: [], error: null}; },
    };
  }
  fetcher = async input => {
    const url = new URL(input); assert.equal(url.origin, QA_ORIGIN);
    if (url.pathname.startsWith('/storage/v1/object/public/')) return Response.json({statusCode: '404'}, {status: 400});
    const path = [...this.objects.keys()][0] ?? this.lastObjectPath;
    if (path) this.lastObjectPath = path;
    if (url.pathname === '/functions/v1/content-media-sign') return Response.json({urls: [{url: `${QA_ORIGIN}/functions/v1/media-content/post-media/${path}?token=${'a'.repeat(64)}`}]});
    if (url.pathname.startsWith('/functions/v1/media-content/')) {
      if (this.job) return Response.json({error: 'revoked'}, {status: 410});
      return new Response(this.objects.get(path), {headers: {'Cache-Control': 'no-store'}});
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (this.objects.size) { this.lastBytes = this.objects.get(path); return new Response(this.lastBytes, {headers: {'Cache-Control': 'max-age=60'}}); }
      if (this.faults.cdnRetained) return new Response(this.lastBytes, {headers: {'Cache-Control': 'max-age=60'}});
      return Response.json({statusCode: '404'}, {status: 400});
    }
    throw new Error('unexpected request');
  };
  options(suite) { return {...binding(suite), suite, env: ENV, expectedSource: SOURCE,
    clientFactory: this.clientFactory, fetcher: this.fetcher, uuid: this.uuid, now: this.now, wait: this.wait}; }
}

test('contract rejects absent, wrong, stale and unproved gates before any client or mutation', async () => {
  const valid = binding('offers');
  await verifyContract({...valid, suite: 'offers', now: START, read: valid.readEvidence});
  const bad = [
    {accepted: false}, {projectRef: 'production'}, {suite: 'support'}, {vercelProjectId: 'other'},
    {schemaVersion: true}, {observedAt: new Date(START - 31 * 60000).toISOString()},
    {gates: {...valid.contract.gates, noOutboundProviderDispatch: false}},
    {evidence: []}, {functionIdentities: valid.contract.functionIdentities.slice(1)},
  ];
  for (const patch of bad) {
    const provider = new FakeProvider(), result = await runInteractionsAcceptance({...provider.options('offers'), ...binding('offers', patch)});
    assert.equal(result.allChecksPassed, false); assert.equal(result.mutationStarted, false); assert.deepEqual(provider.calls, []);
  }
  await assert.rejects(verifyContract({...valid, suite: 'offers', now: START, read: async () => Buffer.from('changed')}), /EVIDENCE_DRIFT/);
});

test('exact project/source/origin guard and scoped fetch reject other environments without a request', async () => {
  for (const patch of [{VERCEL_ENV: 'production'}, {VERCEL_PROJECT_ID: 'other'}, {VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40)}, {NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co'}]) {
    const provider = new FakeProvider(), result = await runInteractionsAcceptance({...provider.options('support'), env: {...ENV, ...patch}});
    assert.equal(result.mutationStarted, false); assert.deepEqual(provider.calls, []);
  }
  let requests = 0; const provider = new FakeProvider();
  const ctx = createQaContext({env: ENV, expectedSource: SOURCE, suite: 'support', contract: {sha256: 'a'.repeat(64), gates: []},
    clientFactory: provider.clientFactory, fetcher: async () => { requests++; }});
  for (const url of ['https://example.invalid/auth/v1/user', `${QA_ORIGIN}/arbitrary/path`]) await assert.rejects(ctx.fetch(url), /SCOPE_VIOLATION/);
  assert.equal(requests, 0);
});

test('offers full path proves one response/message and removes exactly the synthetic graph', async () => {
  const provider = new FakeProvider(), result = await runInteractionsAcceptance(provider.options('offers'));
  assert.equal(result.allChecksPassed, true, JSON.stringify(result));
  assert.equal(provider.deletedUsers.length, 3);
  for (const rows of Object.values(provider.tables)) assert.equal(rows.length, 0);
  assert.equal(result.rpcReceipts.find(row => row.name === 'respond_offer_concurrent').value.status, 'accepted');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('offers block unrelated alerts before Auth creation', async () => {
  const provider = new FakeProvider({marketAlerts: true}), result = await runInteractionsAcceptance(provider.options('offers'));
  assert.equal(result.allChecksPassed, false); assert.equal(result.failure.code, 'QA_EXISTING_MARKET_ALERTS_BLOCK_FIXTURE');
  assert.equal(provider.users.size, 0); assert.equal(provider.calls.some(call => call[0] === 'createUser'), false);
});

for (const [fault, code] of [['missingOfferAck', 'QA_MAKE_OFFER_ID_REQUIRED'], ['doubleWinner', 'QA_OFFER_RACE_SINGLE_WINNER_REQUIRED'],
  ['raceTransport', 'QA_OFFER_RACE_TRANSPORT_UNCONFIRMED'], ['duplicateOfferMessage', 'QA_OFFER_SINGLE_MESSAGE_READBACK_MISMATCH']]) {
  test(`offers reject ${fault} and still clean exact fixtures`, async () => {
    const provider = new FakeProvider({[fault]: true}), result = await runInteractionsAcceptance(provider.options('offers'));
    assert.equal(result.allChecksPassed, false); assert.equal(result.failure.code, code);
    assert.equal(provider.users.size, 0); assert.equal(provider.tables.conversations.length, 0);
    assert.ok(!JSON.stringify(result).includes('must-never-log-secret'));
  });
}

test('support full path exercises actual receipt recovery, reopen and both denials with exact cleanup', async () => {
  const provider = new FakeProvider(), result = await runInteractionsAcceptance(provider.options('support'));
  assert.equal(result.allChecksPassed, true, JSON.stringify(result));
  assert.deepEqual(result.rpcReceipts.map(row => [row.value.replayed, row.value.ticket_status]), [[false, 'open'], [true, 'solved']]);
  assert.equal(provider.deletedUsers.length, 2); assert.equal(provider.tables.support_messages.length, 0);
});

for (const fault of ['missingReopen', 'replayReopens']) test(`support rejects ${fault}`, async () => {
  const provider = new FakeProvider({[fault]: true}), result = await runInteractionsAcceptance(provider.options('support'));
  assert.equal(result.allChecksPassed, false); assert.equal(result.failure.code, 'QA_SUPPORT_RECEIPT_MISMATCH');
  assert.equal(provider.users.size, 0);
});

test('uncertain application cleanup prevents Auth deletion', async () => {
  const provider = new FakeProvider({cleanupFailure: true}), result = await runInteractionsAcceptance(provider.options('support'));
  assert.equal(result.allChecksPassed, false); assert.equal(provider.deletedUsers.length, 0); assert.equal(provider.users.size, 2);
  assert.ok(result.cleanup.some(row => row.code === 'QA_FIXTURE_DATA_ABSENCE_UNCONFIRMED'));
});

test('foreign fixture metadata never authorizes app or Auth cleanup', async () => {
  const provider = new FakeProvider({foreignCleanupMarker: true}), result = await runInteractionsAcceptance(provider.options('support'));
  assert.equal(result.allChecksPassed, false); assert.equal(provider.deletedUsers.length, 0);
  assert.ok(result.cleanup.some(row => row.code === 'QA_FIXTURE_CLEANUP_SCOPE_MISMATCH'));
});

test('erasure full path observes real-double file-before-Auth progression, revoked session and warmed URL absence', async () => {
  const provider = new FakeProvider(), result = await runErasureAcceptance(provider.options('erasure'));
  assert.equal(result.allChecksPassed, true, JSON.stringify(result));
  assert.equal(provider.deletedUsers.length, 0); assert.equal(provider.deletedFiles.length, 0); // worker only
  assert.equal(provider.users.size, 0); assert.equal(provider.objects.size, 0);
  assert.ok(result.checks.some(row => row.name === 'auth_identity_survived_actual_file_removal_before_completion'));
  assert.ok(!JSON.stringify(result).includes(provider.job.token));
  assert.ok(!JSON.stringify(result).includes('offline-access-secret'));
  assert.ok(!JSON.stringify(result).includes('?token='));
});

for (const [fault, code] of [['ambiguousErasureAck', 'CHECK_FAILED'], ['booleanFiles', 'QA_ERASURE_RECEIPT_INVALID'],
  ['workerNoProgress', 'QA_ERASURE_WORKER_DEADLINE_EXCEEDED'], ['completedButFileRemains', 'QA_ERASURE_STORAGE_OBJECT_REMAINS'],
  ['completedButAuthRemains', 'QA_ERASURE_AUTH_STILL_PRESENT'], ['storage403', 'QA_ERASURE_STORAGE_ABSENCE_UNCONFIRMED']]) {
  test(`erasure ${fault} cannot fall back to admin Auth or file deletion`, async () => {
    const provider = new FakeProvider({[fault]: true}), result = await runErasureAcceptance(provider.options('erasure'));
    assert.equal(result.allChecksPassed, false, JSON.stringify(result)); assert.equal(result.failure.code, code);
    assert.equal(provider.deletedUsers.length, 0); assert.equal(provider.deletedFiles.length, 0);
    assert.ok(result.cleanup.some(row => row.workerOwnsErasure));
    assert.ok(!JSON.stringify(result).includes('must-never-log-secret'));
  });
}

for (const [fault, code] of [['cdnRetained', 'QA_WARM_CDN_OBJECT_ABSENCE_UNCONFIRMED'], ['refreshUnknown', 'QA_ERASURE_REFRESH_REVOCATION_UNCONFIRMED']]) {
  test(`erasure ${fault} stays failed even when worker completes and cleanup is verified`, async () => {
    const provider = new FakeProvider({[fault]: true}), result = await runErasureAcceptance(provider.options('erasure'));
    assert.equal(result.allChecksPassed, false); assert.equal(result.failure.code, code);
    assert.equal(provider.deletedUsers.length, 0); assert.equal(provider.deletedFiles.length, 0); assert.equal(provider.users.size, 0);
    assert.equal(result.cleanup.every(row => row.passed), true);
  });
}

test('wrong signed CDN origin aborts before erasure and performs ordinary scoped cleanup', async () => {
  const provider = new FakeProvider({foreignSignedUrl: true}), result = await runErasureAcceptance(provider.options('erasure'));
  assert.equal(result.allChecksPassed, false); assert.equal(result.failure.code, 'QA_CDN_URL_SCOPE_MISMATCH');
  assert.equal(provider.job, null); assert.equal(provider.deletedUsers.length, 1); assert.equal(provider.deletedFiles.length, 1);
});

test('expected denials never accept generic 500, transport errors, wrong messages or forged values', () => {
  assert.equal(isRpcDenial(denial('55000', 'OFFER_ALREADY_RESOLVED'), '55000', 'OFFER_ALREADY_RESOLVED'), true);
  for (const row of [denial('55000', 'OFFER_ALREADY_RESOLVED', 500), denial('55000', 'different'), {data: null, error: new Error('offline'), status: 0}, success(null)]) {
    assert.equal(isRpcDenial(row, '55000', 'OFFER_ALREADY_RESOLVED'), false);
  }
  assert.throws(() => assertOfferCapabilities({...capability, replay: 0}), /CAPABILITY_MISMATCH/);
  assert.throws(() => classifyOfferRace([{status: 'rejected', reason: new Error()}, {status: 'fulfilled', value: success(null)}]), /TRANSPORT_UNCONFIRMED/);
  assert.equal(refreshDenialIsConfirmed({data: {session: null, user: null}, error: {status: 500, code: 'user_banned'}}), false);
  assert.equal(refreshDenialIsConfirmed({data: {session: {access_token: 'forged'}}, error: {status: 400, code: 'user_banned'}}), false);
});

test('phase-1 bytes remain frozen and erasure contains no worker-token or Auth-delete invocation', async () => {
  assert.equal(sha256(await readFile(new URL('./completion-qa-auth-acceptance.mjs', import.meta.url))), '645c869d6a78f9c30008b9138e0e7705b446168008fd68630dad425a4b59f3ac');
  const erasure = await readFile(new URL('./completion-qa-erasure-acceptance.mjs', import.meta.url), 'utf8');
  assert.ok(!erasure.includes("rpc('claim_account_erasure'")); assert.ok(!erasure.includes('pc_erase_'));
  assert.ok(!erasure.includes('auth.admin.deleteUser'));
});
