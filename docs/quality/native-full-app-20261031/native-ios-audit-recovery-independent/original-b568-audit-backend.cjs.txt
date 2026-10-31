/** Exact additional Support contracts for the isolated audit binary only. */
const { createFixture: createBase, FixtureWebSocket, OWNER } = require('../backend-fixture.cjs');
const manifest = require('./manifest.json');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const TICKET = 'a0000000-0000-4000-8000-000000000001';
const modes = new Set(['baseline', 'fresh-ticket', 'missing-ticket', 'ticket-read-error', 'history-error', 'list-error', 'status-write-error', 'message-write-error']);
function createFixture(onChange = () => {}) {
  const base = createBase(onChange);
  let authenticatedOwner = null;
  let mode = 'baseline';
  let tickets = [];
  let messages = [];
  const audit = base.receipt.audit = { schemaVersion: 1, caseId: null, scenario: null, requests: [], mutations: [], rejected: [] };
  const notify = () => onChange(base.receipt);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const reject = (method, path) => {
    audit.rejected.push({ method, path });
    base.receipt.unhandled.push({ method, path });
    notify();
    return json({ code: 'NATIVE_AUDIT_UNHANDLED', message: 'The exact audit contract is not implemented.' }, 501);
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input));
    const method = String(init.method || input.method || 'GET').toUpperCase();
    const path = url.pathname;
    const table = path === '/rest/v1/support_tickets' ? 'support_tickets' : path === '/rest/v1/support_messages' ? 'support_messages' : null;
    if (url.origin !== ORIGIN || !table) {
      const result = await base.fetch(input, init);
      if (url.origin === ORIGIN && path === '/auth/v1/token' && method === 'POST') {
        const credentials = typeof init.body === 'string' ? JSON.parse(init.body) : {};
        const id = url.searchParams.get('grant_type') === 'refresh_token'
          ? String(credentials.refresh_token || '').replace(/^synthetic-refresh-/, '')
          : base.profiles.find(profile => profile.email === credentials.email)?.id;
        if (result.ok) authenticatedOwner = base.profiles.some(profile => profile.id === id) ? id : null;
      }
      if (url.origin === ORIGIN && path === '/auth/v1/logout') authenticatedOwner = null;
      return result;
    }
    if (!authenticatedOwner) return json({ message: 'Authentication required' }, 401);
    if (authenticatedOwner !== OWNER) return json({ message: 'This synthetic support case belongs to another account' }, 403);
    if (init.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (!['GET', 'POST', 'PATCH'].includes(method)) return reject(method, path);
    const allowedQueries = table === 'support_tickets' ? ['select', 'id', 'user_id', 'order', 'limit'] : ['select', 'ticket_id', 'order'];
    if ([...url.searchParams.keys()].some(key => !allowedQueries.includes(key))) return reject(method, path);
    if (url.searchParams.has('user_id') && url.searchParams.get('user_id') !== 'eq.' + OWNER) return reject(method, path);
    if (url.searchParams.has('id') && url.searchParams.get('id') !== 'eq.' + TICKET) return reject(method, path);
    if (url.searchParams.has('ticket_id') && url.searchParams.get('ticket_id') !== 'eq.' + TICKET) return reject(method, path);
    audit.requests.push({ method, table }); notify();
    if (method === 'GET') {
      const failure = table === 'support_messages' ? mode === 'history-error'
        : url.searchParams.has('id') ? mode === 'ticket-read-error' : mode === 'list-error';
      if (failure) return json({ code: 'AUDIT_CONTROLLED_READ_FAILURE', message: 'Controlled Support read failure' }, 503);
      const rows = table === 'support_tickets' ? tickets : messages;
      const headers = new Headers(init.headers || input.headers || {});
      if (headers.get('accept')?.includes('vnd.pgrst.object')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows' }, 406);
      return json(rows);
    }
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(method, path);
    if (table === 'support_tickets' && method === 'POST') {
      if (Object.keys(body).sort().join(',') !== 'body,kind,subject,user_id' || body.user_id !== OWNER
        || !['support', 'appeal'].includes(body.kind) || !body.subject || !body.body) return reject(method, path);
      tickets = [{ id: TICKET, created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-02T10:00:00Z', status: 'open', ...body }];
      // No invented trigger copies ticket.body into history. The current schema
      // and client do not establish such a per-insert backfill.
      audit.mutations.push({ method, table }); notify(); return json(tickets, 201);
    }
    if (table === 'support_messages' && method === 'POST') {
      if (Object.keys(body).sort().join(',') !== 'body,sender,sender_id,ticket_id' || body.ticket_id !== TICKET
        || body.sender !== 'member' || body.sender_id !== OWNER || !body.body) return reject(method, path);
      if (mode === 'message-write-error') return json({ message: 'Controlled reply failure' }, 503);
      messages.push({ id: 'audit-message-' + (messages.length + 1), created_at: '2026-01-02T10:01:00Z', ...body });
      audit.mutations.push({ method, table }); notify(); return json(messages.slice(-1), 201);
    }
    if (table === 'support_tickets' && method === 'PATCH') {
      if (Object.keys(body).sort().join(',') !== 'status,updated_at' || body.status !== 'open' || typeof body.updated_at !== 'string') return reject(method, path);
      if (mode === 'status-write-error') return json({ message: 'Controlled reopen failure' }, 503);
      tickets.forEach(ticket => Object.assign(ticket, body));
      audit.mutations.push({ method, table }); notify(); return json(tickets);
    }
    return reject(method, path);
  };
  return { ...base, fetch, persistAuditBaseline: notify, selectAuditCase(id, scenario) {
    const selected = manifest.cases.find(item => item.id === id);
    if (!selected || selected.fixtureScenario !== scenario || !modes.has(scenario)) throw new Error('Unknown audit case/scenario');
    if (audit.caseId !== null) throw new Error('A fresh fixture is required for each independent audit case.');
    audit.caseId = id; audit.scenario = scenario; mode = scenario;
    tickets = mode === 'missing-ticket' ? [] : [{ id: TICKET, user_id: OWNER, kind: 'support', subject: 'Audit support question',
      body: 'Original support question from the member.', status: mode === 'status-write-error' ? 'solved' : 'open',
      created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-02T10:00:00Z' }];
    messages = [];
    notify();
  } };
}
module.exports = { createFixture, FixtureWebSocket, TICKET };
