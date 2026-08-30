"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Copy, KeyRound, Smartphone, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStudio } from "@/components/StudioShell";

type Member = { id: string; display_name: string; role: string; active: boolean; last_sign_in_at: string | null; created_at: string };
type Device = { id: string; device_id: string; label: string | null; status: string; created_at: string; approved_at: string | null };
type Info = { profile: { full_name: string; username: string; bio: string | null; avatar_url: string | null; is_verified: boolean } | null; business: any; members: Member[]; devices: Device[]; signins: { member_name: string | null; device_id: string | null; created_at: string }[]; role: string | null };
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]] as const;
const ROLES = ["owner", "admin", "editor", "recruiter", "support"];
const CATS = ["Retail", "Food & Drink", "Services", "Technology", "Health", "Beauty", "Education", "Finance", "Construction", "Transport", "Agriculture", "Fashion", "Media", "Other"];

export default function SettingsPage() {
  const { me, refresh } = useStudio();
  const supabase = useRef(createClient()).current;
  const [info, setInfo] = useState<Info | null>(null);
  const [b, setB] = useState<any>({});
  const [bio, setBio] = useState("");
  const [hours, setHours] = useState<Record<string, [string, string][]>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("admin");
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("studio_get_business");
    if (error) { alert(error.message); return; }
    const i = data as Info;
    setInfo(i);
    setB({ category: i.business?.category || "", location: i.business?.location || "", address: i.business?.address || "", phone: i.business?.phone || "", email: i.business?.email || "", website: i.business?.website || "", social: i.business?.social_links || {} });
    setBio(i.profile?.bio || "");
    setHours(i.business?.hours && typeof i.business.hours === "object" ? i.business.hours : {});
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const isOwner = info?.role === "owner";
  const isAdmin = isOwner || info?.role === "admin";

  const act = async (fn: () => PromiseLike<{ error: any }>) => {
    if (busy) return;
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; await load(); await refresh(); }
    catch (e: any) { alert(e?.message || "Action failed."); }
    finally { setBusy(false); }
  };
  const saveBusiness = () => {
    const cleaned: Record<string, [string, string][]> = {};
    for (const [k, ranges] of Object.entries(hours)) { const ok = ranges.filter(r => /^\d{2}:\d{2}$/.test(r[0]) && /^\d{2}:\d{2}$/.test(r[1])); if (ok.length) cleaned[k] = ok; }
    void act(() => supabase.rpc("studio_set_business", { p_bio: bio, p_category: b.category || null, p_location: b.location || null, p_address: b.address || null, p_phone: b.phone || null, p_email: b.email || null, p_website: b.website || null, p_social: b.social || {}, p_hours: cleaned }));
  };
  const setDay = (k: string, open: boolean) => setHours(h => { const n = { ...h }; if (open) n[k] = n[k]?.length ? n[k] : [["08:00", "17:00"]]; else delete n[k]; return n; });
  const setRange = (k: string, i: number, j: 0 | 1, v: string) => setHours(h => { const n = { ...h }; const r = [...(n[k] || [])]; r[i] = [j === 0 ? v : r[i][0], j === 1 ? v : r[i][1]]; n[k] = r; return n; });
  const addMember = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("studio_create_member", { p_name: newName.trim(), p_role: newRole });
      if (error) throw error;
      setIssued({ name: newName.trim(), code: String(data) }); setNewName(""); await load();
    } catch (e: any) { alert(e?.message || "Could not create the member."); } finally { setBusy(false); }
  };

  if (!info) return <p className="py-12 text-center text-sm text-ink/40">Loading</p>;

  return (
    <div className="max-w-[860px]">
      <h1 className="font-display text-[21px] leading-tight text-porcelain">Settings</h1>
          <p className="mt-0.5 text-[13px] text-ink/50">Your business profile, team and access.</p>
      <p className="mt-1 text-[13px] text-ink/50">Business details and hours, who can work in Studio, and which devices may sign in.</p>

      <section className="mt-5 rounded-xl border border-ink/10 p-4">
        <div className="flex items-center gap-3">
          {info.profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.profile.avatar_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : <span className="h-12 w-12 rounded-xl bg-navy" />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">{info.profile?.full_name}{info.profile?.is_verified || info.business?.is_verified ? <BadgeCheck size={15} className="text-pearl" /> : null}</p>
            <p className="text-[12px] text-ink/45">@{info.profile?.username}{info.business?.review_count ? " · " + Number(info.business.avg_rating).toFixed(1) + " from " + info.business.review_count + " reviews" : ""}{info.profile?.is_verified || info.business?.is_verified ? " · verified" : " · not verified, request verification from the admin team"}</p>
          </div>
        </div>
        <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={300} placeholder="What you do, in two lines" className="mt-3 h-16 w-full rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select value={b.category} onChange={e => setB({ ...b, category: e.target.value })} className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none">{CATS.map(c => <option key={c} value={c}>{c}</option>)}{b.category && !CATS.includes(b.category) ? <option value={b.category}>{b.category}</option> : null}</select>
          <input value={b.location} onChange={e => setB({ ...b, location: e.target.value })} placeholder="City" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input value={b.address} onChange={e => setB({ ...b, address: e.target.value })} placeholder="Street address" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none sm:col-span-2" />
          <input value={b.phone} onChange={e => setB({ ...b, phone: e.target.value })} placeholder="Phone" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input value={b.email} onChange={e => setB({ ...b, email: e.target.value })} placeholder="Email" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none" />
          <input value={b.website} onChange={e => setB({ ...b, website: e.target.value })} placeholder="Website" className="rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13.5px] text-ink outline-none sm:col-span-2" />
        </div>
        <p className="mb-1.5 mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Opening hours, Harare time</p>
        {DAYS.map(([k, l]) => (
          <div key={k} className="flex flex-wrap items-center gap-2 py-1">
            <label className="flex w-16 items-center gap-1.5 text-[13px] text-ink"><input type="checkbox" checked={!!hours[k]} onChange={e => setDay(k, e.target.checked)} /> {l}</label>
            {hours[k] ? hours[k].map((r, i) => (
              <span key={i} className="flex items-center gap-1 text-[12.5px] text-ink/60">
                <input type="time" value={r[0]} onChange={e => setRange(k, i, 0, e.target.value)} className="rounded-md border border-ink/15 bg-transparent px-2 py-1 text-[12.5px] text-ink outline-none" /> to
                <input type="time" value={r[1]} onChange={e => setRange(k, i, 1, e.target.value)} className="rounded-md border border-ink/15 bg-transparent px-2 py-1 text-[12.5px] text-ink outline-none" />
              </span>
            )) : <span className="text-[12.5px] text-ink/40">Closed</span>}
          </div>
        ))}
        {isAdmin ? <button onClick={saveBusiness} disabled={busy} className="mt-3 rounded-md bg-pearl px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40">{busy ? "Saving" : "Save details"}</button> : null}
      </section>

      <section className="mt-4 rounded-xl border border-ink/10 p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Users size={14} className="text-pearl" /> Team</p>
        <p className="mt-1 text-[12.5px] text-ink/50">Each person signs in with the business handle and their own access code. Roles decide what they can do in Studio.</p>
        {info.members.map(m => (
          <div key={m.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <span className="text-[13.5px] font-semibold text-ink">{m.display_name}</span>
            {!m.active ? <span className="text-[10.5px] uppercase text-red-400">inactive</span> : null}
            <span className="text-[11.5px] text-ink/45">{m.last_sign_in_at ? "last sign in " + new Date(m.last_sign_in_at).toLocaleDateString() : "never signed in"}</span>
            <span className="ml-auto" />
            {isOwner ? (
              <>
                <select value={m.role} onChange={e => act(() => supabase.rpc("studio_set_member_role", { p_member: m.id, p_role: e.target.value }))} className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-[12px] text-ink outline-none">{ROLES.map(r => <option key={r}>{r}</option>)}</select>
                <button onClick={() => confirm((m.active ? "Deactivate " : "Reactivate ") + m.display_name + "?") && act(() => supabase.rpc("studio_set_member_active", { p_member: m.id, p_active: !m.active }))} className="rounded-md px-2 py-1 text-[12px] text-ink/60 hover:text-ink">{m.active ? "Deactivate" : "Reactivate"}</button>
              </>
            ) : <span className="rounded bg-navy/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink">{m.role}</span>}
          </div>
        ))}
        {isOwner ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Person's name" className="flex-1 rounded-md border border-ink/15 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none" />
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-[13px] text-ink outline-none">{ROLES.map(r => <option key={r}>{r}</option>)}</select>
            <button onClick={addMember} disabled={busy || !newName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"><KeyRound size={13} /> Issue access code</button>
          </div>
        ) : null}
        {issued ? (
          <div className="mt-3 rounded-lg border border-pearl/50 bg-pearl/10 p-3">
            <p className="text-[13px] text-ink">Access code for <span className="font-semibold">{issued.name}</span>. It is shown once, copy it now.</p>
            <p className="mt-1 flex items-center gap-2 font-mono text-[18px] tracking-widest text-ink">{issued.code} <button onClick={() => navigator.clipboard.writeText(issued.code)} className="rounded-md bg-surface p-1 text-ink/60" aria-label="Copy"><Copy size={13} /></button></p>
            <button onClick={() => setIssued(null)} className="mt-2 text-[12px] text-ink/50">Dismiss</button>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-ink/10 p-4">
        <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink"><Smartphone size={14} className="text-pearl" /> Devices</p>
        <p className="mt-1 text-[12.5px] text-ink/50">Only approved devices can sign in as the business. New devices wait here for approval.</p>
        {info.devices.length === 0 ? <p className="mt-2 text-[12.5px] text-ink/45">No devices yet.</p> : info.devices.map(d => (
          <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
            <span className="text-[13px] text-ink">{d.label || "Device"}</span>
            <span className="font-mono text-[11px] text-ink/45">{d.device_id.slice(0, 12)}</span>
            <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + (d.status === "approved" ? "bg-success/15 text-success" : "bg-pearl/15 text-pearl")}>{d.status}</span>
            <span className="ml-auto" />
            {isAdmin && d.status !== "approved" ? <button onClick={() => act(() => supabase.rpc("studio_set_device", { p_device: d.id, p_status: "approved" }))} className="rounded-md bg-success/15 px-2.5 py-1 text-[12px] font-semibold text-success">Approve</button> : null}
            {isAdmin ? <button onClick={() => confirm("Remove this device? It will need approval again.") && act(() => supabase.rpc("studio_set_device", { p_device: d.id, p_status: "removed" }))} className="rounded-md px-2 py-1 text-[12px] text-red-400">Remove</button> : null}
          </div>
        ))}
        {info.signins.length ? (
          <>
            <p className="mb-1 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">Recent sign-ins</p>
            {info.signins.slice(0, 8).map((s, i) => <p key={i} className="text-[12px] text-ink/55">{s.member_name || "Member"} · {s.device_id ? s.device_id.slice(0, 12) : "unknown device"} · {new Date(s.created_at).toLocaleString()}</p>)}
          </>
        ) : null}
      </section>
    </div>
  );
}
