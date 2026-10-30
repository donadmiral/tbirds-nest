/** Local verification only: synthetic records, no credentials and no network transport. */
import type { SupabaseClient } from '@supabase/supabase-js';
type FixtureRow = Record<string, unknown>;
type FixtureError = { message: string; code?: string };
type QueryResult = { data: FixtureRow | FixtureRow[] | null; count: number | null; error: FixtureError | null };
type QueryOptions = { head?: boolean; count?: string };
type Profile = { id: string; full_name: string; username: string; avatar_url: string | null; location: string; created_at: string; account_type: string; is_verified: boolean };
type Order = { id: string; listing_id: string; buyer_id: string; seller_id: string; conversation_id: string; title: string; image_url: string; quantity: number; unit_minor: string; delivery_minor: string; total_minor: string; currency: string; fulfilment: string; instructions: string; status: string; reservation: string; payment_id: string | null; version: number; created_at: string; updated_at: string; expires_at: string | null };
export const OWNER = '10000000-0000-4000-8000-000000000001';
export const SELLER = '10000000-0000-4000-8000-000000000002';
export const SECOND = '10000000-0000-4000-8000-000000000003';
export const JOB = '20000000-0000-4000-8000-000000000001';
export const LISTING = '30000000-0000-4000-8000-000000000001';
const date = '2026-10-28T10:00:00Z';
export const profiles: Record<string, Profile> = {
  [OWNER]: { id: OWNER, full_name: 'Avery Lane', username: 'avery_lane', avatar_url: null, location: 'Cape Town', created_at: '2026-01-02T10:00:00Z', account_type: 'personal', is_verified: false },
  [SELLER]: { id: SELLER, full_name: 'Jordan Ellis', username: 'jordan_ellis', avatar_url: null, location: 'Cape Town', created_at: '2026-01-02T10:00:00Z', account_type: 'business', is_verified: false },
  [SECOND]: { id: SECOND, full_name: 'Casey Morgan', username: 'casey_morgan', avatar_url: null, location: 'New York', created_at: '2026-01-02T10:00:00Z', account_type: 'personal', is_verified: false },
};
export const jobs = ['Product Designer', 'Senior Product Designer', 'Brand Design Intern', 'Community Producer', 'Design Systems Engineer', 'Creative Director'].map((title, index) => ({
  id: '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), posted_by: SELLER, title,
  company: ['Northline Studio', 'Tideway Labs', 'Evermind Studio', 'City Walks', 'Crestline', 'Atlas Collective'][index],
  location: index === 2 ? 'New York' : 'Cape Town', category: index === 2 ? 'internship' : 'full_time', remote_type: index % 2 ? 'remote' : 'hybrid', job_type: 'Full time',
  salary_range: index === 2 ? 'Paid internship' : '$80,000–$110,000 USD / year', description: 'Design experiences that help people connect.\n\nAbout the role\nWork with a thoughtful product team to turn complex problems into clear, useful interfaces.\n\nYour responsibilities\n• Explore and refine new product experiences\n• Collaborate with design, engineering and research\n• Build accessible, consistent interaction patterns\n\nWhat you bring\nA strong portfolio, clear communication, and care for the people using your work.',
  benefits: 'Flexible working hours\nLearning and development support\nA collaborative, inclusive team', industry: 'Design and technology', experience_level: 'mid', urgent: index === 4, visa_sponsorship: false, verified: false, applications_count: 3 + index, apply_url: null, deadline: null, created_at: date,
}));
export const listings = ['Arc Desk Lamp', 'Ridge Planter', 'Field Clock', 'Studio Headphones', 'Everyday Travel Pack', 'Linen Lounge Chair'].map((title, index) => ({
  id: '30000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), seller_id: index === 5 ? OWNER : SELLER, title,
  price: [68, 38, 44, 129, 89, 240][index], currency: 'USD', category: index === 3 ? 'Electronics' : index === 4 ? 'Fashion' : 'Home', condition: index % 2 ? 'Like New' : 'New', location_city: 'Cape Town', images: ['/product-' + index + '.svg', '/detail-' + index + '.svg'], stock_quantity: 8, status: 'available', delivery_available: true, delivery_fee: 6, delivery_note: 'Local delivery by arrangement.',
  description: 'Considered details for everyday living. Carefully kept and ready for a new home.\n\nMessage the seller with any questions about the item or collection. The photos show this listing.', created_at: date,
  seller: profiles[index === 5 ? OWNER : SELLER],
}));
const applications = [{ id: '40000000-0000-4000-8000-000000000001', job_id: jobs[1].id, applicant_id: OWNER, status: 'interview', applied_at: date, updated_at: date, interview_at: '2026-11-12T09:00:00Z', interview_location: 'Video conversation', job: jobs[1] }];
const orders: Order[] = [{ id: '50000000-0000-4000-8000-000000000001', listing_id: listings[1].id, buyer_id: OWNER, seller_id: SELLER, conversation_id: 'market-order-conversation', title: listings[1].title, image_url: listings[1].images[0], quantity: 1, unit_minor: '3800', delivery_minor: '0', total_minor: '3800', currency: 'USD', fulfilment: 'pickup', instructions: 'Pickup this weekend.', status: 'ready', reservation: 'reserved', payment_id: 'payment-fixture', version: 2, created_at: date, updated_at: date, expires_at: null }];
let owner: string | null = OWNER;
const listeners = new Set<(event: string, value: ReturnType<typeof session>) => void>();
const user = () => owner ? { id: owner, email: 'synthetic@example.invalid', email_confirmed_at: date } : null;
const session = () => owner ? { user: user(), access_token: 'synthetic-only-no-live-access' } : null;
const jobSaves: FixtureRow[] = [{ user_id: OWNER, job_id: jobs[2].id }], listingSaves: FixtureRow[] = [{ user_id: OWNER, listing_id: listings[1].id }], alerts: FixtureRow[] = [];
const requests = new Map<string, Order>();
const receipt: FixtureRow[] = [];
const faults = { jobsRead: false, jobSave: false, applicationsRead: false, applicationWrite: false, upload: false, marketRead: false, orderLostOnce: false, orderAction: false, offer: false, dm: false, alertsRead: false, alertsWrite: false, auth: false, delayWrite: 0 };
export const fixture = { receipt, faults, jobs, listings, applications, orders, owner: () => owner,
  switchOwner(id: string | null) { owner = id; listeners.forEach(listener => listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', session())); window.dispatchEvent(new Event('fixture-owner')); },
  clear() { receipt.length = 0; },
};
declare global { interface Window { __commerceFixture: typeof fixture } }
if (typeof window !== 'undefined') window.__commerceFixture = fixture;
class Query implements PromiseLike<QueryResult> {
  filters: [string, string, unknown][] = []; cols = '*'; options: QueryOptions = {}; one = false; operation = 'select'; values: FixtureRow = {}; maximum = Infinity; sorts: [string, boolean][] = [];
  constructor(public table: string) {}
  select(cols = '*', options: QueryOptions = {}) { this.cols = cols; this.options = options; return this; }
  update(value: FixtureRow) { this.operation = 'update'; this.values = value; return this; }
  insert(value: FixtureRow) { this.operation = 'insert'; this.values = value; return this; }
  upsert(value: FixtureRow) { this.operation = 'upsert'; this.values = value; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(key: string, value: unknown) { this.filters.push(['eq', key, value]); return this; }
  neq(key: string, value: unknown) { this.filters.push(['neq', key, value]); return this; }
  ilike(key: string, value: unknown) { this.filters.push(['ilike', key, value]); return this; }
  in(key: string, value: unknown) { this.filters.push(['in', key, value]); return this; }
  gte(key: string, value: unknown) { this.filters.push(['gte', key, value]); return this; }
  lte(key: string, value: unknown) { this.filters.push(['lte', key, value]); return this; }
  is() { return this; } gt() { return this; } lt() { return this; } or() { return this; }
  order(key: string, { ascending = false }: { ascending?: boolean } = {}) { this.sorts.push([key, ascending]); return this; }
  limit(count: number) { this.maximum = count; return this; } range() { return this; } abortSignal() { return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  async execute(): Promise<QueryResult> {
    const initialOwner = owner;
    const map: Record<string, FixtureRow[]> = { profiles: Object.values(profiles), jobs, job_applications: applications, job_saves: jobSaves, saved_listings: listingSaves, marketplace_listings: listings, market_alerts: alerts };
    const all = map[this.table] ?? [];
    let rows = all.filter(row => this.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value : op === 'in' ? Array.isArray(value) && value.includes(row[key]) : op === 'ilike' ? String(row[key]).toLowerCase().includes(String(value).replace(/[%\\]/g, '').toLowerCase()) : op === 'gte' ? Number(row[key]) >= Number(value) : op === 'lte' ? Number(row[key]) <= Number(value) : true));
    const fail = (message: string) => ({ data: null, count: null, error: { message } });
    if (this.operation === 'select') {
      if (this.table === 'jobs' && faults.jobsRead) return fail('Synthetic jobs read failure');
      if (this.table === 'marketplace_listings' && faults.marketRead) return fail('Synthetic listing read failure');
      if (this.table === 'market_alerts' && faults.alertsRead) return fail('Synthetic alerts read failure');
    } else {
      const write = { table: this.table, operation: this.operation, owner: initialOwner, filters: this.filters, values: this.values, completed: false }; receipt.push(write);
      if (faults.delayWrite) await new Promise(resolve => setTimeout(resolve, faults.delayWrite));
      if (initialOwner !== owner) { write.completed = true; return fail('Synthetic account changed'); }
      if (this.table === 'job_saves' && faults.jobSave) { write.completed = true; return fail('Synthetic save failure'); }
      if (this.table === 'job_applications' && faults.applicationWrite) { write.completed = true; return fail('Synthetic application failure'); }
      if (this.table === 'market_alerts' && faults.alertsWrite) { write.completed = true; return fail('Synthetic alert failure'); }
      if (this.operation === 'delete') { rows.forEach(row => { const index = all.indexOf(row); if (index >= 0) all.splice(index, 1); }); }
      else if (this.operation === 'update') rows.forEach(row => Object.assign(row, this.values));
      else {
        const row: FixtureRow = { id: crypto.randomUUID(), created_at: date, applied_at: date, updated_at: date, ...this.values };
        if (this.table === 'job_applications') row.job = jobs.find(job => job.id === row.job_id);
        all.push(row); rows = [row];
      }
      write.completed = true;
    }
    for (const [key, asc] of [...this.sorts].reverse()) rows.sort((a, b) => {
      const left = typeof a[key] === 'number' ? a[key] as number : String(a[key] ?? '');
      const right = typeof b[key] === 'number' ? b[key] as number : String(b[key] ?? '');
      return (left < right ? -1 : left > right ? 1 : 0) * (asc ? 1 : -1);
    });
    const count = rows.length; rows = rows.slice(0, this.maximum);
    return { data: this.options.head ? null : this.one ? rows[0] ?? null : [...rows], count, error: null };
  }
  then<A = QueryResult, B = never>(onFulfilled?: ((value: QueryResult) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> { return this.execute().then(onFulfilled, onRejected); }
}
async function rpc(name: string, args: FixtureRow) {
  const initialOwner = owner; receipt.push({ rpc: name, args: structuredClone(args), owner: initialOwner });
  let data: unknown = [], error: FixtureError | null = null;
  if (name === 'get_market_feed') { if (faults.marketRead) error = { message: 'Synthetic market failure' }; data = listings.filter(row => row.status === 'available' && (!args.p_category || row.category === args.p_category) && (!args.p_search || row.title.toLowerCase().includes(String(args.p_search).toLowerCase()))).map(row => ({ id: row.id })); }
  else if (name === 'my_application_page') { data = { applications: applications.filter(row => row.applicant_id === owner && (args.p_status === 'all' || row.status === args.p_status)), cursor: null, has_more: false }; if (faults.applicationsRead) error = { message: 'Synthetic application read failure' }; }
  else if (name === 'withdraw_job_application') { const row = applications.find(row => row.id === args.p_application && row.applicant_id === owner); if (!row || row.status !== args.p_expected_status) error = { code: '40001', message: 'Changed' }; else { row.status = 'withdrawn'; row.updated_at = new Date().toISOString(); data = { ...row }; } }
  else if (name === 'get_market_orders') data = { rows: orders.filter(row => (row.buyer_id === owner || row.seller_id === owner) && (!args.p_listing_id || row.listing_id === args.p_listing_id)).map(row => ({ ...row, events: undefined })), next_cursor: null, has_more: false };
  else if (name === 'create_market_order') {
    if (faults.delayWrite) await new Promise(resolve => setTimeout(resolve, faults.delayWrite));
    if (!owner || owner !== initialOwner || args.p_expected_user !== owner) return { data: null, error: { message: 'ACCOUNT_CHANGED', code: '42501' } };
    const requestKey = String(args.p_request_key);
    if (!requests.has(requestKey)) {
      const listing = listings.find(row => row.id === args.p_listing_id)!;
      const row: Order = { id: crypto.randomUUID(), buyer_id: owner, seller_id: listing.seller_id, listing_id: listing.id, conversation_id: 'order-' + orders.length, title: listing.title, image_url: listing.images[0], quantity: Number(args.p_quantity), unit_minor: String(listing.price * 100), delivery_minor: String(args.p_fulfilment === 'delivery' ? 600 : 0), total_minor: String(listing.price * 100 * Number(args.p_quantity) + (args.p_fulfilment === 'delivery' ? 600 : 0)), currency: listing.currency, fulfilment: String(args.p_fulfilment), instructions: String(args.p_instructions ?? ''), status: 'requested', version: 1, reservation: 'none', payment_id: null, expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; requests.set(requestKey, row); orders.push(row);
    }
    data = requests.get(requestKey);
    if (faults.orderLostOnce) { faults.orderLostOnce = false; throw new Error('Synthetic response lost after persistence'); }
  }
  else if (name === 'market_order_action') { if (faults.orderAction) error = { message: 'Synthetic order update failure' }; else { const order = orders.find(row => row.id === args.p_id); if (order && order.version === args.p_version) { order.status = args.p_action === 'complete' ? 'completed' : args.p_action === 'cancel' ? 'cancelled' : String(args.p_action); order.version++; data = { ...order }; } else error = { message: 'ORDER_CHANGED_REFRESH' }; } }
  else if (name === 'get_market_order') { const order = orders.find(row => row.id === args.p_id); data = order ? { ...order, events: [{ id: 1, kind: 'order_requested', note: 'Synthetic order request', created_at: date }, { id: 2, kind: 'seller_confirmed', note: '', created_at: date }] } : null; }
  else if (name === 'start_dm_ctx') { data = args.p_context + '-conversation'; if (faults.dm) error = { message: 'Synthetic conversation failure' }; }
  else if (name === 'make_offer') { if (faults.delayWrite) await new Promise(resolve => setTimeout(resolve, faults.delayWrite)); data = 'offer-fixture'; if (faults.offer) error = { message: 'Synthetic offer failure' }; }
  else if (name === 'seller_review_page') data = { rows: [], summary: { avg_rating: 0, review_count: 0 }, eligible_orders: [], has_more: false, next_cursor: null };
  else if (name === 'get_seller_rating') data = { avg_rating: 0, review_count: 0 };
  else if (name === 'report_market_listing') data = 'report-fixture';
  return { data, error };
}
const client = {
  auth: { getSession: async () => ({ data: { session: session() }, error: faults.auth ? { message: 'Synthetic auth error' } : null }), getUser: async () => ({ data: { user: user() }, error: faults.auth ? { message: 'Synthetic auth error' } : null }), onAuthStateChange(callback: (event: string, value: ReturnType<typeof session>) => void) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; }, signOut: async () => { fixture.switchOwner(null); return { error: null }; } },
  from: (table: string) => new Query(table),
  rpc: (name: string, args: FixtureRow = {}) => { const result = Object.assign(rpc(name, args), { abortSignal: () => result }); return result; },
  storage: { from: (bucket: string) => ({ upload: async (key: string, file: File) => { receipt.push({ operation: 'upload', bucket, key, owner, file: file.name }); if (faults.delayWrite) await new Promise(resolve => setTimeout(resolve, faults.delayWrite)); return { data: { path: key }, error: faults.upload ? { message: 'Synthetic upload error' } : null }; }, getPublicUrl: () => ({ data: { publicUrl: '/product-0.svg' } }) }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: async () => {}, functions: { invoke: async () => ({ data: null, error: null }) },
};
export const createClient = () => client as unknown as SupabaseClient;
