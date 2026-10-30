"use client";

import { errorMessage } from "@/lib/errors";

import Link from "next/link";
import { displayImageUrl } from "@/lib/media";

import { StudioRailPortal } from "@/components/StudioRailPortal";
import { Panel } from "@/components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Smartphone, Users, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useStudio } from "@/components/StudioShell";
import { StudioLoadError } from "../LoadError";
import styles from "@/components/StudioWorkspace.module.css";
import { withTimeout } from "@/lib/withTimeout";

type Member = { id: string; display_name: string; role: string; active: boolean; last_sign_in_at: string | null; created_at: string };
type Device = { id: string; device_id: string; label: string | null; status: string; created_at: string; approved_at: string | null };
type Business = { category?: string | null; location?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; social_links?: Record<string, string> | null; hours?: Record<string, [string, string][]> | null; review_count?: number; avg_rating?: number | string | null; is_verified?: boolean };
type BusinessDraft = { category: string; location: string; address: string; phone: string; email: string; website: string; social: Record<string, string> };
type Info = { profile: { full_name: string; username: string; bio: string | null; avatar_url: string | null; is_verified: boolean } | null; business: Business | null; members: Member[]; devices: Device[]; signins: { member_name: string | null; device_id: string | null; created_at: string }[]; role: string | null };
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]] as const;
const ROLES = ["owner", "admin", "editor", "recruiter", "support"];
const CATS = ["Retail", "Food & Drink", "Services", "Technology", "Health", "Beauty", "Education", "Finance", "Construction", "Transport", "Agriculture", "Fashion", "Media", "Other"];

