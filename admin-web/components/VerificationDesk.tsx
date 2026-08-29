'use client';

import { useState } from 'react';
import Seal from '@/components/Seal';
import { approveApplication, rejectApplication } from '@/lib/actions';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };

type App = {
  id: string; applicant_id: string; tier: string; category: string | null; status: string;
  created_at: string; evidence: any; full_name: string | null; username: string | null; avatar_url: string | null;
  account_type: string | null; vouches: number; voucherNames: string; strikes: number;
};

function waiting(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return Math.floor(ms / 60000) + 'm';
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

export default function VerificationDesk({ apps }: { apps: App[] }) {
  const [tab, setTab] = useState<'all' | 'submitted' | 'under_review'>('all');
  const [selected, setSelected] = useState<App | null>(apps[0] ?? null);

  const filtered = apps.filter(a => tab === 'all' || a.status === tab);
  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: apps.length },
    { key: 'submitted', label: 'Submitted', count: apps.filter(a => a.status === 'submitted').length },
    { key: 'under_review', label: 'Under review', count: apps.filter(a => a.status === 'under_review').length },
  ];

  const ev = selected?.evidence || {};
  const docCount = (Array.isArray(ev.links) ? ev.links.length : 0) + (ev.office ? 1 : 0) + (ev.statement ? 1 : 0);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-2 overflow-hidden rounded-[14px] border border-[#E5E4E0] bg-white">
        <div className="flex gap-1 border-b border-[#F0EFEC] px-3 pt-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={'shrink-0 rounded-t-[9px] px-3 py-2 text-[12.5px] font-semibold transition-colors duration-150 ' + (tab === t.key ? 'border-b-2 border-[#17181C] text-[#17181C]' : 'text-[#9A9DA4] hover:text-[#17181C]')}>
              {t.label} <span className="tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-14 text-center text-[13px] text-[#9A9DA4]">Nothing here.</p>
        ) : filtered.map(a => (
          <button key={a.id} onClick={() => setSelected(a)}
            className={'flex w-full items-center gap-3 border-t border-[#F0EFEC] px-4 py-3 text-left transition-colors duration-150 hover:bg-[#FAFAF9] ' + (selected?.id === a.id ? 'bg-[#FAFAF9]' : '')}>
            {a.avatar_url ? <img src={a.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#17181C]/10 text-[12px] font-bold text-[#17181C]">{String(a.full_name || '?').slice(0, 1)}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[#17181C]">{a.full_name || 'Unknown'}</span>
              <span className="block truncate text-[11px] text-[#9A9DA4]">{TIER_LABEL[a.tier] || a.tier}{a.category ? ' \u00b7 ' + a.category : ''}</span>
            </span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-[#9A9DA4]">{waiting(a.created_at)}</span>
          </button>
        ))}
      </div>

      <div className="lg:col-span-2 rounded-[14px] border border-[#E5E4E0] bg-white p-5">
        {!selected ? (
          <p className="py-14 text-center text-[13px] text-[#9A9DA4]">Select an application</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {selected.avatar_url ? <img src={selected.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#17181C]/10 text-[15px] font-bold text-[#17181C]">{String(selected.full_name || '?').slice(0, 1)}</span>}
              <div>
                <p className="text-[14.5px] font-semibold text-[#17181C]">{selected.full_name || 'Unknown'} <span className="font-normal text-[#9A9DA4]">@{selected.username || '-'}</span></p>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#17181C]"><Seal tier={selected.tier} size={13} /> {TIER_LABEL[selected.tier] || selected.tier}{selected.category ? ' \u00b7 ' + selected.category : ''}</span>
              </div>
            </div>
            <div className="mt-4 rounded-[10px] bg-[#17181C]/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9A9DA4]">Their case</p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#17181C]/85">{ev.statement || '\u2014'}</p>
              {ev.office ? <p className="mt-2 text-[12px] font-semibold text-[#17181C]/70">Office: {ev.office}</p> : null}
              {Array.isArray(ev.links) && ev.links.length ? (
                <ul className="mt-2 space-y-1">
                  {ev.links.map((l: string, i: number) => (
                    <li key={i}><a href={l.startsWith('http') ? l : 'https://' + l} target="_blank" rel="noreferrer" className="break-all text-[12px] text-blue-700 underline">{l}</a></li>
                  ))}
                </ul>
              ) : null}
            </div>
            {selected.vouches > 0 ? (
              <div className="mt-3 rounded-[10px] border border-[#DCEFE0] bg-[#F2F9F3] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#1D7A38]">Vouched by {selected.vouches} verified member{selected.vouches === 1 ? '' : 's'}</p>
                <p className="mt-1 text-[12px] text-[#1D7A38]">{selected.voucherNames}</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="lg:col-span-1 rounded-[14px] border border-[#E5E4E0] bg-white p-4">
        {selected ? (
          <>
            <div className="grid grid-cols-2 gap-2 border-b border-[#F0EFEC] pb-3">
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{selected.vouches}</p><p className="text-[10px] text-[#9A9DA4]">Vouches</p></div>
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{docCount}</p><p className="text-[10px] text-[#9A9DA4]">Docs</p></div>
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{waiting(selected.created_at)}</p><p className="text-[10px] text-[#9A9DA4]">Waiting</p></div>
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{selected.strikes}</p><p className="text-[10px] text-[#9A9DA4]">Strikes</p></div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <form action={approveApplication}>
                <input type="hidden" name="id" value={selected.id} />
                <button className="w-full rounded-[9px] bg-[#17181C] px-3 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Approve \u2014 {(TIER_LABEL[selected.tier] || selected.tier).toLowerCase()}</button>
              </form>
              <form action={rejectApplication} className="flex flex-col gap-1.5">
                <input type="hidden" name="id" value={selected.id} />
                <input name="reason" placeholder="Reason if rejecting" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12px] outline-none" />
                <button className="rounded-[9px] border border-[#F3C9C9] bg-[#FBF0F0] px-3 py-2 text-[12px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F8E4E4]">Reject</button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}