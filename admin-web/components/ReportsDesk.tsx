'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dismissReport, removeReportedPost, removeReportedListing, resolveUserReport } from '@/lib/actions';

type Report = {
  id: string; kind: 'Post' | 'Listing' | 'Account'; reason: string; created_at: string;
  reporterName: string; targetLabel: string; targetGone: boolean; detail?: string | null;
  postId?: string; listingId?: string; reportedId?: string; reportedUsername?: string | null;
};

export default function ReportsDesk({ reports }: { reports: Report[] }) {
  const [tab, setTab] = useState<'all' | 'Post' | 'Listing' | 'Account'>('all');
  const [selected, setSelected] = useState<Report | null>(reports[0] ?? null);

  const filtered = reports.filter(r => tab === 'all' || r.kind === tab);
  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: reports.length },
    { key: 'Post', label: 'Posts', count: reports.filter(r => r.kind === 'Post').length },
    { key: 'Listing', label: 'Listings', count: reports.filter(r => r.kind === 'Listing').length },
    { key: 'Account', label: 'Accounts', count: reports.filter(r => r.kind === 'Account').length },
  ];

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
        ) : filtered.map(r => (
          <button key={r.kind + r.id} onClick={() => setSelected(r)}
            className={'flex w-full items-center gap-3 border-t border-[#F0EFEC] px-4 py-3 text-left transition-colors duration-150 hover:bg-[#FAFAF9] ' + (selected?.id === r.id && selected?.kind === r.kind ? 'bg-[#FAFAF9]' : '')}>
            <span className="shrink-0 rounded-full bg-[#FBF4E4] px-2 py-0.5 text-[10px] font-bold uppercase text-[#B45309]">{r.kind}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#17181C]">{r.reason}</span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-[#9A9DA4]">{new Date(r.created_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>

      <div className="lg:col-span-3 rounded-[14px] border border-[#E5E4E0] bg-white p-5">
        {!selected ? (
          <p className="py-14 text-center text-[13px] text-[#9A9DA4]">Select a report</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[14.5px] font-semibold text-[#17181C]">{selected.kind} report \u2014 {selected.reason}</p>
              <span className="text-[11.5px] text-[#9A9DA4]">{new Date(selected.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-3 rounded-[10px] bg-[#17181C]/[0.03] p-4">
              <p className="whitespace-pre-wrap text-[13.5px] text-[#17181C]/85">{selected.targetGone ? '(already removed)' : selected.targetLabel}</p>
              {selected.detail ? <p className="mt-1.5 text-[12px] italic text-[#17181C]/60">{selected.detail}</p> : null}
            </div>
            <p className="mt-3 text-[12px] text-[#9A9DA4]">Reported by {selected.reporterName}</p>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#F0EFEC] pt-4">
              {selected.kind === 'Post' && !selected.targetGone ? (
                <form action={removeReportedPost}>
                  <input type="hidden" name="rid" value={selected.id} /><input type="hidden" name="pid" value={selected.postId} />
                  <button className="rounded-[9px] border border-[#F3C9C9] bg-[#FBF0F0] px-3.5 py-2 text-[12px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F8E4E4]">Remove post</button>
                </form>
              ) : null}
              {selected.kind === 'Listing' && !selected.targetGone ? (
                <form action={removeReportedListing}>
                  <input type="hidden" name="rid" value={selected.id} /><input type="hidden" name="lid" value={selected.listingId} />
                  <button className="rounded-[9px] border border-[#F3C9C9] bg-[#FBF0F0] px-3.5 py-2 text-[12px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F8E4E4]">Remove listing</button>
                </form>
              ) : null}
              {selected.kind === 'Post' || selected.kind === 'Listing' ? (
                <form action={dismissReport}>
                  <input type="hidden" name="rid" value={selected.id} /><input type="hidden" name="table" value={selected.kind === 'Post' ? 'post_reports' : 'listing_reports'} />
                  <button className="rounded-[9px] border border-[#E5E4E0] px-3.5 py-2 text-[12px] font-semibold text-[#7A7D84] transition-colors duration-150 hover:bg-[#FAFAF9]">No violation</button>
                </form>
              ) : null}
              {selected.kind === 'Account' ? (
                <>
                  <form action={resolveUserReport}>
                    <input type="hidden" name="rid" value={selected.id} /><input type="hidden" name="outcome" value="actioned" />
                    <button className="rounded-[9px] border border-[#F3C9C9] bg-[#FBF0F0] px-3.5 py-2 text-[12px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F8E4E4]">Mark actioned</button>
                  </form>
                  <form action={resolveUserReport}>
                    <input type="hidden" name="rid" value={selected.id} /><input type="hidden" name="outcome" value="dismissed" />
                    <button className="rounded-[9px] border border-[#E5E4E0] px-3.5 py-2 text-[12px] font-semibold text-[#7A7D84] transition-colors duration-150 hover:bg-[#FAFAF9]">No violation</button>
                  </form>
                </>
              ) : null}
              {(selected.kind === 'Post' && selected.reportedUsername) || selected.kind === 'Account' ? (
                <Link href={'/users?q=' + encodeURIComponent(selected.reportedUsername || '')} className="ml-auto rounded-[9px] bg-[#17181C] px-3.5 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Open author</Link>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}