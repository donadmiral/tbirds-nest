type Row = Record<string, any>;
const scenario = new URLSearchParams(location.search).get('scenario') || 'ok';
const writes: Row[] = [], reads: Row[] = [], listeners = new Set<Function>();
const state: Row = { scenario, owner: 'member-a', tickets: [], messages: [], faults: {}, waits: [] };
const ticket = (id = 'ticket-a') => ({ id, user_id: 'member-a', kind: 'support', subject: id === 'ticket-b' ? 'Ticket B' : 'Ticket A', body: 'Private support question', status: scenario === 'status-error' ? 'solved' : 'open', created_at: '2026-10-31T12:00:00Z', updated_at: null });
state.tickets = [ticket()];
state.messages = [{ id: 'message-a', ticket_id: 'ticket-a', sender: 'staff', body: 'Existing staff reply', created_at: '2026-10-31T12:01:00Z' }];
if (scenario === 'signed-out') state.owner = null;
const failure = (message: string) => ({ data: null, error: { message, code: 'AUDIT_INJECTED' } });
class Query {
  table: string; operation = 'select'; values: any = null; filters: Row = {}; single = false;
  constructor(table: string) { this.table = table; }
  select() { return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }
  singleResult() { this.single = true; return this; }
  insert(values: unknown) { this.operation = 'insert'; this.values = values; return this; }
  update(values: unknown) { this.operation = 'update'; this.values = values; return this; }
  abortSignal() { return this; }
  async execute() {
    const row = { table: this.table, operation: this.operation, values: this.values, filters: { ...this.filters }, owner: state.owner };
    if (this.operation !== 'select') {
      writes.push(row);
      if (scenario === 'write-reject') return failure('The test server rejected the write.');
      if (scenario === 'write-throw') throw new Error('Injected transport rejection');
      if (scenario === 'write-held') await new Promise<void>(resolve => state.waits.push(resolve));
      if (this.operation === 'update' && scenario === 'status-error') return failure('Ticket status update failed.');
      if (this.table === 'support_tickets' && this.operation === 'insert') state.tickets.unshift({ ...ticket('ticket-new'), ...this.values });
      if (this.table === 'support_messages' && this.operation === 'insert') state.messages.push({ id: 'message-' + writes.length, ...this.values, created_at: '2026-10-31T12:02:00Z' });
      if (this.table === 'support_tickets' && this.operation === 'update') state.tickets = state.tickets.map((t: Row) => t.id === this.filters.id ? { ...t, ...this.values } : t);
      return { data: null, error: null };
    }
    reads.push(row);
    if (this.table === 'profiles') return { data: { deactivated_at: null }, error: null };
    if (scenario === 'read-held') await new Promise<void>(resolve => state.waits.push(resolve));
    if (this.table === 'support_tickets' && (scenario === 'list-error' || scenario === 'ticket-error')) return failure('The ticket read failed.');
    if (this.table === 'support_messages' && scenario === 'messages-error') return failure('The message read failed.');
    if (this.table === 'support_tickets') {
      if (scenario === 'missing-ticket') return { data: null, error: null };
      const rows = state.tickets.filter((t: Row) => !this.filters.id || t.id === this.filters.id);
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    }
    if (this.table === 'support_messages') return { data: state.messages.filter((m: Row) => m.ticket_id === this.filters.ticket_id), error: null };
    return { data: [], error: null };
  }
  then(resolve: Function, reject: Function) { return this.execute().then(resolve as any, reject as any); }
}
const client = {
  from(table: string) { return new Query(table); },
  auth: {
    getUser: async () => ({ data: { user: state.owner ? { id: state.owner } : null }, error: null }),
    getSession: async () => ({ data: { session: state.owner ? { user: { id: state.owner }, access_token: 'synthetic-only' } : null }, error: null }),
    onAuthStateChange(callback: Function) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  },
};
export function createClient() { return client; }
(window as any).__supportAudit = { state, writes, reads, release() { const waits = state.waits.splice(0); waits.forEach((fn: Function) => fn()); }, changeOwner(owner: string | null) { state.owner = owner; listeners.forEach(fn => fn(owner ? 'SIGNED_IN' : 'SIGNED_OUT', owner ? { user: { id: owner } } : null)); }, listenerCount() { return listeners.size; } };
