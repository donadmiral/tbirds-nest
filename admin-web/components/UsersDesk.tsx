'use client';

import { useState } from 'react';
import Link from 'next/link';
import Seal from '@/components/Seal';
import { suspendUser, restoreUser, revokeVerification, issueStrike, adminDeleteAccount } from '@/lib/actions';

type Row = {
  id: string; full_name: string | null; username: string | null; email: string | null;
  avatar_url: string | null; account_type: string | null; is_verified: boolean;
  verified_tier: string | null; verified_category: string | null; created_at: string;
  deactivated_at: string | null; suspended_reason: string | null; restricted_until: string | null;
  followers: number; following: number; strikes: number;
};

function standing(u: Row): { label: string; cls: string } {
  if (u.deactivated_at) return { label: 'Suspended', cls: 'bg-[#FBF0F0] text-[#B03A3A]' };
  if (u.restricted_until && new Date(u.restricted_until) > new Date()) return { label: 'Restricted', cls: 'bg-[#FBF4E4] text-[#B45309]' };
  return { label: 'Active', cls: 'bg-[#EFF8F1] text-[#1D7A38]' };
}

export default function UsersDesk({ rows, appeals }: { rows: Row[]; appeals: { id: string; user_id: string; subject: string; created_at: string }[] }) {
  const [tab, setTab] = useState<'all' | 'verified' | 'restricted' | 'suspended' | 'appeals'>('all');
  const [selected, setSelected] = useState<Row | null>(rows[0] ?? null);
  const [strikeOpen, setStrikeOpen] = useState(false);

  const appealUserIds = new Set(appeals.map(a => a.user_id));
  const filtered = rows.filter(u => {
    if (tab === 'verified') return u.is_verified;
    if (tab === 'restricted') return u.restricted_until && new Date(u.restricted_until) > new Date();
    if (tab === 'suspended') return !!u.deactivated_at;
    if (tab === 'appeals') return appealUserIds.has(u.id);
    return true;
  });

  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: 'all', label: 'All members', count: rows.length },
    { key: 'verified', label: 'Verified', count: rows.filter(u => u.is_verified).length },
    { key: 'restricted', label: 'Restricted', count: rows.filter(u => u.restricted_until && new Date(u.restricted_until) > new Date()).length },
    { key: 'suspended', label: 'Suspended', count: rows.filter(u => u.deactivated_at).length },
    { key: 'appeals', label: 'Appeals', count: appeals.length },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 overflow-hidden rounded-[14px] border border-[#E5E4E0] bg-white">
        <div className="flex gap-1 overflow-x-auto border-b border-[#F0EFEC] px-3 pt-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={'shrink-0 rounded-t-[9px] px-3 py-2 text-[12.5px] font-semibold transition-colors duration-150 ' + (tab === t.key ? 'border-b-2 border-[#17181C] text-[#17181C]' : 'text-[#9A9DA4] hover:text-[#17181C]')}>
              {t.label} <span className="tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#9A9DA4]">
              <th className="px-4 py-2.5">Member</th>
              <th className="px-2 py-2.5">Tier</th>
              <th className="px-2 py-2.5">Standing</th>
              <th className="px-2 py-2.5">Strikes</th>
              <th className="px-2 py-2.5">Followers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[#9A9DA4]">No members match.</td></tr>
            ) : filtered.map(u => {
              const s = standing(u);
              return (
                <tr key={u.id} onClick={() => { setSelected(u); setStrikeOpen(false); }}
                  className={'cursor-pointer border-t border-[#F0EFEC] transition-colors duration-150 hover:bg-[#FAFAF9] ' + (selected?.id === u.id ? 'bg-[#FAFAF9]' : '')}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#17181C]/10 text-[11px] font-bold text-[#17181C]">{String(u.full_name || '?').slice(0, 1)}</span>}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 truncate font-semibold text-[#17181C]">{u.full_name || 'Unnamed'}{(u.verified_tier || u.is_verified) ? <Seal tier={u.verified_tier || 'business'} size={12} /> : null}</span>
                        <span className="block truncate text-[11px] text-[#9A9DA4]">@{u.username || '-'}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-[12px] text-[#7A7D84]">{u.verified_tier || '\u2014'}</td>
                  <td className="px-2 py-2.5"><span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + s.cls}>{s.label}</span></td>
                  <td className="px-2 py-2.5 tabular-nums text-[#7A7D84]">{u.strikes}</td>
                  <td className="px-2 py-2.5 tabular-nums text-[#7A7D84]">{u.followers.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="lg:col-span-2">
        {!selected ? (
          <div className="rounded-[14px] border border-[#E5E4E0] bg-white p-10 text-center text-[13px] text-[#9A9DA4]">Select a member</div>
        ) : (
          <div className="rounded-[14px] border border-[#E5E4E0] bg-white p-5">
            <div className="flex items-center gap-3">
              {selected.avatar_url ? <img src={selected.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#17181C]/10 text-[15px] font-bold text-[#17181C]">{String(selected.full_name || '?').slice(0, 1)}</span>}
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-[14.5px] font-semibold text-[#17181C]">{selected.full_name || 'Unnamed'}{(selected.verified_tier || selected.is_verified) ? <Seal tier={selected.verified_tier || 'business'} size={14} /> : null}</p>
                <Link href={'/users/' + selected.id} className="text-[11.5px] text-[#5B6470] hover:underline">@{selected.username || '-'}</Link>
              </div>
            </div>

            <div className="mt-4 flex gap-4 border-b border-[#F0EFEC] pb-4">
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{selected.followers.toLocaleString()}</p><p className="text-[10.5px] text-[#9A9DA4]">Followers</p></div>
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{selected.following.toLocaleString()}</p><p className="text-[10.5px] text-[#9A9DA4]">Following</p></div>
              <div><p className="text-[15px] font-bold tabular-nums text-[#17181C]">{selected.strikes}</p><p className="text-[10.5px] text-[#9A9DA4]">Strikes</p></div>
            </div>

            <div className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-[#9A9DA4]">Email</span><span className="text-[#17181C]">{selected.email || 'none on file'}</span></div>
              <div className="flex justify-between"><span className="text-[#9A9DA4]">Account type</span><span className="text-[#17181C]">{selected.account_type || 'personal'}</span></div>
              <div className="flex justify-between"><span className="text-[#9A9DA4]">Joined</span><span className="text-[#17181C]">{new Date(selected.created_at).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-[#9A9DA4]">Verification</span><span className="text-[#17181C]">{selected.verified_tier ? selected.verified_tier + (selected.verified_category ? ' \u00b7 ' + selected.verified_category : '') : 'Not verified'}</span></div>
              <div className="flex justify-between"><span className="text-[#9A9DA4]">Standing</span><span className="text-[#17181C]">{standing(selected).label}{selected.suspended_reason ? ' \u2014 ' + selected.suspended_reason : ''}</span></div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#F0EFEC] pt-4">
              {selected.deactivated_at ? (
                <form action={restoreUser}>
                  <input type="hidden" name="id" value={selected.id} />
                  <button className="rounded-[9px] bg-[#17181C] px-3.5 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Restore account</button>
                </form>
              ) : (
                <button onClick={() => setStrikeOpen(v => !v)} className="rounded-[9px] border border-[#E5E4E0] px-3.5 py-2 text-[12px] font-semibold text-[#17181C] transition-colors duration-150 hover:bg-[#FAFAF9]">Issue strike</button>
              )}
              {(selected.verified_tier || selected.is_verified) ? (
                <form action={revokeVerification}>
                  <input type="hidden" name="id" value={selected.id} />
                  <button className="rounded-[9px] border border-[#E5E4E0] px-3.5 py-2 text-[12px] font-semibold text-[#7A7D84] transition-colors duration-150 hover:bg-[#FAFAF9]">Revoke badge</button>
                </form>
              ) : null}
            </div>

            {strikeOpen && !selected.deactivated_at ? (
              <form action={issueStrike} className="mt-3 flex flex-col gap-2 rounded-[10px] border border-[#E5E4E0] p-3">
                <input type="hidden" name="uid" value={selected.id} />
                <select name="level" required className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] text-[#17181C] outline-none">
                  <option value="warn">Warn</option>
                  <option value="restrict">Restrict posting</option>
                  <option value="suspend">Suspend</option>
                  <option value="ban">Ban</option>
                </select>
                <input name="days" type="number" min="1" placeholder="Days (restrict only)" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] outline-none" />
                <input name="reason" required placeholder="Reason (required)" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] outline-none" />
                <button className="rounded-[8px] bg-[#B03A3A] px-3 py-1.5 text-[12.5px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Confirm strike</button>
              </form>
            ) : null}

            {!selected.deactivated_at && !strikeOpen ? (
              <>
              <details className="mt-4 rounded-[10px] border border-[#F3C9C9] bg-[#FFF7F7] p-3">
                <summary className="cursor-pointer text-[12.5px] font-bold text-[#B03A3A]">Delete this account permanently</summary>
                <p className="mt-2 text-[12px] text-[#6B6E76]">Removes every post, story, message, listing, follow and membership this person owns, then the login itself. There is no undo. Prefer suspension unless deletion is required.</p>
                <form action={adminDeleteAccount} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="id" value={selected.id} />
                  <input name="reason" required placeholder="Reason (required, kept in the audit log)" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] outline-none" />
                  <input name="confirm" required placeholder="Type DELETE to confirm" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] outline-none" />
                  <button className="self-start rounded-[9px] bg-[#B03A3A] px-3.5 py-2 text-[12px] font-bold text-white transition-colors duration-150 hover:bg-[#8F2E2E]">Delete permanently</button>
                </form>
              </details>
              <form action={suspendUser} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={selected.id} />
                <input name="reason" required placeholder="Suspension reason (required)" className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1.5 text-[12.5px] outline-none" />
                <button className="self-start rounded-[9px] border border-[#F3C9C9] bg-[#FBF0F0] px-3.5 py-2 text-[12px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F8E4E4]">Suspend account</button>
              </form>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}