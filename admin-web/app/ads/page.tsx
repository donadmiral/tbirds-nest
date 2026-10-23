import CommandForm from '@/components/CommandForm';
import PermissionGate from '@/components/PermissionGate';
import { redirect } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { approveCampaign, rejectCampaign, adminEndCampaign } from '@/lib/actions';
import Seal from '@/components/Seal';
import Shell from '@/components/Shell';
import { completeRecordedPayments } from '@/lib/operationsReporting';

export const dynamic = 'force-dynamic';

const OBJ_LABEL: Record<string, string> = {
  reach: 'Reach', traffic: 'Website visits', messages: 'Messages', storefront: 'Storefront visits', applications: 'Job applications',
};
const PAY_LABEL: Record<string, string> = { crisp: 'Crisp', intobank: 'IntoBank' };

function statusPill(s: string) {
  if (s === 'live' || s === 'approved') return <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold capitalize text-[#1D7A38]">{s}</span>;
  if (s === 'submitted' || s === 'paused') return <span className="rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold capitalize text-[#B45309]">{s}</span>;
  if (s === 'rejected') return <span className="rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold capitalize text-[#B03A3A]">{s}</span>;
  return <span className="rounded-full border border-[#E5E4E0] bg-[#F0EFEC] px-2 py-0.5 text-[10.5px] font-bold capitalize text-[#5A5D64]">{s}</span>;
}

export default async function AdsPage() {
  const admin = await requireDesk('/ads');
  const svc = serviceClient();

  const [submittedResult, liveResult, historyResult] = await Promise.all([
    svc.from('studio_campaigns').select('*', { count: 'exact' }).eq('status', 'submitted').order('created_at', { ascending: true }),
    svc.from('studio_campaigns').select('*', { count: 'exact' }).in('status', ['live', 'paused', 'approved']).order('updated_at', { ascending: false }),
    svc.from('studio_campaigns').select('*').in('status', ['rejected', 'ended']).order('updated_at', { ascending: false }).limit(15),
  ]);
  if ([submittedResult, liveResult, historyResult].some(result => result.error)) throw new Error('Campaigns could not be loaded.');
  const submitted = submittedResult.data ?? [];
  const live = liveResult.data ?? [];
  const history = historyResult.data ?? [];
  const allCampaigns = [...submitted, ...live, ...history];

  const ownerIds = Array.from(new Set(allCampaigns.map(c => c.owner_id)));
  const owners: Record<string, any> = {};
  if (ownerIds.length) {
    const { data, error } = await svc.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').in('id', ownerIds);
    if (error) throw new Error('Campaign owners could not be loaded.');
    (data ?? []).forEach(p => { owners[p.id] = p; });
  }

  const activeCampaignIds = [...submitted, ...live].map(c => c.id);
  const promoByCampaign: Record<string, any[]> = {};
  if (activeCampaignIds.length) {
    const { data: promos, error: promosError } = await svc.from('promoted_posts')
      .select('id, campaign_id, post_id, label, status, total_cap, impressions_count, clicks_count')
      .in('campaign_id', activeCampaignIds);
    if (promosError) throw new Error('Campaign ads could not be loaded.');
    (promos ?? []).forEach(p => { (promoByCampaign[p.campaign_id] = promoByCampaign[p.campaign_id] || []).push(p); });
    const postIds = Array.from(new Set((promos ?? []).map(p => p.post_id)));
    if (postIds.length) {
      const [{ data: posts, error: postsError }, { data: media, error: mediaError }] = await Promise.all([
        svc.from('posts').select('id, content, body').in('id', postIds),
        svc.from('post_media').select('post_id, url, sort_order').in('post_id', postIds).order('sort_order', { ascending: true }),
      ]);
      if (postsError || mediaError) throw new Error('Campaign media could not be loaded.');
      const postById: Record<string, any> = {};
      (posts ?? []).forEach(p => { postById[p.id] = p; });
      const thumbByPost: Record<string, string> = {};
      (media ?? []).forEach(m => { if (!thumbByPost[m.post_id]) thumbByPost[m.post_id] = m.url; });
      Object.values(promoByCampaign).forEach(rows => rows.forEach((r: any) => {
        r.content = postById[r.post_id]?.content || postById[r.post_id]?.body || '';
        r.thumb = thumbByPost[r.post_id] || null;
      }));
    }
  }

  const week = Date.now() - 7 * 86400000;
  const [impressions, clicks, paidResult, liveCountResult] = await Promise.all([
    svc.from('ad_events').select('id', { count: 'exact', head: true }).eq('kind', 'impression').gte('created_at', new Date(week).toISOString()),
    svc.from('ad_events').select('id', { count: 'exact', head: true }).eq('kind', 'click').gte('created_at', new Date(week).toISOString()),
    svc.from('studio_campaigns').select('paid_amount, currency', { count: 'exact' }).gt('paid_amount', 0).gte('reviewed_at', new Date(week).toISOString()).limit(1000),
    svc.from('studio_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'live'),
  ]);
  if ([impressions, clicks, liveCountResult].some(result => result.error || result.count === null)) throw new Error('Campaign metrics could not be loaded.');
  const impCount = impressions.count;
  const clkCount = clicks.count;
  const paidThisWeek = completeRecordedPayments(paidResult);
  const paidLabel = paidThisWeek === null ? 'Unavailable' : paidThisWeek.length ? paidThisWeek.map(row => row.currency + ' ' + row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(' · ') : 'No payments recorded';

  const ownerRow = (ownerId: string) => {
    const p = owners[ownerId] || {};
    return (
      <div className="flex items-center gap-3">
        {p.avatar_url
          ? <img src={p.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
          : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#17181C]/10 text-sm font-bold text-[#17181C]">{String(p.full_name || '?').slice(0, 1)}</div>}
        <div>
          <p className="flex items-center gap-1 text-sm font-extrabold text-[#17181C]">
            {p.full_name || 'Unknown business'}
            {p.is_verified && p.verified_tier ? <Seal tier={p.verified_tier} size={13} /> : null}
          </p>
          <p className="text-[11px] text-[#17181C]/50">@{p.username || '-'}</p>
        </div>
      </div>
    );
  };

  const adsStrip = (id: string) => {
    const rows = promoByCampaign[id] || [];
    if (!rows.length) return <p className="mt-2 text-xs text-[#17181C]/40">No ads added to this campaign yet.</p>;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map(r => (
          <div key={r.id} className="flex w-64 items-center gap-2 rounded-[12px] border border-[#17181C]/10 bg-white p-2">
            {r.thumb
              ? <img src={r.thumb} alt="" className="h-9 w-9 rounded-lg object-cover" />
              : <div className="h-9 w-9 rounded-lg bg-[#17181C]/5" />}
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-semibold text-[#17181C]">{r.label || 'Sponsored'}</p>
              <p className="truncate text-[10.5px] text-[#17181C]/45">{r.content || 'Media post'}</p>
              <p className="text-[10px] tabular-nums text-[#17181C]/40">{Number(r.impressions_count || 0).toLocaleString()} / {r.total_cap ? Number(r.total_cap).toLocaleString() : '\u221e'} impr · {Number(r.clicks_count || 0).toLocaleString()} clicks</p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Shell admin={admin} active="/ads" title="Ads" sub="Every campaign submitted for review, and what is live on the platform right now">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{submittedResult.count ?? '—'}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Awaiting review</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{liveCountResult.count}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Live now</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{(impCount || 0).toLocaleString()}<span className="ml-1.5 text-[13px] font-medium text-[#7A7D84]">/ {(clkCount || 0).toLocaleString()}</span></p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Impressions / clicks this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{paidLabel}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Recorded payments on campaigns reviewed in 7 days (UTC)</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#5A5D64]">Showing {submitted.length} of {submittedResult.count ?? 'unknown'} awaiting review and {live.length} of {liveResult.count ?? 'unknown'} active campaigns. History shows the latest 15 decisions. Recorded payments are staff-entered records, not confirmation of bank settlement.</p>
      {paidThisWeek === null ? <p role="status" className="mt-2 text-sm" style={{ color: 'var(--warn)' }}>The complete payment total could not be confirmed. No partial total is shown.</p> : null}

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Awaiting review</p>
      {submitted.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[#17181C]/15 bg-white p-12 text-center">
          <p className="text-sm font-bold text-[#17181C]">Nothing waiting.</p>
          <p className="mt-1 text-xs text-[#17181C]/50">Campaigns land here the moment a business submits them for review.</p>
        </div>
      ) : submitted.map(c => (
        <div key={c.id} className="mb-5 rounded-[12px] border border-[#17181C]/10 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {ownerRow(c.owner_id)}
            <span className="flex items-center gap-1.5 rounded-full bg-[#17181C]/5 px-3 py-1.5 text-xs font-bold text-[#17181C]">
              {OBJ_LABEL[c.objective] || c.objective} · {c.currency} {Number(c.budget).toLocaleString()} · {PAY_LABEL[c.payment_method] || 'No payment method set'}
            </span>
          </div>
          <div className="mt-4 rounded-[12px] bg-[#17181C]/[0.03] p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#17181C]/40">{c.name}</p>
            <p className="mt-1 text-xs text-[#17181C]/70">
              Submitted {new Date(c.created_at).toLocaleString()}
              {c.starts_at ? ' \u00b7 starts ' + new Date(c.starts_at).toLocaleDateString() : ''}
              {c.ends_at ? ' \u00b7 ends ' + new Date(c.ends_at).toLocaleDateString() : ' \u00b7 no end date set'}
            </p>
            {adsStrip(c.id)}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PermissionGate role={admin.role} permission="ads"><CommandForm scope="approveCampaign" action={approveCampaign} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <span className="text-xs text-[#17181C]/60">Content approval. Payment is verified separately through IntoBank.</span>
              <button className="rounded-[12px] bg-[#17181C] px-5 py-2 text-xs font-extrabold text-white transition-opacity duration-150 hover:opacity-90">Approve</button>
            </CommandForm></PermissionGate>
            <PermissionGate role={admin.role} permission="ads"><CommandForm scope="rejectCampaign" action={rejectCampaign} className="flex flex-1 min-w-[260px] items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input name="reason" aria-label="Reason for rejection" placeholder="Reason if rejecting" className="flex-1 rounded-[12px] border border-[#17181C]/15 px-3 py-2 text-xs text-[#17181C] outline-none transition-colors duration-150 focus:border-[#17181C]/40" />
              <button className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition-colors duration-150 hover:bg-red-100">Reject</button>
            </CommandForm></PermissionGate>
          </div>
        </div>
      ))}

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Running now</p>
      {live.length === 0 ? (
        <p className="text-xs text-[#17181C]/40">No approved, live or paused campaigns right now.</p>
      ) : (
        <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
          {live.map(c => (
            <div key={c.id} className="border-b border-[#F0EFEC] px-5 py-4 last:border-0">
              <div className="flex flex-wrap items-center gap-3">
                {ownerRow(c.owner_id)}
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</p>
                {statusPill(c.status)}
                <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{c.currency} {Number(c.budget).toLocaleString()}</p>
                {c.status !== 'approved' || (promoByCampaign[c.id] || []).length ? (
                  <PermissionGate role={admin.role} permission="ads"><CommandForm scope="adminEndCampaign" action={adminEndCampaign}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700 transition-colors duration-150 hover:bg-red-100">End</button>
                  </CommandForm></PermissionGate>
                ) : null}
              </div>
              {adsStrip(c.id)}
            </div>
          ))}
        </div>
      )}

      {history.length ? (
        <div className="mt-8">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Decided</p>
          <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
            {history.map(c => (
              <div key={c.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{owners[c.owner_id]?.full_name || '@' + (owners[c.owner_id]?.username || '?')} <span className="font-normal text-[#7A7D84]">{c.name}</span></p>
                {c.review_note ? <p className="hidden shrink-0 truncate text-[11.5px] text-[#9A9DA4] sm:block sm:max-w-[220px]">{c.review_note}</p> : null}
                {statusPill(c.status)}
                <p className="shrink-0 text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(c.updated_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
