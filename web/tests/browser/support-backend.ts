type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
type Session = { user: { id: string }; access_token: string };
type AuthListener = (event: string, session: Session | null) => void;
type AuditState = {
  scenario: string; owner: string | null; sessionId: string; tokenRevision: number;
  tickets: Row[]; messages: Row[]; faults: Row; waits: (() => void)[];
  recovered?: boolean; holdNextList?: boolean; releaseList?: () => void;
  holdNextHistory?: boolean; releaseHistory?: () => void;
};
const scenario = new URLSearchParams(location.search).get('scenario') || 'ok';
const writes: Row[] = [], reads: Row[] = [], listeners = new Set<AuthListener>();
const state: AuditState = { scenario, owner: 'member-a', sessionId: 'session-1', tokenRevision: 0, tickets: [], messages: [], faults: {}, waits: [] };
const session = () => state.owner ? { user: { id: state.owner }, access_token: 'synthetic.' + btoa(JSON.stringify({ sub: state.owner, session_id: state.sessionId, exp: 4102444800 })) + '.' + state.tokenRevision } : null;
const requestOwner = (headers: Record<string, string>) => headers.Authorization ? JSON.parse(atob(headers.Authorization.split('.')[1])).sub : state.owner;
const ticket = (id = 'ticket-a') => ({ id, user_id: 'member-a', kind: 'support', subject: id === 'ticket-b' ? 'Ticket B' : 'Ticket A', body: 'Private support question', status: scenario === 'status-error' ? 'solved' : 'open', created_at: '2026-10-31T12:00:00Z', updated_at: null });
state.tickets = [ticket()];
state.messages = [{ id: 'message-a', ticket_id: 'ticket-a', sender: 'staff', body: 'Existing staff reply', created_at: '2026-10-31T12:01:00Z' }];
if (scenario === 'signed-out') state.owner = null;
const failure = (message: string) => ({ data: null, error: { message, code: 'AUDIT_INJECTED' } });
class Query {
  table: string; operation = 'select'; values: Row = {}; filters: Row = {}; one = false; headers: Record<string, string> = {};
  setHeader(name: string, value: string) { this.headers[name] = value; return this; }
  constructor(table: string) { this.table = table; }
  select() { return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = true; return this; }
  single() { this.one = true; return this; }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this; }
  update(values: Row) { this.operation = 'update'; this.values = values; return this; }
  abortSignal() { return this; }
  async execute(): Promise<Result> {
    const mode = state.recovered ? 'ok' : scenario;
    const row = { table: this.table, operation: this.operation, values: this.values, filters: { ...this.filters }, owner: requestOwner(this.headers), headers: { ...this.headers } };
    if (this.operation !== 'select') {
      writes.push(row);
      if (mode === 'write-reject') return failure('The test server rejected the write.');
      if (mode === 'write-throw') throw new Error('Injected transport rejection');
      if (mode === 'write-held') await new Promise<void>(resolve => state.waits.push(resolve));
      if (this.operation === 'update' && mode === 'status-error') return failure('Ticket status update failed.');
      if (this.table === 'support_tickets' && this.operation === 'insert') {
        if (state.tickets.some((ticket: Row) => ticket.id === this.values.id)) return { data: null, error: { code: '23505', message: 'Duplicate request identity' } };
        state.tickets.unshift({ ...ticket('ticket-new'), ...this.values });
        if (mode === 'write-lost') throw new Error('Response lost after commit');
        return { data: this.one ? state.tickets[0] : [state.tickets[0]], error: null };
      }
      if (this.table === 'support_messages' && this.operation === 'insert') state.messages.push({ id: 'message-' + writes.length, ...this.values, created_at: '2026-10-31T12:02:00Z' });
      if (this.table === 'support_tickets' && this.operation === 'update') state.tickets = state.tickets.map((t: Row) => t.id === this.filters.id ? { ...t, ...this.values } : t);
      return { data: null, error: null };
    }
    reads.push(row);
    if (this.table === 'profiles') return { data: { deactivated_at: null }, error: null };
    if (mode === 'read-held') await new Promise<void>(resolve => state.waits.push(resolve));
    if (this.table === 'support_tickets' && (mode === 'list-error' || mode === 'ticket-error')) return failure('The ticket read failed.');
    if (this.table === 'support_messages' && mode === 'messages-error') return failure('The message read failed.');
    if (this.table === 'support_tickets') {
      if (mode === 'missing-ticket') return { data: null, error: null };
      const rows = state.tickets.filter((t: Row) => (!this.filters.id || t.id === this.filters.id) && (!this.filters.user_id || t.user_id === this.filters.user_id)).map((row: Row) => ({ ...row }));
      if (!this.one && state.holdNextList) { state.holdNextList = false; await new Promise<void>(resolve => { state.releaseList = resolve; }); }
      return { data: this.one ? rows[0] ?? null : rows, error: null };
    }
    if (this.table === 'support_messages') {
      const rows = state.messages.filter((m: Row) => m.ticket_id === this.filters.ticket_id).map((row: Row) => ({ ...row }));
      if (state.holdNextHistory) { state.holdNextHistory = false; await new Promise<void>(resolve => { state.releaseHistory = resolve; }); }
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  }
  then<TResult1 = Result, TResult2 = never>(resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return this.execute().then(resolve, reject); }
}
async function rpcResult(name: string, args: Row, headers: Record<string, string>): Promise<Result> {
    const owner = requestOwner(headers);
    const mode = state.recovered ? 'ok' : scenario;
    writes.push({ table: 'rpc', operation: name, values: { ...args }, owner, headers: { ...headers } });
    if (name !== 'send_member_support_reply') return failure('Unknown exact RPC contract');
    if (mode === 'rpc-missing') return { data: null, error: { code: 'PGRST202', message: 'Function not available' } };
    if (mode === 'write-reject') return failure('The test server rejected the reply.');
    if (mode === 'write-throw') throw new Error('Injected transport rejection');
    if (mode === 'status-error') return failure('Atomic ticket reopening failed; transaction rolled back.');
    if (mode === 'write-held') await new Promise<void>(resolve => state.waits.push(resolve));
    if (args.p_expected_user !== owner) return failure('SUPPORT_ACCOUNT_CHANGED');
    const selected = state.tickets.find((ticket: Row) => ticket.id === args.p_ticket_id && ticket.user_id === owner);
    if (!selected) return failure('SUPPORT_TICKET_UNAVAILABLE');
    let message = state.messages.find((message: Row) => message.id === args.p_request_id);
    const replayed = !!message;
    if (message && (message.ticket_id !== args.p_ticket_id || message.sender_id !== owner || message.body !== args.p_body)) return failure('SUPPORT_REQUEST_CONFLICT');
    if (!message) {
      message = { id: args.p_request_id, ticket_id: args.p_ticket_id, sender: 'member', sender_id: owner, body: args.p_body, created_at: '2026-10-31T12:02:00Z' };
      state.messages.push(message); selected.status = 'open';
      if (mode === 'write-lost') throw new Error('Response lost after commit');
    }
    return { data: { message_id: message.id, ticket_id: message.ticket_id, sender_id: message.sender_id, body: message.body, created_at: message.created_at, ticket_status: selected.status, replayed }, error: null };
}
class RpcQuery {
  headers: Record<string, string> = {};
  constructor(public name: string, public args: Row) {}
  setHeader(name: string, value: string) { this.headers[name] = value; return this; }
  abortSignal() { return this; }
  then<TResult1 = Result, TResult2 = never>(resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return rpcResult(this.name, this.args, this.headers).then(resolve, reject); }
}
const client = {
  from(table: string) { return new Query(table); },
  rpc(name: string, args: Row) { return new RpcQuery(name, args); },
  auth: {
    getUser: async () => ({ data: { user: state.owner ? { id: state.owner } : null }, error: null }),
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange(callback: AuthListener) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  },
};
export function createClient() { return client; }
const audit = { state, writes, reads, recover() { state.recovered = true; }, release() { const waits = state.waits.splice(0); waits.forEach(fn => fn()); }, changeOwner(owner: string | null) { state.owner = owner; state.sessionId = 'session-' + (++state.tokenRevision); listeners.forEach(fn => fn(owner ? 'SIGNED_IN' : 'SIGNED_OUT', session())); }, refresh() { state.tokenRevision++; listeners.forEach(fn => fn('TOKEN_REFRESHED', session())); }, listenerCount() { return listeners.size; } };

Object.assign(window, { __supportAudit: audit });
