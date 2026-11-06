import { isOrderId } from '@/lib/marketOrders';
import { requestTime } from '@/lib/requestTime';
import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemoveListing } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { pickMedia, pickAllMedia, resolveMedia, isVideoUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  bag: 'market',
  money: 'payment',
  check: 'check',
  users: 'users',
  flag: 'reports',
} as const;

const SERIES = ['var(--c2)', 'var(--c1)', 'var(--c3)', 'var(--c4)', 'var(--c6)', 'var(--c5)'];
const STATUS_TONE: Record<string, Tone> = { available: 'ok', active: 'ok', sold: 'neutral', pending: 'warn', reserved: 'warn', removed: 'bad', draft: 'neutral' };

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function money(n: number, currency?: unknown) { return (String(currency || '').trim() || 'Currency not recorded') + ' ' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default async function MarketPage({ searchParams }: {
  searchParams: Promise<{ q?: string; before?: string; id?: string }>;
}) {
  const admin = await requireDesk('/market');
  const svc = serviceClient();

  const now = await requestTime();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q.trim() : '';
  const before = typeof params.before === 'string' && /^\d{4}-\d\d-\d\dT/.test(params.before)
    && Number.isFinite(Date.parse(params.before)) && typeof params.id === 'string' && isOrderId(params.id) ? params.before : null;
  const invalid = search.length > 100 || (search.length > 0 && search.length < 3);
  const [listRes, totalRes] = await Promise.all([
    invalid ? Promise.resolve({data: [], error: null}) : svc.rpc('admin_market_catalog_page_v1', {
      p_before: before, p_id: before ? params.id : null, p_search: search,
    }),
    svc.from('marketplace_listings').select('id', { count: 'estimated', head: true }),
  ]);
  if (listRes.error || totalRes.error) throw new Error('Marketplace records could not be loaded. Please retry.');
  type Listing = Record<string, unknown> & { id: string; created_at: string; _report_summary: { open: number; total: number; reasons: string[] } };
  const page = (listRes.data ?? []) as Listing[];
  const listings = page.slice(0, 100);
  const last = listings.at(-1);
  const next = page.length > 100 && last ? '/market?' + new URLSearchParams({ q: search, before: last.created_at, id: last.id }) : null;
  const urlMap = await resolveMedia(listings.map(l => pickMedia(l)));

  const uids = Array.from(new Set(listings.map(l => String(l.seller_id || '')).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; location: string | null; is_verified: boolean }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url, location, is_verified').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; location: string | null; is_verified: boolean }) => { people[p.id] = p; });
  }

  const reportsByListing = Object.fromEntries(listings.map(l => [l.id, l._report_summary]));

  const priceOf = (l: Record<string, unknown>) => Number(l.price) || 0;
  const statusOf = (l: Record<string, unknown>) => String(l.status || 'unknown').toLowerCase();

  const available = listings.filter(l => ['available', 'active'].includes(statusOf(l)));
  const sold = listings.filter(l => statusOf(l) === 'sold');
  const flagged = listings.filter(l => (reportsByListing[String(l.id)]?.open || 0) > 0).length;
  const sellers = new Set(listings.map(l => String(l.seller_id))).size;

  const new7 = listings.filter(l => String(l.created_at) >= from7).length;
  const newPrev7 = listings.filter(l => String(l.created_at) >= from14 && String(l.created_at) < from7).length;
  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };
  const d7 = pct(new7, newPrev7);

  const spark = days30.map(d => listings.filter(l => String(l.created_at).slice(0, 10) === d).length);
  const dayRows = days30.map(d => ({
    day: d,
    listed: listings.filter(l => String(l.created_at).slice(0, 10) === d).length,
  } as Record<string, number | string>));

  const catCount: Record<string, number> = {};
  listings.forEach(l => {
    const c = String(l.category || l.kind || 'uncategorised').trim() || 'uncategorised';
    catCount[c] = (catCount[c] || 0) + 1;
  });
  const catSlices: Slice[] = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]).slice(0, 6)
    .map((k, i) => ({ label: title(k), value: catCount[k], color: SERIES[i % SERIES.length] }));

  const cards = [
    { label: 'Estimated listings on file', value: totalRes.count === null ? 'Unavailable' : fmt(totalRes.count), note: 'Across the marketplace', icon: IC.bag, color: 'var(--c1)', spark },
    { label: 'Listed this week', value: fmt(new7), delta: d7.text, deltaTone: d7.tone, note: 'within the loaded listing sample', icon: IC.bag, color: 'var(--c2)', spark: spark.slice(-14) },
    { label: 'Available listings', value: fmt(available.length), note: 'on this page', icon: IC.money, color: 'var(--c3)' },
    { label: 'Marked sold', value: fmt(sold.length), note: 'on this page', icon: IC.check, color: 'var(--c6)' },
    { label: 'Carrying reports', value: fmt(flagged), note: fmt(sellers) + ' sellers on this page', icon: IC.flag, color: 'var(--c5)' },
  ];

  const rows: DeskRow[] = listings.map(l => {
    const id = String(l.id);
    const sid = String(l.seller_id || '');
    const s = people[sid] || { full_name: null, username: null, avatar_url: null, location: null, is_verified: false };
    const raw = pickMedia(l);
    const url = raw ? urlMap[raw] || null : null;
    const video = isVideoUrl(raw);
    const status = statusOf(l);
    const rep = reportsByListing[id];
    const price = priceOf(l);
    const desc = String(l.description || l.body || '').trim();
    const cat = String(l.category || l.kind || '').trim();
    const photos = pickAllMedia(l);

    const fields = [
      { label: 'Listing id', value: id },
      { label: 'Price', value: money(price,l.currency) },
      { label: 'Status', value: title(status) },
      { label: 'Seller', value: (s.full_name || 'Unnamed') + ' (@' + (s.username || 'member') + ')' },
      { label: 'Listed', value: new Date(String(l.created_at)).toLocaleString() },
      { label: 'Photos', value: String(photos.length) },
    ];
    if (cat) fields.splice(2, 0, { label: 'Category', value: title(cat) });
    ['condition', 'location', 'currency', 'quantity', 'brand', 'delivery', 'negotiable', 'views_count', 'likes_count'].forEach(k => {
      const v = l[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') fields.push({ label: title(k), value: String(v) });
    });
    if (rep?.total) fields.push({ label: 'Reports', value: rep.open + ' open of ' + rep.total + ' total' });

    return {
      id,
      tabs: [
        ['available', 'active'].includes(status) ? 'available' : status === 'sold' ? 'sold' : 'other',
        ...(rep?.open ? ['reported'] : []),
        ...(photos.length ? ['withphoto'] : ['nophoto']),
      ],
      search: [l.title, desc, cat, s.full_name, s.username, status].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { status: title(status), category: cat ? title(cat) : 'Uncategorised' },
      cells: [
        { t: 'media', v: String(l.title || 'Untitled listing'), sub: cat ? title(cat) : 'uncategorised', thumb: url, video },
        { t: 'mono', v: money(price,l.currency) },
        { t: 'pill', v: rep?.open ? 'Reported' : title(status), tone: rep?.open ? 'bad' : (STATUS_TONE[status] || 'neutral') },
        { t: 'user', v: s.full_name || 'Unnamed', sub: '@' + (s.username || 'member'), img: s.avatar_url },
        { t: 'dim', v: s.location || '-' },
        { t: 'mono', v: ago(String(l.created_at)) },
      ],
      detail: {
        title: String(l.title || 'Untitled listing'),
        subtitle: money(price,l.currency) + (cat ? ' \u00b7 ' + title(cat) : '') + ' \u00b7 ' + ago(String(l.created_at)),
        img: s.avatar_url,
        media: url ? { url, video } : null,
        pills: [
          { v: title(status), tone: STATUS_TONE[status] || 'neutral' },
          ...(rep?.open ? [{ v: rep.open + ' open reports', tone: 'bad' as Tone }] : []),
          ...(s.is_verified ? [{ v: 'Verified seller', tone: 'ok' as Tone }] : []),
        ],
        stats: [
          { label: 'Price', value: money(price,l.currency) },
          { label: 'Photos', value: String(photos.length) },
          { label: 'Reports', value: String(rep?.total || 0) },
        ],
        fields,
        body: [
          ...(desc ? [{ label: 'Description', text: desc }] : []),
          ...(rep && rep.reasons.length ? [{ label: 'Recent report reasons', text: Array.from(new Set(rep.reasons)).join('\n') }] : []),
        ],
        links: [
          { label: 'Open seller', href: '/users/' + sid },
          ...(rep?.open ? [{ label: 'Open reports desk', href: '/reports' }] : []),
        ],
      },
      actions: ['remove'],
      actionId: id,
    };
  });

  const tabs = [
    { key: 'all', label: 'All listings', count: rows.length },
    { key: 'available', label: 'Available', count: rows.filter(r => r.tabs.includes('available')).length },
    { key: 'sold', label: 'Sold', count: rows.filter(r => r.tabs.includes('sold')).length },
    { key: 'reported', label: 'Reported', count: rows.filter(r => r.tabs.includes('reported')).length },
    { key: 'nophoto', label: 'No photo', count: rows.filter(r => r.tabs.includes('nophoto')).length },
  ];

  return (
    <Shell admin={admin} active="/market" title="Market" sub="Review marketplace listings, sellers and reports. Removing a listing takes it off the market everywhere.">
      <Link href="/market/reviews" className="mr-5 mb-4 inline-block underline">Review reported seller ratings</Link>
      <Link href="/market/orders" className="mb-4 inline-block underline">Investigate orders, returns and disputes</Link>
      <p className="mb-4 text-sm text-[var(--txt-muted)]">The charts and status counts cover this page. Prices are asking prices.</p>
      <form action="/market" className="mb-4 flex items-center gap-3">
        <label>Find a listing <input name="q" type="search" defaultValue={search} minLength={3} maxLength={100} placeholder="Title or listing ID" /></label>
        <button type="submit" className="underline">Search all listings</button>
      </form>
      {invalid && <p role="alert">Enter between 3 and 100 characters.</p>}
      <nav aria-label="Listing pages" className="mb-4 flex gap-4">
        {before && <Link className="underline" href={'/market?' + new URLSearchParams({ q: search })}>Newest results</Link>}
        {next && <Link className="underline" href={next}>Older results</Link>}
      </nav>
      <StatStrip cards={cards} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_336px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Listing' }, { label: 'Price', align: 'right' }, { label: 'Status' }, { label: 'Seller' }, { label: 'Where' }, { label: 'Listed', align: 'right' }]}
            grid="minmax(220px,2.4fr) 100px 112px minmax(150px,1.3fr) minmax(110px,1fr) 92px"
            rows={rows}
            filters={[
              { key: 'status', label: 'Status', options: Array.from(new Set(listings.map(l => title(statusOf(l))))) },
              { key: 'category', label: 'Category', options: Object.keys(catCount).map(title).slice(0, 12) },
            ]}
            searchHint="Filter this page by listing, seller or category"
            detailTitle="Listing details"
            minWidth={960}
            pageSize={12}
            actions={[{ key: 'remove', label: 'Remove this listing', tone: 'bad', action: adminRemoveListing, idName: 'lid' }]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What sells here</div>
              <div style={H_SUB}>Listings by category</div>
            </div>
            <div style={{ padding: 16 }}>
              {catSlices.length === 0 ? <Empty note="No listing on file yet." /> : <Donut slices={catSlices} centerLabel="listings" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Listing rhythm</div>
              <div style={H_SUB}>New listings per day, last 30 days</div>
            </div>
            <div style={{ padding: '18px 16px 14px' }}>
              <StackBars days={dayRows} height={130} series={[{ key: 'listed', label: 'Listed', color: 'var(--c2)' }]} />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
