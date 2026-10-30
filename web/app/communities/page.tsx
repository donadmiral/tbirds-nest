"use client";

import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, Radio, Search, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "@/components/SocialWorkspace.module.css";

type Comm = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
  has_invite?: boolean;
};

export default function CommunitiesPage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const page = useSocialPages<Comm>("get_communities_page", { p_query: query.trim() || null });
  const { items: rows, loading } = page;
  const [actionError, setActionError] = useState<string | null>(null);
  const locks = useRef(new Set<string>());const actionEpoch=useRef(0);
  const [me, setMe] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [gName, setGName] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [gRules, setGRules] = useState("");
  const [gMode, setGMode] = useState<"open" | "approval" | "invite">("open");
  const [gColor, setGColor] = useState("sky");
  const [gCat, setGCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let alive = true, uid:string|null|undefined;
    const bind=(next:string|null)=>{if(!alive||next===uid)return;uid=next;actionEpoch.current++;locks.current.clear();setBusy(false);setJoining(null);setCreating(false);setGName('');setGDesc('');setGRules('');setMe(next);setActionError(null);};
    const {data:auth}=supabase.auth.onAuthStateChange((_event,session)=>bind(session?.user.id??null));
    withTimeout(supabase.auth.getSession()).then(({data,error})=>{if(error)throw error;if(uid===undefined)bind(data.session?.user.id??null);}).catch(()=>{if(alive)setActionError('Your session could not be loaded. Reload to try again.');});
    return()=>{alive=false;actionEpoch.current++;auth.subscription.unsubscribe();};
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const join = async (c: Comm) => {
    if (!me || locks.current.has(c.id)) return;
    locks.current.add(c.id); setJoining(c.id); setActionError(null);
    const version = actionEpoch.current;
    try {
    const { error } = await withTimeout(supabase.rpc("join_community", { p_community: c.id }));
    if (error) throw error;
    if (version !== actionEpoch.current) return;
    await page.reload();
    } catch { if(version===actionEpoch.current)setActionError("Could not join this community. Please try again."); }
    finally { if(version===actionEpoch.current){locks.current.delete(c.id);setJoining(null);} }
  };

  const create = async () => {
    const nm = gName.trim();
    if (!nm || !me || locks.current.has("create")) return;
    const version=actionEpoch.current;locks.current.add("create"); setActionError(null);
    setBusy(true);
    try {
      const { data, error } = await withTimeout(supabase.rpc("create_community", {
        p_name: nm, p_description: gDesc.trim() || null, p_category: gCat,
        p_join_mode: gMode, p_cover_color: gColor, p_rules: gRules.trim() || null,
      }));
      if (error) throw error;
      if(version!==actionEpoch.current)return;
      const id = typeof data === "string" ? data : (data as any)?.id;
      if (!id) throw new Error("Community creation was not confirmed. Check the directory before retrying.");
      setCreating(false);setGName("");setGDesc("");setGRules("");
      router.push("/communities/" + encodeURIComponent(id));
    } catch (err: any) { if(version===actionEpoch.current)setActionError(err?.message || "Could not create the community."); }
    finally { if(version===actionEpoch.current){locks.current.delete("create"); setBusy(false);} }
  };

  const catLabel = (key: string | null) => key ? (CATEGORIES.find(c => c.key === key)?.label || key) : null;

  return <main className={styles.directory}>
    <header className={styles.heading}><div><h1>Communities</h1><p>Find your people. Make room for a shared interest.</p></div>{me ? <button className={styles.primary} onClick={() => { setActionError(null); setCreating(true); }}><Plus size={18} aria-hidden />New community</button> : <Link href="/login" className={styles.button}>Sign in to join</Link>}</header>
    <nav className={styles.tabs} aria-label="Circles"><Link href="/communities" aria-current="page"><Users size={17} aria-hidden />Communities</Link><Link href="/channels"><Radio size={17} aria-hidden />Channels</Link></nav>
    <div className={styles.toolbar}><div className={styles.search}><Search size={18} aria-hidden /><input value={q} onChange={event => setQ(event.target.value)} aria-label="Search communities" placeholder="Search communities by name or interest" />{q ? <button onClick={() => setQ('')} aria-label="Clear community search"><X size={17} aria-hidden /></button> : null}</div><span className={styles.hint}>Conversations, ideas and shared experiences.</span></div>
    {actionError && !creating ? <p role="alert" className={styles.error}>{actionError}</p> : null}
    {loading && rows.length === 0 ? <p role="status" className={styles.empty}>Loading communities…</p> : !rows.length && !page.error ? <section className={styles.empty}><Users size={30} strokeWidth={1.5} aria-hidden /><h2>{q ? 'No communities found' : 'A place for your people'}</h2><p>{q ? 'Try another name or interest, or clear your search to explore.' : 'Start a community around the things you care about.'}</p>{q ? <button className={styles.button} onClick={() => setQ('')}>Clear search</button> : me ? <button className={styles.primary} onClick={() => setCreating(true)}>Create a community</button> : null}</section> : <ul className={styles.list}>
      {rows.map(c => <li key={c.id} className={styles.card}><Link href={'/communities/' + c.id} className={styles.cardLink}>{c.icon_url ? <img src={c.icon_url} alt="" className={styles.icon} /> : <span className={styles.icon} style={{ background: COMM_COLORS[c.cover_color] || COMM_COLORS.sky, color: '#14213a' }}><Users size={27} strokeWidth={1.5} aria-hidden /></span>}<div><h2>{c.name}</h2><span className={styles.meta}>{Number.isFinite(c.member_count) ? c.member_count.toLocaleString() : '—'} {c.member_count === 1 ? 'member' : 'members'}{catLabel(c.category) ? ' · ' + catLabel(c.category) : ''}</span>{c.description ? <p>{c.description}</p> : null}</div></Link>{c.is_member ? <span className={styles.status}><Check size={14} aria-hidden />Joined</span> : c.has_pending ? <span className={styles.status}>Requested</span> : c.join_mode === 'invite' && !c.has_invite ? <span className={styles.status}>Invite only</span> : me ? <button className={styles.button} disabled={!!joining} onClick={() => void join(c)} aria-label={`${c.has_invite ? 'Accept invitation to' : c.join_mode === 'approval' ? 'Request to join' : 'Join'} ${c.name}`}>{joining === c.id ? 'Joining…' : c.has_invite ? 'Accept invite' : c.join_mode === 'approval' ? 'Request to join' : 'Join community'}</button> : null}</li>)}
    </ul>}
    <SocialPageFooter {...page} />
    <ProductDialog open={creating} title="New community" description="Choose the purpose and who can join. Your draft stays here when you close this window." busy={busy} onClose={() => setCreating(false)}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void create(); }}>
        <label>Community name<input autoFocus required disabled={busy} value={gName} onChange={event => setGName(event.target.value)} maxLength={60} placeholder="Give your community a name" /></label>
        <label>About this community<textarea disabled={busy} value={gDesc} onChange={event => setGDesc(event.target.value)} maxLength={200} placeholder="What brings everyone together?" /><small>{gDesc.length}/200 characters · optional</small></label>
        <fieldset disabled={busy}><legend>Who can join</legend><div className={styles.choices}>{(['open', 'approval', 'invite'] as const).map(mode => <button type="button" key={mode} aria-pressed={gMode === mode} onClick={() => setGMode(mode)}>{mode === 'open' ? 'Open to everyone' : mode === 'approval' ? 'Approval required' : 'Invite only'}</button>)}</div></fieldset>
        <label>Category<select disabled={busy} value={gCat ?? ''} onChange={event => setGCat(event.target.value || null)}><option value="">Choose a category (optional)</option>{CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
        <fieldset disabled={busy}><legend>Cover color</legend><div className={styles.colors}>{Object.entries(COMM_COLORS).map(([key, color]) => <button type="button" key={key} onClick={() => setGColor(key)} aria-label={`${key} cover`} aria-pressed={gColor === key} style={{ background: color }}>{gColor === key ? <Check size={18} aria-hidden /> : null}</button>)}</div></fieldset>
        <label>Community rules<textarea disabled={busy} value={gRules} onChange={event => setGRules(event.target.value)} maxLength={600} placeholder="Help people understand how to take part." /><small>Shown to people before they join · optional</small></label>
        {actionError ? <p role="alert" className={styles.error}>{actionError}</p> : null}
        <footer className={styles.footer}><button type="button" className={styles.button} disabled={busy} onClick={() => setCreating(false)}>Cancel</button><button type="submit" disabled={!gName.trim() || busy} className={styles.primary}>{busy ? 'Creating…' : 'Create community'}</button></footer>
      </form>
    </ProductDialog>
  </main>;
}
