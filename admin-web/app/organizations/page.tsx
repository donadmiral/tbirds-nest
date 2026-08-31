import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { archiveOrganization, restoreOrganization, adminTransferOwnership } from '@/lib/actions';

/**
 * Organizations desk.
 *
 * The operations view over the organization model the web app runs on:
 * every organization at every level, who owns it, who works in it, which
 * agencies act for it, and what changed. Reads use the service client, so
 * nothing here depends on membership.
 */
export const dynamic = 'force-dynamic';

type Org = { id: string; parent_id: string | null; kind: string; name: string; slug: string | null; profile_id: string | null; created_at: string; archived_at: string | null };
type Membership = { org_id: string; user_id: string; role: string; expires_at: string | null };
type Delegation = { principal_org_id: string; client_org_id: string; scopes: string[]; expires_at: string | null };
type Audit = { org_id: string; actor_id: string | null; action: string; target_id: string | null; created_at: string };

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase();
  const showArchived = sp.show === 'archived';

  const [{ data: orgs }, { data: members }, { data: delegations }, { data: audit }] = await Promise.all([
    svc.from('organizations').select('id, parent_id, kind, name, slug, profile_id, created_at, archived_at').order('created_at'),
    svc.from('org_memberships').select('org_id, user_id, role, expires_at'),
    svc.from('org_delegations').select('principal_org_id, client_org_id, scopes, expires_at'),
    svc.from('org_audit_log').select('org_id, actor_id, action, target_id, created_at').order('created_at', { ascending: false }).limit(40),
  ]);

  const all = (orgs ?? []) as Org[];
  const userIds = Array.from(new Set([...(members ?? []).map((m: Membership) => m.user_id), ...(audit ?? []).map((a: Audit) => a.actor_id).filter(Boolean) as string[]]));
  const { data: people } = userIds.length ? await svc.from('profiles').select('id, full_name, username').in('id', userIds) : { data: [] };
  const who = Object.fromEntries(((people ?? []) as { id: string; full_name: string | null; username: string | null }[]).map((p) => [p.id, p.full_name ?? (p.username ? '@' + p.username : p.id.slice(0, 8))]));
  const byId = Object.fromEntries(all.map((o) => [o.id, o]));

  // Depth-first order so children print under their parents
  const children = new Map<string | null, Org[]>();
  for (const o of all) { const arr = children.get(o.parent_id) ?? []; arr.push(o); children.set(o.parent_id, arr); }
  const ordered: { org: Org; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const o of children.get(parent) ?? []) { ordered.push({ org: o, depth }); walk(o.id, depth + 1); } };
  walk(null, 0);

  const visible = ordered.filter(({ org }) => (showArchived ? true : !org.archived_at) && (!q || org.name.toLowerCase().includes(q) || (org.slug ?? '').toLowerCase().includes(q)));
  const memberOf = (id: string) => ((members ?? []) as Membership[]).filter((m) => m.org_id === id);
  const owners = (id: string) => memberOf(id).filter((m) => m.role === 'owner').map((m) => who[m.user_id] ?? m.user_id.slice(0, 8));
  const delegated = (id: string) => ((delegations ?? []) as Delegation[]).filter((d) => d.client_org_id === id);

  return (
    <Shell admin={admin} active="/organizations" title="Organizations" sub="Every organization at every level: owners, members, agencies acting for them, and what changed.">
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Search by name or handle" className="w-[320px] rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[13px] outline-none" />
        <button className="rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[13px] font-semibold">Search</button>
        <Link href={showArchived ? '/organizations' : '/organizations?show=archived'} className="ml-auto rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[13px] font-semibold text-[#6B6E76]">
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Link>
      </form>

      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">{visible.length} of {all.length}</p>
      <div className="overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        {visible.length === 0 ? <p className="p-5 text-[13px] text-[#6B6E76]">Nothing matches.</p> : visible.map(({ org, depth }) => {
          const ms = memberOf(org.id);
          const ds = delegated(org.id);
          return (
            <div key={org.id} className="flex items-start gap-4 border-b border-[#EEEDE9] px-5 py-3.5 last:border-0" style={{ paddingLeft: 20 + depth * 22 }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#1B1C1F]">{org.name}</span>
                  <span className="rounded-full bg-[#F3F2EE] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#6B6E76]">{org.kind}</span>
                  {org.archived_at ? <span className="rounded-full bg-[#FDECEC] px-2 py-0.5 text-[10.5px] font-semibold text-[#B42318]">archived</span> : null}
                  {org.parent_id ? <span className="text-[11.5px] text-[#9A9DA4]">under {byId[org.parent_id]?.name ?? 'unknown'}</span> : null}
                </div>
                <div className="mt-1 text-[12.5px] text-[#6B6E76]">
                  {org.slug ? '@' + org.slug + ' · ' : ''}
                  owner {owners(org.id).join(', ') || <span className="text-[#B42318]">none</span>} · {ms.length} {ms.length === 1 ? 'member' : 'members'}
                  {ds.length ? ' · ' + ds.length + (ds.length === 1 ? ' agency' : ' agencies') : ''}
                  {!org.profile_id ? ' · no page of its own' : ''}
                </div>
                {ms.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ms.map((m) => (
                      <span key={m.user_id} className="rounded-full border border-[#E5E4E0] px-2 py-0.5 text-[11px] text-[#4B4E56]">
                        {who[m.user_id] ?? m.user_id.slice(0, 8)} · {m.role}{m.expires_at ? ' · until ' + new Date(m.expires_at).toLocaleDateString() : ''}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                {org.profile_id ? <Link href={'/p/' + org.profile_id} className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1 text-center text-[12px] font-semibold text-[#4B4E56]">Profile</Link> : null}
                {org.archived_at ? (
                  <form action={restoreOrganization}><input type="hidden" name="id" value={org.id} /><button className="w-full rounded-[8px] bg-[#1B1C1F] px-2.5 py-1 text-[12px] font-semibold text-white">Restore</button></form>
                ) : (
                  <form action={archiveOrganization}><input type="hidden" name="id" value={org.id} /><button className="w-full rounded-[8px] border border-[#E5E4E0] px-2.5 py-1 text-[12px] font-semibold text-[#B42318]">Archive</button></form>
                )}
                <form action={adminTransferOwnership} className="flex gap-1">
                  <input type="hidden" name="id" value={org.id} />
                  <input name="username" placeholder="@new owner" className="w-[120px] rounded-[8px] border border-[#E5E4E0] px-2 py-1 text-[11.5px] outline-none" />
                  <button className="rounded-[8px] border border-[#E5E4E0] px-2 py-1 text-[11.5px] font-semibold text-[#4B4E56]">Set</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mb-2 mt-8 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Recent changes</p>
      <div className="overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        {(audit ?? []).length === 0 ? <p className="p-5 text-[13px] text-[#6B6E76]">No organization changes recorded yet.</p> : ((audit ?? []) as Audit[]).map((a, i) => (
          <div key={i} className="flex gap-4 border-b border-[#EEEDE9] px-5 py-2.5 text-[12.5px] last:border-0">
            <span className="w-[120px] shrink-0 text-[#9A9DA4]">{new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span className="min-w-0 flex-1 text-[#4B4E56]"><span className="font-semibold text-[#1B1C1F]">{byId[a.org_id]?.name ?? 'organization'}</span> · {a.action.replace(/_/g, ' ')} · by {a.actor_id ? (who[a.actor_id] ?? 'member') : 'system'}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
