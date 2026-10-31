/** Exact additional Support contracts for the isolated audit binary only. */
const { createFixture: createBase, FixtureWebSocket, OWNER } = require('../backend-fixture.cjs');
const manifest = require('./manifest.json');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const TICKET = 'a0000000-0000-4000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPLY_RPC = '/rest/v1/rpc/send_member_support_reply';
const modes = new Set(['baseline', 'fresh-ticket', 'missing-ticket', 'ticket-read-error', 'history-error', 'list-error', 'status-write-error', 'message-write-error']);
function createFixture(onChange = () => {}) {
  const base = createBase(onChange);
  let authenticatedOwner = null;
  let mode = 'baseline';
  let tickets = [];
  let messages = [];
  const audit = base.receipt.audit = { schemaVersion: 2, caseId: null, scenario: null, requests: [], mutations: [], rejected: [] };
  const notify = () => {
    audit.state = { tickets: tickets.map(({ id, user_id, status }) => ({ id, user_id, status })), messageIds: messages.map(message => message.id) };
    onChange(base.receipt);
  };
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
    if (url.origin !== ORIGIN || (!table && path !== REPLY_RPC)) {
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
    if (path === REPLY_RPC) {
      if (method !== 'POST' || [...url.searchParams].length) return reject(method, path);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'p_body,p_expected_user,p_request_id,p_ticket_id') return reject(method, path);
      audit.requests.push({ method, rpc: 'send_member_support_reply' }); notify();
      if (body.p_expected_user !== OWNER) return json({ code: '42501', message: 'SUPPORT_ACCOUNT_CHANGED' }, 403);
      if (!UUID.test(body.p_ticket_id || '') || !UUID.test(body.p_request_id || '') || typeof body.p_body !== 'string'
        || !body.p_body.trim() || body.p_body.trim().length > 2000) return json({ code: '22023', message: 'SUPPORT_INPUT_INVALID' }, 400);
      const ticket = tickets.find(row => row.id === body.p_ticket_id && row.user_id === OWNER);
      if (!ticket) return json({ code: '42501', message: 'SUPPORT_TICKET_UNAVAILABLE' }, 403);
      let message = messages.find(row => row.id === body.p_request_id);
      const replayed = !!message;
      if (message && (message.ticket_id !== ticket.id || message.sender_id !== OWNER || message.sender !== 'member' || message.body !== body.p_body.trim())) {
        return json({ code: '22023', message: 'SUPPORT_REQUEST_CONFLICT' }, 400);
      }
      if (!message) {
        // Both failures occur before the one fixture commit, matching the
        // tested database transaction and its AFTER INSERT trigger rollback.
        if (mode === 'message-write-error' || mode === 'status-write-error') return json({ code: 'AUDIT_CONTROLLED_WRITE_FAILURE', message: 'Controlled atomic reply failure' }, 503);
        message = { id: body.p_request_id, ticket_id: ticket.id, sender: 'member', sender_id: OWNER, body: body.p_body.trim(), created_at: '2026-10-31T10:01:00Z' };
        messages.push(message);
        Object.assign(ticket, { status: 'open', updated_at: message.created_at });
        audit.mutations.push({ method, rpc: 'send_member_support_reply', tables: ['support_messages', 'support_tickets'], messageId: message.id, ticketId: ticket.id });
        notify();
      }
      return json({ message_id: message.id, ticket_id: message.ticket_id, sender_id: message.sender_id, body: message.body,
        created_at: message.created_at, ticket_status: ticket.status, replayed });
    }
    if (!['GET', 'POST', 'PATCH'].includes(method)) return reject(method, path);
    const allowedQueries = table === 'support_tickets' ? ['select', 'id', 'user_id', 'order', 'limit'] : ['select', 'ticket_id', 'order'];
    if ([...url.searchParams.keys()].some(key => !allowedQueries.includes(key))) return reject(method, path);
    if (url.searchParams.has('user_id') && url.searchParams.get('user_id') !== 'eq.' + OWNER) return reject(method, path);
    for (const key of ['id', 'ticket_id']) {
      if (url.searchParams.has(key) && !/^eq\./.test(url.searchParams.get(key))) return reject(method, path);
      if (url.searchParams.has(key) && !UUID.test(url.searchParams.get(key).slice(3))) return reject(method, path);
    }
    audit.requests.push({ method, table }); notify();
    if (method === 'GET') {
      const failure = table === 'support_messages' ? mode === 'history-error'
        : url.searchParams.has('id') ? mode === 'ticket-read-error' : mode === 'list-error';
      if (failure) return json({ code: 'AUDIT_CONTROLLED_READ_FAILURE', message: 'Controlled Support read failure' }, 503);
      let rows = table === 'support_tickets' ? tickets.filter(ticket => ticket.user_id === OWNER) : messages.filter(message => tickets.some(ticket => ticket.id === message.ticket_id && ticket.user_id === OWNER));
      for (const key of ['id', 'ticket_id']) if (url.searchParams.has(key)) rows = rows.filter(row => row[key] === url.searchParams.get(key).slice(3));
      if (url.searchParams.has('order')) {
        const order = url.searchParams.get('order');
        if (!/^created_at\.(asc|desc)$/.test(order)) return reject(method, path);
        rows = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) * (order.endsWith('desc') ? -1 : 1));
      }
      if (url.searchParams.has('limit')) {
        const limit = Number(url.searchParams.get('limit'));
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return reject(method, path);
        rows = rows.slice(0, limit);
      }
      const headers = new Headers(init.headers || input.headers || {});
      if (headers.get('accept')?.includes('vnd.pgrst.object')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows' }, 406);
      return json(rows);
    }
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(method, path);
    if (table === 'support_tickets' && method === 'POST') {
      if (Object.keys(body).sort().join(',') !== 'body,id,kind,subject,user_id' || body.user_id !== OWNER || !UUID.test(body.id || '')
        || !['support', 'appeal'].includes(body.kind) || typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 160
        || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 2000) return reject(method, path);
      if (tickets.some(ticket => ticket.id === body.id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
      const ticket = { created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:00Z', status: 'open', ...body };
      tickets.push(ticket);
      // No invented trigger copies ticket.body into history. The current schema
      // and client do not establish such a per-insert backfill.
      audit.mutations.push({ method, table, ticketId: ticket.id }); notify();
      const headers = new Headers(init.headers || input.headers || {});
      return json(headers.get('accept')?.includes('vnd.pgrst.object') ? ticket : [ticket], 201);
    }
    if (table === 'support_messages' && method === 'POST') {
      if (Object.keys(body).sort().join(',') !== 'body,sender,sender_id,ticket_id' || body.ticket_id !== TICKET
        || body.sender !== 'member' || body.sender_id !== OWNER || !body.body) return reject(method, path);
      const ticket = tickets.find(row => row.id === body.ticket_id && row.user_id === body.sender_id);
      if (!ticket) return json({ code: '42501', message: 'SUPPORT_TICKET_UNAVAILABLE' }, 403);
      if (mode === 'message-write-error' || mode === 'status-write-error') return json({ message: 'Controlled atomic reply failure' }, 503);
      messages.push({ id: 'audit-message-' + (messages.length + 1), created_at: '2026-01-02T10:01:00Z', ...body });
      Object.assign(ticket, { status: 'open', updated_at: '2026-01-02T10:01:00Z' });
      audit.mutations.push({ method, table, trigger: 'support_member_reply_reopens_ticket' }); notify(); return json(messages.slice(-1), 201);
    }
    if (table === 'support_tickets' && method === 'PATCH') {
      if (Object.keys(body).sort().join(',') !== 'status,updated_at' || body.status !== 'open' || typeof body.updated_at !== 'string') return reject(method, path);
      if (mode === 'status-write-error') return json({ message: 'Controlled reopen failure' }, 503);
      if (!url.searchParams.has('id')) return reject(method, path);
      tickets.filter(ticket => ticket.id === url.searchParams.get('id').slice(3) && ticket.user_id === OWNER).forEach(ticket => Object.assign(ticket, body));
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
