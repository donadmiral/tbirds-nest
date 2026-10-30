import { sanitizeDiagnostic } from '../../../shared/clientDiagnostics';
import CommandForm from '@/components/CommandForm';
import PermissionGate from '@/components/PermissionGate';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { toggleFlag, publishAnnouncement, retireAnnouncement, addBlockedWord, removeBlockedWord } from '@/lib/actions';
import Shell from '@/components/Shell';
import RefreshDesk from '@/components/RefreshDesk';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const admin = await requireDesk('/system');
  const svc = serviceClient();
  const { data: flags, error: flagsError } = await svc.from('feature_flags').select('*').order('key');
  const { data: notes, error: notesError } = await svc.from('announcements').select('*').order('created_at', { ascending: false }).limit(10);
  const { data: cerrs, error: errorsError } = await svc.from('client_errors')
    .select('id, user_id, message, platform, app_version, context, created_at')
    .order('created_at', { ascending: false }).limit(15);
  if (flagsError || notesError || errorsError) throw new Error('Platform controls could not be loaded.');
  const eids = Array.from(new Set((cerrs ?? []).map(e => e.user_id).filter(Boolean)));
  const epeople: Record<string, any> = {};
  if (eids.length) {
    const { data, error } = await svc.from('profiles').select('id, username, full_name').in('id', eids as string[]);
    if (error) throw new Error('Error-report participants could not be loaded.');
    (data ?? []).forEach(p => { epeople[p.id] = p; });
  }
  const { data: words, error: wordsError } = await svc.from('blocked_words').select('*').order('word');
  if (wordsError) throw new Error('Blocked-word controls could not be loaded.');
  return (
    <Shell admin={admin} active="/system" title="Platform controls" sub="Manage feature availability, platform announcements and blocked phrases." pageActions={<RefreshDesk />}>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Feature flags</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(flags ?? []).map(f => (
          <div key={f.key} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[13px] last:border-0">
            <p className="w-24 break-words font-semibold capitalize">{f.key}</p>
            <p className="min-w-0 flex-1 text-[#7A7D84]">{f.note}</p>
            {f.enabled
              ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">On</span>
              : <span className="rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]">Off</span>}
            <PermissionGate role={admin.role} permission="system"><CommandForm scope="toggleFlag" action={toggleFlag}>
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="to" value={f.enabled ? 'off' : 'on'} />
              <button aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.key}`} className={'rounded-[8px] px-3 py-1 text-[11px] font-bold ' + (f.enabled ? 'border border-[#F0DEDE] bg-[#FBF2F2] text-[#B03A3A] hover:bg-[#F6E4E4]' : 'bg-[#17181C] text-white hover:opacity-90')}>{f.enabled ? 'Switch off' : 'Switch on'}</button>
            </CommandForm></PermissionGate>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[var(--txt-muted)]">Changes apply to app surfaces connected to each feature flag. Check the relevant app version after changing availability.</p>

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Announcements</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <PermissionGate role={admin.role} permission="system"><CommandForm scope="publishAnnouncement" action={publishAnnouncement} className="space-y-2">
          <label className="block text-[12px] font-semibold text-[var(--txt-muted)]">Announcement title
            <input name="title" required placeholder="Title" className="mt-1 w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          </label>
          <label className="block text-[12px] font-semibold text-[var(--txt-muted)]">Message shown in the feed
            <textarea name="body" required rows={3} placeholder="Write the announcement" className="mt-1 w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          </label>
          <button className="rounded-[10px] bg-[#17181C] px-4 py-2 text-[12px] font-bold text-white hover:opacity-90">Publish to the platform</button>
        </CommandForm></PermissionGate>
      </div>
      {(notes ?? []).length ? (
        <div className="mt-4 rounded-[12px] border border-[#E5E4E0] bg-white">
          {(notes ?? []).map(n => (
            <div key={n.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{n.title}</p>
                <p className="truncate text-[#7A7D84]">{n.body}</p>
              </div>
              <p className="shrink-0 tabular-nums text-[11px] text-[#9A9DA4]">{new Date(n.created_at).toLocaleDateString()}</p>
              {n.active ? (
                <PermissionGate role={admin.role} permission="system"><CommandForm scope="retireAnnouncement" action={retireAnnouncement}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="rounded-[8px] border border-[#E5E4E0] px-3 py-1 text-[11px] font-bold text-[#5A5D64] hover:bg-[#F0EFEC]">Retire</button>
                </CommandForm></PermissionGate>
              ) : <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">Retired</span>}
            </div>
          ))}
        </div>
      ) : null}

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Blocked words</p>
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <PermissionGate role={admin.role} permission="system"><CommandForm scope="addBlockedWord" action={addBlockedWord} className="flex items-center gap-2">
          <label className="min-w-0 flex-1 text-[12px] font-semibold text-[var(--txt-muted)]">Blocked word or phrase
            <input name="word" required minLength={2} placeholder="Word or phrase" className="mt-1 block w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          </label>
          <button className="rounded-[10px] bg-[#17181C] px-4 py-2 text-[12px] font-bold text-white hover:opacity-90">Block</button>
        </CommandForm></PermissionGate>
        {(words ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {(words ?? []).map(w => (
              <PermissionGate key={w.word} role={admin.role} permission="system"><CommandForm scope="removeBlockedWord" action={removeBlockedWord} className="flex items-center gap-1.5 rounded-full border border-[#E5E4E0] bg-[#FAFAF9] py-1 pl-3 pr-1.5">
                <span className="text-[12px] font-semibold text-[#43454B]">{w.word}</span>
                <input type="hidden" name="word" value={w.word} />
                <button aria-label={`Remove blocked phrase ${w.word}`} className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold text-[#9A9DA4] hover:bg-[#F0DEDE] hover:text-[#B03A3A]" title="Remove">&times;</button>
              </CommandForm></PermissionGate>
            ))}
          </div>
        ) : <p className="mt-3 text-[12px] text-[#9A9DA4]">Nothing blocked yet. The database refuses matching posts and comments the moment a word lands here.</p>}
      </div>
      <div className="mt-6">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Latest 15 received client error reports</p>
        <div className="overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
          {(cerrs ?? []).length === 0 ? (
            <p className="px-5 py-6 text-[12.5px] text-[#9A9DA4]">No client error reports were returned. This does not confirm every device is error-free.</p>
          ) : (cerrs ?? []).map(e => {
            const p = e.user_id ? epeople[e.user_id] : null;
            const safe = sanitizeDiagnostic({ name: e.message }, { ...(e.context as Record<string, unknown>), platform: e.platform, appVersion: e.app_version });
            const fatal = safe.fatal;
            return (
              <details key={e.id} className="border-b border-[#F0EFEC] last:border-0">
                <summary className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-[#FAFAF9]">
                  <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ' + (fatal ? 'bg-[#FBF2F2] text-[#B03A3A]' : 'bg-[#FDF6E9] text-[#B08D3F]')}>{fatal ? 'FATAL' : 'caught'}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#26282E]">{safe.category}</span>
                  <span className="shrink-0 text-[11px] text-[#9A9DA4]">{safe.platform}{safe.appVersion ? ' ' + safe.appVersion : ''}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[#9A9DA4]">{new Date(e.created_at).toLocaleString()}</span>
                </summary>
                <div className="bg-[#FAFAF9] px-5 py-3">
                  <p className="mb-1 text-[11px] text-[#5A5D64]">{p ? ('From ' + (p.full_name || '@' + p.username)) : 'Not signed in'}</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[#26282E] p-3 text-[10.5px] leading-relaxed text-[#D7DBE0]">{`Source: ${safe.source}. Raw error messages and stack traces are not collected or displayed.`}</pre>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
