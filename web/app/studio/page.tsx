"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, Briefcase, CalendarClock, CheckCircle2, FileText, Handshake, Image as ImageIcon, Inbox, Megaphone, Newspaper, Plus, RefreshCw, ShoppingBag, Star, Users, Wallet } from "lucide-react";
import { listScheduled, studioHome, type ScheduledPost, type StudioHome } from "@/lib/studio";
import { useStudio } from "@/components/StudioShell";
import { useUploadPreview } from "@/lib/useUploadPreview";
import { StudioLoadError } from "./LoadError";
import styles from "@/components/StudioWorkspace.module.css";

export default function StudioHomePage() {
  const { me } = useStudio();
  return me?.is_business ? <BusinessOverview /> : <CreatorOverview />;
}

function CreatorOverview() {
  const { me } = useStudio();
  const tools = [
    { icon: FileText, title: "Create a post", text: "Share photos, video, an article or a poll with your audience.", href: "/write" },
    { icon: ImageIcon, title: "Create a story", text: "Open the story editor, add media and preview before publishing.", href: "/story/new" },
    { icon: Handshake, title: "Creator partnerships", text: "Review briefs, submit work and manage permission for your content.", href: "/studio/partnerships" },
    { icon: Wallet, title: "Earnings and payouts", text: "See recorded earnings, your creator status and IntoBank connection.", href: "/studio/earnings" },
    { icon: Inbox, title: "Your inbox", text: "Continue a conversation with your audience or a collaborator.", href: "/messages" },
    { icon: Users, title: "Your public profile", text: "Review how your posts, memory books and account appear to others.", href: me?.username ? `/${me.username}` : "/settings" },
  ];
  return <div>
    <header className={styles.pageHeader}><div><h1>Creator Studio</h1><p>Create, collaborate and manage your professional work in one place.</p></div><div className={styles.actions}><Link className={styles.buttonPrimary} href="/write"><Plus size={17} /> Create content</Link></div></header>
    <section className={styles.card}><div className={styles.cardBody}><span className={styles.status}>Your workspace</span><h2 className="mt-4 text-2xl font-bold tracking-tight">Make something worth sharing.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">Start with a post, build a story, or open a partnership brief. Your work stays connected to your Platinum Circles account.</p><div className={`${styles.actions} mt-5`}><Link href="/studio/partnerships" className={styles.button}>Open partnerships <ArrowRight size={15} /></Link><Link href="/studio/earnings" className={styles.button}>View earnings <ArrowRight size={15} /></Link></div></div></section>
    <div className={`${styles.serviceGrid} ${styles.sectionGap}`}>{tools.map(tool => <Link key={tool.href} href={tool.href} className={styles.service}><tool.icon size={23} strokeWidth={1.7} /><div><h3>{tool.title}</h3><p>{tool.text}</p></div></Link>)}</div>
    <section className={`${styles.card} ${styles.sectionGap}`}><div className={styles.cardBody}><h2 className="text-base font-semibold">Working with a team?</h2><p className="mt-2 text-sm text-muted">A business workspace adds a publishing planner, campaigns, newsroom approvals and team roles.</p><Link className={`${styles.button} mt-4`} href="/businesses">Explore business accounts <ArrowRight size={15} /></Link></div></section>
  </div>;
}

