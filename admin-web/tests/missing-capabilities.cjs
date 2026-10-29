const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.join(__dirname, '..');
function load(file, overrides = {}, globals = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, Date,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), ...globals,
  }, { filename: file });
  return module.exports;
}
const availability = load('lib/adminRpcAvailability.ts');
const reporting = load('lib/supportReporting.ts');
const permissions = load('lib/permissions.ts');
const fmt = load('lib/fmt.ts');
const ticket = { id: 'ticket-1', user_id: 'member-1', kind: 'general', subject: 'My existing support request', status: 'open', created_at: '2026-10-28T10:00:00Z', updated_at: null };
const member = { id: 'member-1', full_name: 'Member One', username: 'member', created_at: '2025-01-01T00:00:00Z' };
const assignment = { ticket_id: ticket.id, assigned_to: 'staff-1', assigned_name: 'Assigned Agent', priority: 'high', queue: 'account', escalated: true, version: 4, response_due_at: '2026-10-29T12:00:00Z' };
const missing = name => ({ code: 'PGRST202', message: `Could not find the function public.${name}() in the schema cache` });

function elements(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, type));
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}
function textOf(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join(' ');
  return textOf(tree.props?.children);
}

function harness({ available = false, rpcError, triageRows, deny = false, tickets = [ticket], failTable } = {}) {
  const requests = [];
  let authorized = false;
  const api = load('lib/supabaseAdmin.ts', { 'server-only': {} }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://admin-fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'server-fixture' } },
    fetch: async (input, init = {}) => {
      assert.equal(authorized, true, 'desk authorization must happen before reads');
      assert.equal(init.cache, 'no-store');
      const url = new URL(input), method = init.method || 'GET';
      requests.push({ url, method });
      const name = url.pathname.split('/').at(-1);
      const send = (body, status = 200, count = Array.isArray(body) ? body.length : 1) => new Response(method === 'HEAD' ? null : JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json', 'content-range': count ? `0-${count - 1}/${count}` : '*/0' },
      });
      if (url.pathname.includes('/rpc/')) {
        const error = rpcError ?? (available ? null : missing(name));
        if (error) return send(error, error.code === '42501' ? 403 : error.code === 'PGRST003' ? 504 : 404);
        if (name === 'admin_support_triage_read') {
          const ids = JSON.parse(init.body).p_ids;
          return send(triageRows ?? ids.map(ticket_id => ({ ...assignment, ticket_id })));
        }
        if (name === 'admin_seller_review_reports') return send({ rows: [], has_more: false, next_cursor: null });
        throw new Error('Unexpected RPC ' + name);
      }
      assert.equal(['GET', 'HEAD'].includes(method), true, 'fallback rendering must be read-only');
      if (name === failTable) return send({ code: '08006', message: 'database connection failed' }, 503);
      const single = new Headers(init.headers).get('accept')?.includes('object+json');
      if (name === 'support_tickets') return send(single ? tickets[0] ?? null : tickets, 200, tickets.length);
      if (name === 'support_messages') return send([{ id: 'message-1', ticket_id: ticket.id, body: 'This message must remain readable.', sender: 'member', created_at: ticket.created_at }]);
      if (name === 'profiles') {
        const people = [member, { id: 'staff-1', full_name: 'Assigned Agent', username: 'agent' }];
        const id = url.searchParams.get('id');
        const selected = id?.startsWith('eq.') ? people.filter(person => person.id === id.slice(3)) : people;
        return send(single ? selected[0] ?? null : selected);
      }
      if (name === 'admin_users') return send([{ user_id: 'staff-1', role: 'support_agent' }]);
      if (['post_reports', 'listing_reports', 'user_reports'].includes(name)) {
        if (url.searchParams.get('status') === 'neq.open' || name === 'user_reports') return send([]);
        return send([{ id: name + '-1', post_id: 'post-1', listing_id: 'listing-1', reporter_id: member.id, reason: 'spam', created_at: ticket.created_at }]);
      }
      if (name === 'posts') return send([{ id: 'post-1', user_id: member.id, content: 'Existing reported post', created_at: ticket.created_at }]);
      if (name === 'marketplace_listings') return send([{ id: 'listing-1', seller_id: member.id, title: 'Existing reported listing', price: 20, status: 'active' }]);
      throw new Error('Unexpected table ' + name);
    },
  });
  const authorize = async () => {
    if (deny) throw new Error('desk denied');
    authorized = true;
    return { id: 'staff-1', sessionId: 'session-1', role: 'super_admin' };
  };
  const triage = load('lib/supportTriage.ts', { 'server-only': {}, './supabaseAdmin': api, './adminRpcAvailability': availability });
  const common = {
    'next/link': { default: 'Link' }, 'next/navigation': { redirect() { throw new Error('redirect'); } },
    '@/lib/adminAuth': { requireDesk: authorize, requirePermission: authorize }, '@/lib/supabaseAdmin': api,
    '@/lib/permissions': permissions, '@/lib/fmt': fmt, '@/lib/supportReporting': reporting, '@/lib/supportTriage': triage,
    '@/lib/adminRpcAvailability': availability, '@/components/Shell': { default: 'Shell' },
    '@/components/CommandForm': { default: 'CommandForm' }, '@/components/PermissionGate': { default: 'PermissionGate' },
    '@/components/Desk': { Desk: 'Desk', StatStrip: 'StatStrip' }, '@/components/ReportsDesk': { default: 'ReportsDesk' },
    '@/components/Viz': { Donut: 'Donut', StackBars: 'StackBars', Empty: 'Empty' },
    '@/lib/actions': { sendTicketReply() { throw new Error('no write'); }, setTicketStatus() { throw new Error('no write'); } },
    '@/lib/supportTriageActions': { updateSupportTriage() { throw new Error('no write'); } },
    './actions': { moderateReview() { throw new Error('no write'); } },
  };
  const render = async file => load(file, common).default({ params: Promise.resolve({ tid: ticket.id }), searchParams: Promise.resolve({}) });
  return { requests, list: () => render('app/support/page.tsx'), detail: () => render('app/support/[tid]/page.tsx'), reviews: () => render('app/market/reviews/page.tsx'), reports: () => render('app/reports/page.tsx') };
}

