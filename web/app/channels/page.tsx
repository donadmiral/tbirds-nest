"use client";
import NextImage from "next/image";

import { createdId } from "@/lib/errors";

import { useEffect, useRef, useState } from "react";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, Radio, Search, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

import { withTimeout } from "@/lib/withTimeout";
import { ProductDialog } from "@/components/ProductDialog";
import styles from "@/components/SocialWorkspace.module.css";

type Ch = { id: string; name: string; description: string | null; icon_url: string | null; member_count: number; is_member: boolean; my_role: string | null; owner_username: string | null };

export default function ChannelsPage() {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const page = useSocialPages<Ch>("get_channels_page", { p_query: query.trim() || null });
  const { items: rows, loading } = page;
  const [actionError, setActionError] = useState<string | null>(null);
  const locks = useRef(new Set<string>());
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cAud, setCAud] = useState<"everyone" | "followers">("everyone");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const mounted = useRef(true), scope = useRef(0);

  useEffect(() => {
    let alive = true; let known = false;
    mounted.current = true;
    const bind = (id: string | null) => {
      if (!alive) return;
      if (account.current !== id) { scope.current += 1; account.current = id; setCreating(false); setCName(""); setCDesc(""); setBusy(false); setJoining(null); setActionError(null); }
      setMe(id);
    };
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => { known = true; bind(session?.user.id ?? null); });
    withTimeout(supabase.auth.getSession()).then(({ data, error }) => { if(error) throw error; if (!known) bind(data.session?.user.id ?? null); }).catch(() => { if (alive && !known) setActionError("Your session could not be loaded. Reload to retry."); });
    return () => { alive = false; mounted.current = false; scope.current += 1; auth.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const join = async (ch: Ch) => {
    const key = me + ":join:" + ch.id;
    if (!me || account.current !== me || locks.current.has(key)) return;
    locks.current.add(key); setJoining(ch.id); setActionError(null);
    const version = page.version();
    try {
      const { error } = await withTimeout(supabase.rpc("join_channel", { p_channel: ch.id }));
      if (error) throw error;
      if (version !== page.version()) return;
      await page.reload();
    } catch { if (mounted.current && account.current === me && version === page.version()) setActionError("Could not join this channel. Please try again."); }
    finally { locks.current.delete(key); if (mounted.current && account.current === me) setJoining(null); }
  };

  const create = async () => {
    const nm = cName.trim();
    const key = me + ":create", version = scope.current;
    const current = () => mounted.current && version === scope.current && account.current === me;
    if (!nm || !me || !current() || locks.current.has(key)) return;
    locks.current.add(key); setActionError(null);
    setBusy(true);
    try {
      const { data, error } = await withTimeout(supabase.rpc("create_channel", { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud }));
      if (error) throw error;
      if (!current()) return;
      const id = createdId(data);
      if (!id) throw new Error("Creation was not confirmed.");
      setCreating(false); setCName(""); setCDesc(""); setCAud("everyone");
      router.push("/channels/" + id);
    } catch { if (current()) setActionError("Channel creation was not confirmed. Refresh the directory before retrying."); } finally { locks.current.delete(key); if (current()) setBusy(false); }
  };

  const chLink = (ch: Ch) => "/channels/" + ch.id;

  return <section className={styles.directory}>
    <header className={styles.heading}><div><h1>Channels</h1><p>Stay close to the voices and updates you care about.</p></div>{me ? <button className={styles.primary} onClick={() => { setActionError(null); setCreating(true); }}><Plus size={18} aria-hidden />New channel</button> : <Link href="/login" className={styles.button}>Sign in to join</Link>}</header>
    <nav className={styles.tabs} aria-label="Circles"><Link href="/communities"><Users size={17} aria-hidden />Communities</Link><Link href="/channels" aria-current="page"><Radio size={17} aria-hidden />Channels</Link></nav>
    <div className={styles.toolbar}><div className={styles.search}><Search size={18} aria-hidden /><input value={q} onChange={event => setQ(event.target.value)} aria-label="Search channels" placeholder="Search channels by name or topic" />{q ? <button onClick={() => setQ('')} aria-label="Clear channel search"><X size={17} aria-hidden /></button> : null}</div><span className={styles.hint}>Hosts publish. Members stay connected.</span></div>
    {actionError && !creating ? <p role="alert" className={styles.error}>{actionError}</p> : null}
    {loading && !rows.length ? <p role="status" className={styles.empty}>Loading channels…</p> : !rows.length && !page.error ? <section className={styles.empty}><Radio size={30} strokeWidth={1.5} aria-hidden /><h2>{q ? 'No channels found' : 'A direct line to your audience'}</h2><p>{q ? 'Try another name or topic, or clear your search to explore.' : 'Create a channel to share announcements and updates.'}</p>{q ? <button className={styles.button} onClick={() => setQ('')}>Clear search</button> : me ? <button className={styles.primary} onClick={() => setCreating(true)}>Create a channel</button> : null}</section> : <ul className={styles.list}>
      {rows.map(ch => <li key={ch.id} className={styles.card}><Link href={chLink(ch)} className={styles.cardLink}>{ch.icon_url ? <NextImage unoptimized width={70} height={70} src={ch.icon_url} alt="" className={styles.icon} /> : <span className={styles.icon}><Radio size={27} strokeWidth={1.5} aria-hidden /></span>}<div><h2>{ch.name}</h2><span className={styles.meta}>{Number.isFinite(ch.member_count) ? ch.member_count.toLocaleString() : '—'} {ch.member_count === 1 ? 'member' : 'members'}{ch.owner_username ? ' · @' + ch.owner_username : ''}</span>{ch.description ? <p>{ch.description}</p> : null}</div></Link>{ch.is_member ? <span className={styles.status}><Check size={14} aria-hidden />Joined</span> : me ? <button className={styles.button} disabled={!!joining} onClick={() => void join(ch)} aria-label={`Join ${ch.name}`}>{joining === ch.id ? 'Joining…' : 'Join channel'}</button> : null}</li>)}
    </ul>}
    <SocialPageFooter {...page} />
    <ProductDialog open={creating} title="New channel" description="Give your audience a place for announcements. Your draft stays here when you close this window." busy={busy} onClose={() => setCreating(false)}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void create(); }}>
        <label>Channel name<input autoFocus required disabled={busy} value={cName} onChange={event => setCName(event.target.value)} maxLength={60} placeholder="Give your channel a name" /></label>
        <label>About this channel<textarea disabled={busy} value={cDesc} onChange={event => setCDesc(event.target.value)} maxLength={160} placeholder="What can members expect?" /><small>{cDesc.length}/160 characters · optional</small></label>
        <fieldset disabled={busy}><legend>Who can join</legend><div className={styles.choices}>{(['everyone', 'followers'] as const).map(audience => <button type="button" key={audience} onClick={() => setCAud(audience)} aria-pressed={cAud === audience}>{audience === 'everyone' ? 'Everyone' : 'My followers'}</button>)}</div><small>Only hosts and approved collaborators can publish updates.</small></fieldset>
        {actionError ? <p role="alert" className={styles.error}>{actionError}</p> : null}
        <footer className={styles.footer}><button type="button" className={styles.button} disabled={busy} onClick={() => setCreating(false)}>Cancel</button><button type="submit" disabled={!cName.trim() || busy} className={styles.primary}>{busy ? 'Creating…' : 'Create channel'}</button></footer>
      </form>
    </ProductDialog>
  </section>;
}