function BusinessOverview() {
  const { me } = useStudio();
  const [home, setHome] = useState<StudioHome | null>(null);
  const [rows, setRows] = useState<ScheduledPost[]>([]);
  const preview = useUploadPreview(rows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    try {
      const [summary, scheduled] = await Promise.all([studioHome(), listScheduled()]);
      if (run !== generation.current) return;
      if (!summary) throw new Error("Overview unavailable");
      setHome(summary); setRows(scheduled); setError(null);
    } catch { if (run === generation.current) setError("Your business overview could not be refreshed. The last confirmed information is still shown."); }
    finally { if (run === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { let active=true; void Promise.resolve().then(()=>{if(active)void load();}); return () => { active=false; generation.current++; }; }, [load]);
  const shown = rows.filter(row => filter === "all" || row.status === filter).sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0,6);
  const attention = home ? [
    { n: home.todos.failed_posts, label: "Publishing issues", href: "/studio/planner?filter=failed", icon: AlertTriangle },
    { n: home.todos.scheduled_today, label: "Scheduled today", href: "/studio/planner", icon: CalendarClock },
    { n: home.todos.unanswered, label: "Unanswered messages", href: "/studio/inbox", icon: Inbox },
    { n: home.todos.ads_ending, label: "Campaigns ending soon", href: "/studio/ads", icon: Megaphone },
  ] : [];
  const services = [
    { icon: ShoppingBag, title: "Commerce", line: "Manage your products and fulfilment.", href: "/studio/commerce" },
    { icon: Briefcase, title: "Recruiter", line: home ? `${home.todos.applicants.toLocaleString()} applications waiting for review` : "Manage jobs and applications.", href: "/studio/recruiter" },
    { icon: Star, title: "Customer reviews", line: home ? `${home.todos.reviews.toLocaleString()} new reviews this month` : "Read customer feedback and reply.", href: "/studio/reviews" },
  ];
  return <div>
    <header className={styles.pageHeader}><div><h1>Business Studio</h1><p>Create content, run campaigns and grow {me?.business_name || "your business"}.</p></div><div className={styles.actions}><Link className={styles.buttonPrimary} href="/studio/planner?compose=1"><Plus size={17} /> Create content</Link><Link className={styles.button} href="/studio/ads?create=1"><Megaphone size={16} /> Create campaign</Link><Link className={styles.button} href="/studio/partnerships"><Handshake size={16} /> Partner with a creator</Link></div></header>
    <StudioLoadError message={error} retry={() => { void load(); }} busy={loading} />
    {preview.error ? <StudioLoadError message={preview.error} retry={preview.retry} /> : null}
    <div className={styles.twoColumn}>
      <section className={styles.card}><div className={styles.cardBody}><span className={styles.status}><Newspaper size={12} /> Your publishing workspace</span><h2 className="mt-4 text-[24px] font-bold leading-tight tracking-tight">From the first draft<br />to the final approval.</h2><p className="mt-3 max-w-md text-[13px] leading-6 text-muted">Plan your next story, assign coverage and check content rights before your team schedules it.</p><div className={`${styles.actions} mt-5`}><Link href="/studio/newsroom" className={styles.buttonPrimary}>Open newsroom <ArrowRight size={15} /></Link><Link href="/studio/planner" className={styles.button}>View planner <CalendarClock size={15} /></Link></div></div></section>
      <section className={styles.card} aria-labelledby="studio-attention"><div className={styles.cardHeader}><h2 id="studio-attention">Needs your attention</h2><button className={styles.iconButton} onClick={() => void load()} disabled={loading} aria-label="Refresh overview"><RefreshCw size={16} /></button></div>{loading && !home ? <p className={styles.empty} role="status">Loading your workspace…</p> : home ? <div>{attention.map(item => <Link key={item.label} href={item.href} className="flex min-h-[58px] items-center gap-3 border-b border-ink/8 px-5 py-3 last:border-b-0 hover:bg-surface"><item.icon size={18} strokeWidth={1.7} className={item.n && item.label === "Publishing issues" ? "text-danger" : "text-accent"} /><span className="flex-1 text-[12.5px]">{item.label}</span><strong className="text-xl tabular-nums">{item.n.toLocaleString()}</strong><Chevron size={15} /></Link>)}</div> : <p className={styles.empty}>Refresh to load confirmed activity.</p>}</section>
    </div>
    <dl className={styles.metrics}>{[
      { label: "Post views", value: home?.now.views, prior: home?.prev.views, icon: BarChart3 },
      { label: "New followers", value: home?.now.followers, prior: home?.prev.followers, icon: Users },
      { label: "Ad impressions", value: home?.now.ad_impressions, prior: home?.prev.ad_impressions, icon: Megaphone },
      { label: "Published posts", value: home?.now.posts, prior: home?.prev.posts, icon: FileText },
    ].map(metric => <div className={styles.metric} key={metric.label}><dt><metric.icon size={17} />{metric.label}</dt><dd>{metric.value?.toLocaleString() ?? "—"}</dd><small>{metric.prior !== undefined ? `${metric.prior.toLocaleString()} in the prior week` : "Waiting for confirmed data"}</small></div>)}</dl>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>Publishing queue</h2><p>Most recently updated planned content · up to 100 records loaded.</p></div><Link href="/studio/content" className={styles.button}>View all content <ArrowRight size={14} /></Link></div><div className={`${styles.tabs} px-5`}>{[["all","All"],["draft","Drafts"],["scheduled","Scheduled"],["failed","Failed"],["published","Published"]].map(([key,label]) => <button key={key} className={styles.tab} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{home ? ` (${rows.filter(row => key === "all" || row.status === key).length})` : ""}</button>)}</div>{!home ? <p className={styles.empty}>{loading ? "Loading planned content…" : "The publishing queue is not available yet."}</p> : shown.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th scope="col">Content</th><th scope="col">Schedule</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{shown.map(row => { const cover = preview.preview.find(item => item.id === row.id)?.media?.[0]; return <tr key={row.id}><td><div className={styles.contentCell}>{cover?.media_type === "image" ? <img className={styles.thumb} src={cover.url} alt="" /> : <span className={styles.thumb}><FileText size={18} /></span>}<div><strong>{row.content || row.body || "Media post"}</strong><small>{row.media?.length || 0} media items</small></div></div></td><td>{row.publish_at ? new Date(row.publish_at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "No date set"}</td><td><span className={styles.status} data-state={row.status}>{row.status}</span>{row.error ? <small className="text-danger">{row.error}</small> : null}</td><td><Link className={styles.button} href={row.status === "published" && row.published_post_id ? `/post/${row.published_post_id}` : `/studio/planner?edit=${encodeURIComponent(row.id)}`}>{row.status === "published" ? "View post" : row.status === "failed" ? "Review issue" : "Open"}</Link></td></tr>; })}</tbody></table></div> : <div className={styles.empty}><CheckCircle2 size={28} /><h2>{filter === "all" ? "Your next story starts here" : `No ${filter} content`}</h2><p>Create a draft in Planner. Saved, scheduled and published work appears in this queue.</p><Link href="/studio/planner?compose=1" className={styles.buttonPrimary}><Plus size={16} /> Create content</Link></div>}</section>
    <section className={styles.sectionGap}><header className={`${styles.pageHeader} mb-3`}><div><h2 className="text-lg font-bold">Business services</h2><p>Manage revenue, talent and relationships.</p></div></header><div className={styles.serviceGrid}>{services.map(service => <Link className={styles.service} key={service.href} href={service.href}><service.icon size={23} strokeWidth={1.7} /><div><h3>{service.title}</h3><p>{service.line}</p></div></Link>)}</div></section>
  </div>;
}
function Chevron({size}: {size:number}) { return <ArrowRight size={size} className="text-muted" aria-hidden="true" />; }
