"use client";

/**
 * Organization: the screens over migration 152.
 *
 * Team (members, roles, expiry, ownership), Structure (brands and locations
 * beneath this organization), Desks (which Studio surfaces are on),
 * Agencies (delegations in and out) and History (the audit log).
 *
 * Every write goes through an RPC that checks the caller's role and writes
 * the log, so this page never touches a table directly. Reads go through
 * RLS, which is why a member who is not an owner or admin sees History as
 * empty rather than as an error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, Building2, Clock, Crown, MapPin, Plus, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Panel, PillTabs } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";
import { useStudio } from "@/components/StudioShell";
import {
  ORG_ROLES, SURFACES, type OrgRole, type Surface, type OrgNode,
  createChild, addMember, removeMember, transferOwnership, setSurface, grantDelegation, revokeDelegation,
} from "@/lib/org";

type Org = { id: string; kind: string; name: string; slug: string | null; profile_id: string | null; parent_id: string | null };
type Member = { id: string; user_id: string; role: OrgRole; expires_at: string | null; created_at: string; profile: { full_name: string | null; username: string | null; avatar_url: string | null } | null };
type Delegation = { id: string; principal_org_id: string; client_org_id: string; scopes: string[]; expires_at: string | null; principal: { name: string; slug: string | null } | null; client: { name: string; slug: string | null } | null };
type Audit = { id: string; action: string; target_type: string | null; target_id: string | null; meta: Record<string, unknown>; created_at: string; actor: { full_name: string | null; username: string | null } | null };

const TABS = [
  { key: "team", label: "Team" },
  { key: "structure", label: "Structure" },
  { key: "desks", label: "Desks" },
  { key: "agencies", label: "Agencies" },
  { key: "history", label: "History" },
];

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner", admin: "Administrator", manager: "Manager", editor: "Content editor", publisher: "Publisher",
  community_manager: "Community manager", support: "Customer support", recruiter: "Recruiter", ads_manager: "Advertising manager",
  commerce_manager: "Commerce manager", analyst: "Analyst", finance_manager: "Finance manager", verification_manager: "Verification manager",
  viewer: "Read-only", member: "Member",
};
const SURFACE_LABEL: Record<Surface, string> = {
  content: "Content", insights: "Insights", planner: "Planner", inbox: "Inbox", recruiter: "Recruiter",
  commerce: "Commerce", audience: "Audience", ads: "Ads", reviews: "Reviews", settings: "Settings",
};

function when(s: string | null) {
  return s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
}

export default function OrganizationPage() {
  const { accountId } = useStudio();
  const supabase = useRef(createClient()).current;
  const [tab, setTab] = useState("team");
  const [uid, setUid] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [surfaces, setSurfaces] = useState<Record<string, boolean>>({});
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | false>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), generation = useRef(0), working = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // add-member form
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<OrgRole>("editor");
  const [newExpiry, setNewExpiry] = useState("");
  // child form
  const [childKind, setChildKind] = useState<"brand" | "location">("brand");
  const [childName, setChildName] = useState("");
  // delegation form
  const [agencySlug, setAgencySlug] = useState("");
  const [agencyScopes, setAgencyScopes] = useState<Surface[]>(["content"]);
  const [agencyExpiry, setAgencyExpiry] = useState("");

  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      const me = sess.session?.user.id ?? null;
      if (sessionError || me !== accountId) throw new Error("Your account changed. Reopen Team and access.");
      if (!mounted.current || version !== generation.current) return;

      const { data: o, error } = await supabase.from("organizations").select("id, kind, name, slug, profile_id, parent_id").eq("profile_id", me).maybeSingle();
      if (error) throw new Error(error.message + (error.code ? " (" + error.code + ")" : ""));
      if (!o) throw new Error("This account does not have an organization workspace yet. Open a business account or contact support.");
      const [m, t, s, d, a] = await Promise.all([
        supabase.from("org_memberships").select("id, user_id, role, expires_at, created_at, profile:profiles!org_memberships_user_id_fkey(full_name, username, avatar_url)").eq("org_id", o.id).order("created_at"),
        supabase.rpc("org_tree", { p_root: o.id }),
        supabase.from("org_surfaces").select("surface, enabled").eq("org_id", o.id),
        supabase.from("org_delegations").select("id, principal_org_id, client_org_id, scopes, expires_at, principal:organizations!org_delegations_principal_org_id_fkey(name, slug), client:organizations!org_delegations_client_org_id_fkey(name, slug)").or("client_org_id.eq." + o.id + ",principal_org_id.eq." + o.id),
        supabase.from("org_audit_log").select("id, action, target_type, target_id, meta, created_at, actor:profiles!org_audit_log_actor_id_fkey(full_name, username)").eq("org_id", o.id).order("created_at", { ascending: false }).limit(60),
      ]);
      if (!mounted.current || version !== generation.current) return;
      for (const result of [m, t, s, d, a]) if (result.error) throw new Error("Organization data could not be loaded. Please try again.");
      setUid(me);
      setOrg(o as Org);
      setMembers(((m.data ?? []) as unknown) as Member[]);
      setTree((t.data ?? []) as OrgNode[]);
      setSurfaces(Object.fromEntries(((s.data ?? []) as { surface: string; enabled: boolean }[]).map((r) => [r.surface, r.enabled])));
      setDelegations(((d.data ?? []) as unknown) as Delegation[]);
      setAudit(((a.data ?? []) as unknown) as Audit[]);
    } catch (e) {
      if (mounted.current && version === generation.current) setFailed(e instanceof Error ? e.message : "Organization could not be loaded.");
    } finally {
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, [supabase, accountId]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; if (noticeTimer.current) clearTimeout(noticeTimer.current); }; }, [load]);

  const myRole = useMemo(() => members.find((m) => m.user_id === uid)?.role ?? null, [members, uid]);
  const canManage = myRole === "owner" || myRole === "admin";
  const flash = (t: string) => { if (!mounted.current) return; setNotice(t); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => { if (mounted.current) setNotice(null); }, 5000); };

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string } | boolean | string | null>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const current = await supabase.auth.getSession();
      if (!mounted.current) return;
      if (current.error || current.data.session?.user.id !== accountId) throw new Error("Your account changed. Reopen Team and access.");
      const r = await fn();
      if (!mounted.current) return;
      const ok = typeof r === "object" && r !== null ? r.ok : !!r;
      const err = typeof r === "object" && r !== null ? r.error : undefined;
      flash(ok ? label : err ?? "That did not go through");
      if (ok) await load();
    } catch (error) {
      flash(error instanceof Error ? error.message : "This action was not confirmed. Refresh before trying again.");
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (loading) return <p className="py-14 text-center text-sm text-muted">Loading</p>;
  if (failed || !org) return <ErrorState title="Could not load your organization" line={failed || "No organization found for this account."} onRetry={() => void load()} />;

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <Link href="/studio/settings" className="mt-1 rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink" aria-label="Back to settings"><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Team & access</h1>
          <p className="mt-1 text-[13px] text-muted">
            {org.name} · {org.kind} {org.slug ? "· @" + org.slug : ""} · your role: <span className="font-semibold text-ink">{myRole ? ROLE_LABEL[myRole] : "member"}</span>
          </p>
        </div>
      </div>

      <Link href="/studio/settings#business-access-team" className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink/15 px-4 py-2 text-sm font-semibold">Manage business sign-in codes and devices <ArrowLeft size={14} className="rotate-180" /></Link>
      {notice ? <div role="status" className="mb-3 rounded-xl bg-pearl/12 px-4 py-2.5 text-[13px] text-ink">{notice}</div> : null}

      <div className="mb-4"><PillTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} active={tab} onSelect={setTab} /></div>

      {tab === "team" ? (
        <>
          <Panel title="People" icon={<Users size={15} />}>
            <div className="flex flex-col">
              {members.map((m) => {
                const expired = m.expires_at ? new Date(m.expires_at).getTime() < Date.now() : false;
                return (
                  <div key={m.id} className="flex items-center gap-3 border-b border-ink/8 py-2.5 last:border-0">
                    {m.profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImageUrl(m.profile.avatar_url, 200) ?? m.profile.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : <span className="h-9 w-9 shrink-0 rounded-full bg-surface" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                        {m.profile?.full_name ?? m.profile?.username ?? "Member"}
                        {m.role === "owner" ? <Crown size={13} className="text-accent" /> : null}
                        {m.user_id === uid ? <span className="text-[11px] font-normal text-muted">you</span> : null}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {ROLE_LABEL[m.role]}
                        {m.expires_at ? <span className={expired ? " text-danger" : ""}> · {expired ? "expired" : "until"} {when(m.expires_at)}</span> : null}
                      </span>
                    </span>
                    {canManage && m.user_id !== uid ? (
                      <>
                        {myRole === "owner" && m.role !== "owner" ? (
                          <button disabled={busy} onClick={() => { if (window.confirm("Make " + (m.profile?.full_name ?? "this person") + " the owner? You become an admin.")) void run("Ownership transferred", () => transferOwnership(org.id, m.user_id)); }}
                            className="rounded-full border border-ink/15 px-2.5 py-1 text-[12px] font-semibold text-ink/60 transition-colors hover:bg-surface hover:text-ink">Make owner</button>
                        ) : null}
                        <button disabled={busy} onClick={() => { if (window.confirm("Remove " + (m.profile?.full_name ?? "this person") + " from " + org.name + "?")) void run("Removed", () => removeMember(org.id, m.user_id)); }}
                          className="rounded-full p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Panel>

          {canManage ? (
            <div className="mt-4">
              <Panel title="Add someone" icon={<UserPlus size={15} />}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_160px_auto]">
                  <input aria-label="Member username" value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="@username" className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px] outline-none focus:border-pearl" />
                  <select aria-label="Organization role" value={newRole} onChange={(e) => setNewRole(e.target.value as OrgRole)} className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px]">
                    {ORG_ROLES.filter((r) => myRole === "owner" || r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <input aria-label="Member access expiry" type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} title="Access ends on this date, optional" className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px]" />
                  <button disabled={busy || !newUser.trim()} onClick={() => void run("Added", async () => { const r = await addMember(org.id, newUser.replace(/^@/, ""), newRole, newExpiry ? new Date(newExpiry).toISOString() : null); if (r.ok) { setNewUser(""); setNewExpiry(""); } return r; })}
                    className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">Add</button>
                </div>
                <p className="mt-2 text-[12px] text-muted">A date makes it temporary: a contractor loses access on that day without anyone remembering.</p>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "structure" ? (
        <>
          <Panel title="Brands and locations" icon={<Building2 size={15} />}>
            {tree.length <= 1 ? (
              <p className="text-[13px] text-muted">Just this organization so far. Add a brand or a location beneath it and members here manage it too.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {tree.map((n) => (
                  <div key={n.id} className="flex items-center gap-2.5 py-1.5" style={{ paddingLeft: n.depth * 20 }}>
                    {n.kind === "location" ? <MapPin size={14} className="shrink-0 text-muted" /> : <Building2 size={14} className="shrink-0 text-muted" />}
                    <span className="text-[13.5px] text-ink">{n.name}</span>
                    <span className="text-[11.5px] uppercase tracking-wide text-muted">{n.kind}</span>
                    {n.profile_id ? <span className="text-[11.5px] text-pearl-muted">has its own page</span> : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {canManage ? (
            <div className="mt-4">
              <Panel title="Add beneath this organization" icon={<Plus size={15} />}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
                  <select aria-label="Organization unit type" value={childKind} onChange={(e) => setChildKind(e.target.value as "brand" | "location")} className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px]">
                    <option value="brand">Brand</option>
                    <option value="location">Location</option>
                  </select>
                  <input aria-label="Organization unit name" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder={childKind === "brand" ? "Brand name" : "Branch or store name"} className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px] outline-none focus:border-pearl" />
                  <button disabled={busy || !childName.trim()} onClick={() => void run("Added", async () => { const id = await createChild(org.id, childKind, childName.trim()); if (id) setChildName(""); return !!id; })}
                    className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">Add</button>
                </div>
                <p className="mt-2 text-[12px] text-muted">A brand or location has no page of its own until you ask for one, so nothing empty appears in the app.</p>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "desks" ? (
        <Panel title="Which desks this organization uses">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SURFACES.map((s) => {
              const on = surfaces[s] ?? false;
              return (
                <label key={s} className="flex items-center justify-between rounded-xl border border-ink/10 px-3.5 py-2.5">
                  <span className="text-[13.5px] text-ink">{SURFACE_LABEL[s]}</span>
                  <input type="checkbox" checked={on} disabled={!canManage || busy || s === "settings"} onChange={(e) => void run((e.target.checked ? "Enabled " : "Hidden ") + SURFACE_LABEL[s], () => setSurface(org.id, s, e.target.checked))} className="h-4 w-4 accent-pearl" />
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted">A desk switched off disappears from Studio's tabs for everyone in this organization. Settings cannot be switched off.</p>
        </Panel>
      ) : null}

      {tab === "agencies" ? (
        <>
          <Panel title="Working for this organization" icon={<Shield size={15} />}>
            {delegations.filter((d) => d.client_org_id === org.id).length === 0 ? (
              <p className="text-[13px] text-muted">No agency acts for you. Grant one below and it can work inside the desks you choose without owning anything.</p>
            ) : (
              <div className="flex flex-col">
                {delegations.filter((d) => d.client_org_id === org.id).map((d) => (
                  <div key={d.id} className="flex items-center gap-3 border-b border-ink/8 py-2.5 last:border-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink">{d.principal?.name ?? "Agency"}</span>
                      <span className="block text-[12px] text-muted">{d.scopes.map((s) => SURFACE_LABEL[s as Surface] ?? s).join(", ") || "no desks"}{d.expires_at ? " · until " + when(d.expires_at) : ""}</span>
                    </span>
                    {canManage ? <button disabled={busy} onClick={() => { if (window.confirm("Revoke this agency's access?")) void run("Revoked", () => revokeDelegation(org.id, d.principal_org_id)); }} className="rounded-full border border-ink/15 px-2.5 py-1 text-[12px] font-semibold text-ink/60 hover:bg-surface hover:text-ink">Revoke</button> : null}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {delegations.some((d) => d.principal_org_id === org.id) ? (
            <div className="mt-4">
              <Panel title="Clients you work for">
                {delegations.filter((d) => d.principal_org_id === org.id).map((d) => (
                  <div key={d.id} className="border-b border-ink/8 py-2.5 last:border-0">
                    <span className="block text-[13.5px] font-semibold text-ink">{d.client?.name ?? "Client"}</span>
                    <span className="block text-[12px] text-muted">{d.scopes.map((s) => SURFACE_LABEL[s as Surface] ?? s).join(", ")}{d.expires_at ? " · until " + when(d.expires_at) : ""}</span>
                  </div>
                ))}
              </Panel>
            </div>
          ) : null}

          {canManage ? (
            <div className="mt-4">
              <Panel title="Grant an agency access" icon={<Clock size={15} />}>
                <div className="flex flex-col gap-2">
                  <input aria-label="Agency username" value={agencySlug} onChange={(e) => setAgencySlug(e.target.value)} placeholder="Agency's @username" className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px] outline-none focus:border-pearl" />
                  <div className="flex flex-wrap gap-1.5">
                    {SURFACES.filter((s) => s !== "settings").map((s) => {
                      const on = agencyScopes.includes(s);
                      return (
                        <button key={s} type="button" onClick={() => setAgencyScopes((cur) => on ? cur.filter((x) => x !== s) : [...cur, s])}
                          className={"rounded-full px-3 py-1 text-[12px] font-semibold transition-colors " + (on ? "bg-pearl text-on-pearl" : "bg-surface text-muted hover:text-ink")}>{SURFACE_LABEL[s]}</button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input aria-label="Agency access expiry" type="date" value={agencyExpiry} onChange={(e) => setAgencyExpiry(e.target.value)} title="Access ends on this date, optional" className="rounded-xl border border-ink/15 px-3 py-2 text-[13.5px]" />
                    <button disabled={busy || !agencySlug.trim() || agencyScopes.length === 0} onClick={() => void run("Access granted", async () => { const r = await grantDelegation(org.id, agencySlug.replace(/^@/, ""), agencyScopes, agencyExpiry ? new Date(agencyExpiry).toISOString() : null); if (r.ok) { setAgencySlug(""); setAgencyExpiry(""); } return r; })}
                      className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">Grant</button>
                  </div>
                </div>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "history" ? (
        <Panel title="What changed, and who did it">
          {audit.length === 0 ? (
            <p className="text-[13px] text-muted">{canManage ? "Nothing recorded yet." : "Owners and admins can read the history."}</p>
          ) : (
            <div className="flex flex-col">
              {audit.map((a) => (
                <div key={a.id} className="flex items-baseline gap-3 border-b border-ink/8 py-2 last:border-0 text-[13px]">
                  <span className="w-[92px] shrink-0 text-[11.5px] text-muted">{new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span className="min-w-0 flex-1 text-ink/75">
                    <span className="font-semibold text-ink">{a.actor?.full_name ?? a.actor?.username ?? "Someone"}</span> · {a.action.replace(/_/g, " ")}
                    {a.meta && Object.keys(a.meta).length ? <span className="text-muted"> · {Object.entries(a.meta).filter(([, v]) => v !== null).map(([k, v]) => k + " " + String(v)).join(", ")}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