export default function SettingsPage() {
  const { accountId, refresh } = useStudio();
  const [supabase] = useState(createClient);
  const [info, setInfo] = useState<Info | null>(null);
  const [b, setB] = useState<BusinessDraft>({ category: "", location: "", address: "", phone: "", email: "", website: "", social: {} });
  const [bio, setBio] = useState("");
  const [hours, setHours] = useState<Record<string, [string, string][]>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const loadVersion = useRef(0);
  const working = useRef(false);
  const mounted = useRef(false);

  const load = useCallback(() => {
    const run = ++loadVersion.current;
    const read = async () => {
      const { data: authData, error: authError } = await supabase.auth.getSession();
      if (authError || authData.session?.user.id !== accountId) throw new Error("Your session changed. Reopen Studio settings.");
      const { data, error } = await supabase.rpc("studio_get_business");
      if (error || !data) throw error || new Error("Business settings are unavailable.");
      return { authData, data };
    };
    return withTimeout(read()).then(({ authData, data }) => {
      if (!mounted.current || run !== loadVersion.current) return;
      const i = data as Info; setUid(authData.session?.user.id ?? null); setInfo(i); setLoadError(null);
      setB({ category: i.business?.category || "", location: i.business?.location || "", address: i.business?.address || "", phone: i.business?.phone || "", email: i.business?.email || "", website: i.business?.website || "", social: i.business?.social_links || {} });
      setBio(i.profile?.bio || ""); setHours(i.business?.hours && typeof i.business.hours === "object" ? i.business.hours : {});
      setNewRole(role => i.members.length === 0 ? "owner" : role === "owner" ? "editor" : role);
    }).catch((error: unknown) => { if (mounted.current && run === loadVersion.current) setLoadError(error instanceof Error ? error.message : "Business settings could not be refreshed."); })
      .finally(() => { if (mounted.current && run === loadVersion.current) setLoading(false); });
  }, [supabase, accountId]);
  useEffect(() => { const requests = loadVersion; mounted.current = true; void load(); return () => { mounted.current = false; requests.current++; }; }, [load]);

  const isOwner = info?.role === "owner";
  const isAdmin = isOwner || info?.role === "admin";

  const act = async (fn: () => PromiseLike<{ error: unknown }>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setActionError(null); setNotice(null);
    try { const current = await supabase.auth.getSession(); if (current.error || current.data.session?.user.id !== accountId) throw new Error("Your account changed. Reopen settings."); const { error } = await fn(); if (error) throw error; if (!mounted.current) return; setNotice("Changes saved."); await load(); await refresh(); }
    catch (error) { if (mounted.current) setActionError(error && typeof error === "object" && "message" in error ? String(error.message) : "This action was not confirmed. Refresh before retrying."); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const saveBusiness = () => {
    const cleaned: Record<string, [string, string][]> = {};
    for (const [k, ranges] of Object.entries(hours)) { const ok = ranges.filter(r => /^\d{2}:\d{2}$/.test(r[0]) && /^\d{2}:\d{2}$/.test(r[1])); if (ok.length) cleaned[k] = ok; }
    void act(() => supabase.rpc("studio_set_business", { p_bio: bio, p_category: b.category || null, p_location: b.location || null, p_address: b.address || null, p_phone: b.phone || null, p_email: b.email || null, p_website: b.website || null, p_social: b.social || {}, p_hours: cleaned }));
  };
  const setDay = (k: string, open: boolean) => setHours(h => { const n = { ...h }; if (open) n[k] = n[k]?.length ? n[k] : [["08:00", "17:00"]]; else delete n[k]; return n; });
  const setRange = (k: string, i: number, j: 0 | 1, v: string) => setHours(h => { const n = { ...h }; const r = [...(n[k] || [])]; r[i] = [j === 0 ? v : r[i][0], j === 1 ? v : r[i][1]]; n[k] = r; return n; });
  const addMember = async () => {
    if (!newName.trim() || working.current) return;
    working.current = true; setBusy(true); setActionError(null); setCopied(false);
    try {
      const current = await supabase.auth.getSession();
      if (current.error || current.data.session?.user.id !== accountId) throw new Error("Your account changed. Reopen settings.");
      const { data, error } = await supabase.rpc("studio_create_member", { p_expected_user: accountId, p_name: newName.trim(), p_role: newRole });
      if (error) throw error;
      if (!mounted.current) return;
      setIssued({ name: newName.trim(), code: String(data) }); setNewName(""); await load(); await refresh();
    } catch (e: unknown) { if (mounted.current) setActionError(errorMessage(e, "Could not create the member.")); } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const copyCode = async () => { if (!issued) return; try { await navigator.clipboard.writeText(issued.code); if (mounted.current) { setCopied(true); setActionError(null); } } catch { if (mounted.current) setActionError("The access code could not be copied. Select the code and copy it manually."); } };

  if (!info) return <div><StudioLoadError message={loadError} retry={() => { setLoading(true); void load(); }} busy={loading} />{loading ? <p className="py-12 text-center text-sm text-muted" role="status">Loading settings…</p> : null}</div>;

  return (
    <div>
      <StudioLoadError message={loadError} retry={() => { setLoading(true); void load(); }} busy={loading} />
      {actionError ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{actionError}</p> : null}
      {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
      {info ? (
        <StudioRailPortal>
          <>
            <Link
              href="/studio/settings/organization"
              className="flex items-center justify-between rounded-2xl border border-pearl/50 bg-pearl/8 px-4 py-3.5 transition-colors duration-[140ms] hover:bg-pearl/12"
            >
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">Organization</span>
                <span className="block text-[12px] text-muted">Team, brands and locations, desks, agencies, history</span>
              </span>
              <span className="text-accent">&rarr;</span>
            </Link>

            <Panel title="Workspace">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted">Your role</span>
                <span className="font-semibold capitalize text-ink">{info.role ?? "member"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">Team</span>
                <span className="font-semibold text-ink">{info.members.length} {info.members.length === 1 ? "member" : "members"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">Verified</span>
                <span className={"font-semibold " + (info.profile?.is_verified ? "text-success" : "text-muted")}>
                  {info.profile?.is_verified ? "Yes" : "Not yet"}
                </span>
              </div>
            </Panel>

            {/* Devices are the only way into this workspace, so anything waiting
                for approval is a security decision rather than a setting. */}
            {info.devices.length > 0 ? (
              <Panel title="Devices">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted">Approved</span>
                  <span className="font-semibold text-ink">{info.devices.filter(d => d.status === "approved").length}</span>
                </div>
                {info.devices.filter(d => d.status === "pending").length > 0 ? (
                  <p className="mt-2 rounded-lg bg-pearl/12 px-2.5 py-2 text-[12.5px] text-ink">
                    <span className="font-semibold">{info.devices.filter(d => d.status === "pending").length}</span> waiting for approval
                  </p>
                ) : (
                  <p className="mt-2 text-[12.5px] text-muted">Nothing waiting for approval.</p>
                )}
              </Panel>
            ) : null}

            {info.signins.length > 0 ? (
              <Panel title="Recent sign-ins">
                <div className="flex flex-col gap-2">
                  {info.signins.slice(0, 4).map((x, i) => (
                    <div key={i}>
                      <p className="truncate text-[13px] text-ink">{x.member_name ?? "Unknown member"}</p>
                      <p className="text-[11.5px] text-muted">
                        {new Date(x.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </>
        </StudioRailPortal>
      ) : null}

      <h1 className="font-display text-[21px] leading-tight text-porcelain">Settings</h1>
      <p className="mt-1 text-[13px] text-muted">Business details and hours, who can work in Studio, and which devices may sign in.</p>

      <Link
        href="/studio/settings/organization"
        className="mt-4 flex items-center justify-between rounded-2xl border border-pearl/50 bg-pearl/8 px-4 py-3.5 transition-colors duration-[140ms] hover:bg-pearl/12"
      >
        <span>
          <span className="block text-[14px] font-semibold text-ink">Organization</span>
          <span className="block text-[12.5px] text-muted">Team and roles, brands and locations, which desks are on, agencies, history</span>
        </span>
        <span className="text-[18px] text-accent">&rarr;</span>
      </Link>

      <section className="mt-5 rounded-xl border border-ink/10 p-4">
        <div className="flex items-center gap-3">
          {info.profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(info.profile.avatar_url, 200) ?? info.profile.avatar_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : <span className="h-12 w-12 rounded-xl bg-navy" />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">{info.profile?.full_name} <VerifiedBadge userId={uid} size={15} /></p>
            <p className="text-[12px] text-muted">@{info.profile?.username}{info.business?.review_count ? " · " + Number(info.business.avg_rating).toFixed(1) + " from " + info.business.review_count + " reviews" : ""}{info.profile?.is_verified || info.business?.is_verified ? " · verified" : " · not verified, request verification from the admin team"}</p>
          </div>
        </div>
        <label className="mt-4 block text-xs font-semibold">Business bio<textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} placeholder="What you do, in two lines" className="mt-3 h-16 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" /></label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select aria-label="Business category" value={b.category} onChange={e => setB({ ...b, category: e.target.value })} className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none">{CATS.map(c => <option key={c} value={c}>{c}</option>)}{b.category && !CATS.includes(b.category) ? <option value={b.category}>{b.category}</option> : null}</select>
          <input aria-label="Business city" value={b.location} onChange={e => setB({ ...b, location: e.target.value })} placeholder="City" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input aria-label="Street address" value={b.address} onChange={e => setB({ ...b, address: e.target.value })} placeholder="Street address" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none sm:col-span-2" />
          <input aria-label="Business phone" type="tel" value={b.phone} onChange={e => setB({ ...b, phone: e.target.value })} placeholder="Phone" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input aria-label="Business email" type="email" value={b.email} onChange={e => setB({ ...b, email: e.target.value })} placeholder="Email" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input aria-label="Business website" type="url" value={b.website} onChange={e => setB({ ...b, website: e.target.value })} placeholder="Website" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none sm:col-span-2" />
        </div>
        <p className="mb-1.5 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Opening hours, Harare time</p>
        {DAYS.map(([k, l]) => (
          <div key={k} className="flex flex-wrap items-center gap-2 py-1">
            <label className="flex w-16 items-center gap-1.5 text-[13px] text-ink"><input type="checkbox" checked={!!hours[k]} onChange={e => setDay(k, e.target.checked)} /> {l}</label>
            {hours[k] ? hours[k].map((r, i) => (
              <span key={i} className="flex items-center gap-1 text-[12.5px] text-ink/60">
                <input type="time" aria-label={`${l} opening time`} value={r[0]} onChange={e => setRange(k, i, 0, e.target.value)} className="rounded-md border border-ink/15 bg-transparent px-2 py-1 text-[12.5px] text-ink outline-none" /> to
                <input type="time" aria-label={`${l} closing time`} value={r[1]} onChange={e => setRange(k, i, 1, e.target.value)} className="rounded-md border border-ink/15 bg-transparent px-2 py-1 text-[12.5px] text-ink outline-none" />
              </span>
            )) : <span className="text-[12.5px] text-muted">Closed</span>}
          </div>
        ))}
        {isAdmin ? <button onClick={saveBusiness} disabled={busy} className="mt-3 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-on-pearl disabled:opacity-40">{busy ? "Saving" : "Save details"}</button> : null}
      </section>

      <section className="mt-4 rounded-xl border border-ink/10 p-4">
        <p id="business-access-team" className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Users size={14} className="text-accent" /> Team</p>
        <p className="mt-1 text-[12.5px] text-muted">Each person signs in with the business handle and their own access code. Roles decide what they can do in Studio.</p>
        {info.members.map(m => (
          <div key={m.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <span className="text-[13.5px] font-semibold text-ink">{m.display_name}</span>
            {!m.active ? <span className="text-[10.5px] uppercase text-danger">inactive</span> : null}
            <span className="text-[11.5px] text-muted">{m.last_sign_in_at ? "last sign in " + new Date(m.last_sign_in_at).toLocaleDateString() : "never signed in"}</span>
            <span className="ml-auto" />
            {isOwner ? (
              <>
                <select aria-label={`Role for ${m.display_name}`} disabled={busy} value={m.role} onChange={e => act(() => supabase.rpc("studio_set_member_role", { p_member: m.id, p_role: e.target.value }))} className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-[12px] text-ink outline-none">{ROLES.map(r => <option key={r}>{r}</option>)}</select>
                <button onClick={() => confirm((m.active ? "Deactivate " : "Reactivate ") + m.display_name + "?") && act(() => supabase.rpc("studio_set_member_active", { p_member: m.id, p_active: !m.active }))} className="rounded-md px-2 py-1 text-[12px] text-ink/60 hover:text-ink">{m.active ? "Deactivate" : "Reactivate"}</button>
              </>
            ) : <span className="rounded bg-navy/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink">{m.role}</span>}
          </div>
        ))}
        {isOwner || info.members.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <input aria-label="New member name" disabled={busy} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" className="flex-1 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
            <select aria-label="New member role" disabled={busy || info.members.length === 0} value={newRole} onChange={e => setNewRole(e.target.value)} className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[13px] text-ink outline-none">{ROLES.map(r => <option key={r}>{r}</option>)}</select>
            <button onClick={addMember} disabled={busy || !newName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"><KeyRound size={13} /> Issue access code</button>
          </div>
        ) : null}
        {info.members.length === 0 ? <p className="mt-3 text-xs text-muted">The first member must be the workspace owner. Creating this member binds the current session to that owner.</p> : null}
        {issued ? (
          <div className="mt-3 rounded-lg border border-pearl/50 bg-pearl/10 p-3">
            <p className="text-[13px] text-ink">Access code for <span className="font-semibold">{issued.name}</span>. It is shown once, copy it now.</p>
            <p className="mt-1 flex items-center gap-2 font-mono text-[18px] tracking-widest text-ink">{issued.code} <button onClick={() => void copyCode()} className="rounded-md bg-surface p-2 text-ink/60" aria-label={copied ? "Access code copied" : "Copy access code"}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></p>
            <button onClick={() => setIssued(null)} className="mt-2 text-[12px] text-muted">Dismiss</button>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-ink/10 p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Smartphone size={14} className="text-accent" /> Devices</p>
        <p className="mt-1 text-[12.5px] text-muted">Only approved devices can sign in as the business. New devices wait here for approval.</p>
        {info.devices.length === 0 ? <p className="mt-2 text-[12.5px] text-muted">No devices yet.</p> : info.devices.map(d => (
          <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <span className="text-[13px] text-ink">{d.label || "Device"}</span>
            <span className="font-mono text-[11px] text-muted">{d.device_id.slice(0, 12)}</span>
            <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + (d.status === "approved" ? "bg-success/15 text-success" : "bg-pearl/15 text-accent")}>{d.status}</span>
            <span className="ml-auto" />
            {isAdmin && d.status !== "approved" ? <button onClick={() => act(() => supabase.rpc("studio_set_device", { p_device: d.id, p_action: "approve" }))} className="rounded-md bg-success/15 px-2.5 py-1 text-[12px] font-semibold text-success">Approve</button> : null}
            {isAdmin ? <button onClick={() => confirm("Remove this device? It will need approval again.") && act(() => supabase.rpc("studio_set_device", { p_device: d.id, p_action: "remove" }))} className="rounded-md px-2 py-1 text-[12px] text-danger">Remove</button> : null}
          </div>
        ))}
        {info.signins.length ? (
          <>
            <p className="mb-1 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Recent sign-ins</p>
            {info.signins.slice(0, 8).map((s, i) => <p key={i} className="text-[12px] text-muted">{s.member_name || "Member"} · {s.device_id ? s.device_id.slice(0, 12) : "unknown device"} · {new Date(s.created_at).toLocaleString()}</p>)}
          </>
        ) : null}
      </section>
    </div>
  );
}
