import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: rows } = await svc.from('call_sessions')
    .select('id, initiator_id, receiver_id, call_type, status, is_video, is_group_call, duration_sec, started_at, created_at')
    .order('created_at', { ascending: false }).limit(50);
  const uids = Array.from(new Set((rows ?? []).flatMap(r => [r.initiator_id, r.receiver_id]).filter(Boolean)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids as string[]);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const week = Date.now() - 7 * 86400000;
  const inWeek = (rows ?? []).filter(r => new Date(r.created_at).getTime() > week);
  const connected = inWeek.filter(r => r.started_at || (r.duration_sec || 0) > 0);
  const answerRate = inWeek.length ? Math.round((connected.length / inWeek.length) * 100) : 0;
  const talked = inWeek.filter(r => (r.duration_sec || 0) > 0);
  const avgDur = talked.length ? Math.round(talked.reduce((a, r) => a + (r.duration_sec || 0), 0) / talked.length) : 0;
  const name = (id?: string | null) => id ? (people[id]?.full_name || '@' + (people[id]?.username || '?')) : '-';
  const fmtDur = (s?: number | null) => !s ? '-' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const kind = (r: any) => r.is_group_call ? 'group' : (r.is_video ? 'video' : 'voice');
  const pill = (s: string) => s === 'active'
    ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Live</span>
    : s === 'ended'
    ? <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">Ended</span>
    : s === 'missed'
    ? <span className="rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">Missed</span>
    : <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">{s}</span>;
  return (
    <Shell admin={admin} active="/calls" title="Calls" sub="Every session the calls system created - read straight from its own records">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{inWeek.length}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Attempts this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{answerRate}%</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Connected rate</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{fmtDur(avgDur)}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Average talk time</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{(rows ?? []).filter(r => r.status === 'active').length}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Live right now</p>
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        <div className="grid grid-cols-[70px_1fr_1fr_100px_90px_130px] gap-3 border-b border-[#E5E4E0] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Type</p><p>From</p><p>To</p><p>Status</p><p>Talked</p><p>When</p>
        </div>
        {(rows ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No call sessions yet.</p>
        ) : (rows ?? []).map(r => (
          <div key={r.id} className="grid grid-cols-[70px_1fr_1fr_100px_90px_130px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="font-semibold capitalize">{kind(r)}</p>
            <Link href={'/users/' + r.initiator_id} className="truncate text-[#17181C] hover:underline">{name(r.initiator_id)}</Link>
            <p className="truncate">{r.is_group_call ? 'group members' : <Link href={'/users/' + r.receiver_id} className="text-[#17181C] hover:underline">{name(r.receiver_id)}</Link>}</p>
            <p>{pill(r.status)}</p>
            <p className="tabular-nums text-[#5A5D64]">{fmtDur(r.duration_sec)}</p>
            <p className="tabular-nums text-[11.5px] text-[#9A9DA4]">{new Date(r.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}