test('missing assignment capability keeps the inbox and its actual counts readable without invented triage', async () => {
  const h = harness(), tree = await h.list();
  const rows = elements(tree, 'Desk')[0].props.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.title, ticket.subject);
  assert.equal(elements(tree, 'StatStrip')[0].props.cards[0].value, '1');
  assert.match(textOf(tree), /Assignment tools are unavailable on this deployment/);
  assert.deepEqual(Array.from(rows[0].detail.fields, field => field.label), ['Assignment tools', 'Opened', 'Last activity', 'Kind', 'Ticket id']);
  assert.doesNotMatch(JSON.stringify(rows[0].detail.fields), /Unassigned|normal|general|No pending response target/);
  assert.match(rows[0].detail.body[0].text, /remain readable/);
  assert.equal(h.requests.some(request => request.url.pathname.endsWith('/admin_users')), false);
});

test('missing assignment capability leaves the conversation read-only, with no mutation forms or assignment guesses', async () => {
  const h = harness(), tree = await h.detail();
  assert.match(textOf(tree), /This message must remain readable/);
  assert.match(textOf(tree), /Assignment tools are unavailable on this deployment/);
  assert.match(textOf(tree), /This conversation is read-only/);
  assert.equal(elements(tree, 'CommandForm').length, 0);
  assert.equal(elements(tree, 'select').length, 0);
  assert.equal(elements(tree, 'textarea').length, 0);
  assert.equal(h.requests.some(request => request.url.pathname.endsWith('/admin_users')), false);
});

test('available assignments preserve returned ownership, priority and existing permitted forms', async () => {
  const list = await harness({ available: true }).list();
  const fields = elements(list, 'Desk')[0].props.rows[0].detail.fields;
  assert.equal(fields.find(field => field.label === 'Owner').value, assignment.assigned_name);
  assert.equal(fields.find(field => field.label === 'Priority / queue').value, 'high / account / escalated');
  const detail = await harness({ available: true }).detail();
  assert.deepEqual(elements(detail, 'CommandForm').map(form => form.props.scope), ['supportTriage', 'sendTicketReply', 'setTicketStatus']);
  assert.equal(elements(detail, 'select').find(select => select.props.name === 'assigned_to').props.defaultValue, assignment.assigned_to);
  assert.doesNotMatch(textOf(detail), /unavailable on this deployment/);
});

test('real support transport, permission and malformed-response errors do not turn into an unavailable fallback', async () => {
  for (const rpcError of [
    { code: 'PGRST003', message: 'Pool connection timeout' },
    { code: '42501', message: 'permission denied' },
    { code: '42883', message: 'function private_dependency(uuid) does not exist' },
  ]) {
    await assert.rejects(harness({ rpcError }).list(), /Support assignments could not be loaded/);
    await assert.rejects(harness({ rpcError }).detail(), /Support assignments could not be loaded/);
  }
  await assert.rejects(harness({ available: true, triageRows: [{ ...assignment, ticket_id: 'wrong-ticket' }] }).list(), /Support assignments could not be loaded/);
  await assert.rejects(harness({ failTable: 'support_messages' }).detail(), error => error.message === 'database connection failed');
});

test('an empty support page still reports the missing capability instead of assuming assignments exist', async () => {
  const tree = await harness({ tickets: [] }).list();
  assert.equal(elements(tree, 'Desk')[0].props.rows.length, 0);
  assert.match(textOf(tree), /Assignment tools are unavailable on this deployment/);
});

test('missing seller-review capability shows an unavailable pane without review actions or false empty results', async () => {
  const tree = await harness().reviews();
  assert.match(textOf(tree), /Seller review reports and review decisions are unavailable/);
  assert.equal(elements(tree, 'CommandForm').length, 0);
  assert.doesNotMatch(textOf(tree), /No review reports on this page/);
  assert.equal(elements(tree, 'Link')[0].props.href, '/reports');
  await assert.rejects(harness({ rpcError: { code: 'PGRST003', message: 'Pool timeout' } }).reviews(), /Review reports could not be loaded/);
});

test('existing post and listing reports do not depend on the optional seller-review endpoint', async () => {
  const h = harness(), tree = await h.reports();
  const reports = elements(tree, 'ReportsDesk')[0].props.reports;
  assert.equal(reports.length, 2);
  assert.match(reports.find(report => report.kind === 'Post').targetLabel, /Existing reported post/);
  assert.match(reports.find(report => report.kind === 'Listing').targetLabel, /Existing reported listing/);
  assert.equal(h.requests.some(request => request.url.pathname.includes('/rpc/')), false);
});

test('missing capability never bypasses support or review desk authorization', async () => {
  for (const page of ['list', 'detail', 'reviews']) {
    const h = harness({ deny: true });
    await assert.rejects(h[page](), /desk denied/);
    assert.equal(h.requests.length, 0);
  }
});
