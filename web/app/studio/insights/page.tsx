"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, Download, FileText, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUploadPreview } from "@/lib/useUploadPreview";
import { downloadStudioCsv } from "@/lib/studioPresentation";
import { StudioReportChart } from "@/components/StudioReportChart";
import { StudioLoadError } from "../LoadError";
import styles from "@/components/StudioWorkspace.module.css";

type MetricKey = "impressions" | "reach" | "engagements" | "followers" | "messages" | "posts" | "market_chats" | "offers" | "payments" | "applications" | "ad_impressions" | "ad_clicks";
type Day = { day: string } & Record<MetricKey, number> & { paid_usd: number; paid_zwg: number };
type TopPost = { post_id: string; content: string; created_at: string; likes: number; comments: number; reposts: number; views: number; score: number; thumb: string | null; products: number };
type Insights = { days: number; series: Day[]; current: Record<string, number>; previous: Record<string, number>; top_posts: TopPost[]; funnel: { commerce: { chats: number; offers: number; payments: number }; recruiting: { applications: number; interviews: number; hired: number } } };
type View = "organic" | "paid" | "business";
const EMPTY_POSTS: TopPost[] = [];
const metrics: Record<View, { key: MetricKey; label: string; hint: string }[]> = {
  organic: [{ key: "impressions", label: "Content impressions", hint: "Recorded content views" }, { key: "reach", label: "Daily reach total", hint: "Daily unique viewers, summed" }, { key: "engagements", label: "Engagements", hint: "Likes, comments, reposts and saves" }, { key: "followers", label: "Follower count", hint: "Latest reported total" }],
  paid: [{ key: "ad_impressions", label: "Ad impressions", hint: "Recorded campaign delivery" }, { key: "ad_clicks", label: "Ad clicks", hint: "Recorded taps on campaign creative" }],
  business: [{ key: "messages", label: "Messages", hint: "Received messages" }, { key: "market_chats", label: "Market conversations", hint: "Buyer conversations started" }, { key: "payments", label: "Chat payments", hint: "Recorded completed chat payments" }, { key: "applications", label: "Applications", hint: "Applications received for your jobs" }],
};
const comparison = (value: number, previous: number, days: number) => value === previous ? `Unchanged from the previous ${days} days` : `${value > previous ? "Up" : "Down"} from ${previous.toLocaleString()} in the previous ${days} days`;

export default function InsightsPage() {
  const [client] = useState(createClient);
  const [days, setDays] = useState(30), [view, setView] = useState<View>("organic"), [metric, setMetric] = useState<MetricKey>("impressions");
  const [report, setReport] = useState<Insights | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const generation = useRef(0), mounted = useRef(false);
  const media = useUploadPreview(report?.top_posts ?? EMPTY_POSTS);
  const load = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([client.rpc("studio_insights", { p_days: days }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Report timed out")), 20000); })]);
      if (result.error) throw result.error;
      const next = result.data as Insights;
      if (!next || next.days !== days || !Array.isArray(next.series) || !Array.isArray(next.top_posts) || !next.current || !next.previous || !next.funnel?.commerce || !next.funnel?.recruiting) throw new Error("Unverified report");
      if (!mounted.current || run !== generation.current) return;
      setReport(next); setError(null);
    } catch {
      if (mounted.current && run === generation.current) setError(`The ${days}-day report could not be refreshed. Try again to load the selected period.`);
    } finally { if (timer) clearTimeout(timer); if (mounted.current && run === generation.current) setLoading(false); }
  }, [client, days]);
  useEffect(() => { let active=true; mounted.current = true; void Promise.resolve().then(()=>{if(active)void load();}); return () => { active=false; mounted.current = false; generation.current++; }; }, [load]);
  const switchView = (next: View) => { setView(next); setMetric(metrics[next][0].key); };
  const shownMetrics = metrics[view];
  const activeMetric = shownMetrics.find(item => item.key === metric) ?? shownMetrics[0];
  const hasDays = !!report?.series.length;
  const latest = report?.series[report.series.length - 1]?.day;
  const valueFor = (key: MetricKey) => report ? Number(key === "followers" ? report.current.followers_end ?? 0 : report.current[key] ?? 0) : 0;
  const exportReport = () => {
    if (!report) return;
    downloadStudioCsv(`platinum-${view}-daily-${report.days}days.csv`, ["Reported day", ...shownMetrics.map(item => item.label)], report.series.map(day => [day.day, ...shownMetrics.map(item => day[item.key])]));
  };
  return <div>
    <header className={styles.pageHeader}><div><h1>Insights</h1><p>Understand content, campaign delivery and business activity from recorded reports.</p></div><div className={styles.actions}><label className="text-xs text-muted">Reporting period<select aria-label="Reporting period" value={days} onChange={event => setDays(Number(event.target.value))} className="ml-2 rounded-lg border border-ink/15 bg-transparent px-3 py-2 text-ink">{[7, 30, 90].map(value => <option key={value} value={value}>Last {value} days</option>)}</select></label><button className={styles.button} disabled={loading} onClick={() => void load()}><RefreshCw size={15}/>Refresh</button><button className={styles.button} disabled={!hasDays} onClick={exportReport}><Download size={15}/>Export daily report</button></div></header>
    <div className={styles.tabs}>{[["organic", "Organic content"], ["paid", "Paid campaigns"], ["business", "Business activity"]].map(([key, label]) => <button key={key} className={styles.tab} aria-pressed={view === key} onClick={() => switchView(key as View)}>{label}</button>)}<Link href="/studio/partnerships" className={styles.tab}>Creator partnerships <ArrowRight size={12} className="ml-1 inline"/></Link></div>
    <StudioLoadError message={error} retry={() => { void load(); }} busy={loading}/>
    {report && report.days !== days ? <p role="status" className={styles.notice}>Showing the last confirmed {report.days}-day report while the selected {days}-day report is unavailable.</p> : null}
    {loading && !report ? <p className={styles.empty} role="status">Loading your report…</p> : report ? <>
      <p className="mt-4 text-xs leading-6 text-muted">Daily activity is summarized overnight in Africa/Harare time. {latest ? `Latest reported day: ${latest}.` : "No daily reports are available for this period yet."} Today’s activity is not included in the daily totals.</p>
      <dl className={styles.metrics}>{shownMetrics.map(item => <div className={styles.metric} key={item.key}><dt>{item.label}</dt><dd>{hasDays ? valueFor(item.key).toLocaleString() : "—"}</dd><small>{item.hint}</small>{hasDays && item.key !== "followers" ? <small>{comparison(valueFor(item.key), Number(report.previous[item.key] ?? 0), report.days)}</small> : null}</div>)}</dl>
      {view === "organic" ? <p className={styles.notice}>Daily reach is unique within each day. Its total can include the same person on different days. Follower count is the latest reported total.</p> : view === "paid" ? <p className={styles.notice}>Campaign delivery reports impressions and clicks. These counts do not establish purchases, revenue or return on ad spending. <Link className="underline" href="/studio/ads">Open Ads Manager</Link></p> : null}
      <section className={styles.card}><div className={styles.cardHeader}><div><h2>Performance over time</h2><p>{hasDays ? `${report.series.length} reported days in the ${report.days}-day period` : "Your first daily report will appear here"}</p></div><label className="text-xs text-muted">Metric<select aria-label="Chart metric" className="ml-2 rounded-lg border border-ink/15 bg-transparent px-2 py-2 text-ink" value={activeMetric.key} onChange={event => setMetric(event.target.value as MetricKey)}>{shownMetrics.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label></div><div className={styles.cardBody}><StudioReportChart label={activeMetric.label} points={report.series.map(day => ({ day: day.day, value: Number(day[activeMetric.key] ?? 0) }))}/></div></section>
      {view === "organic" ? <section className={`${styles.card} ${styles.sectionGap}`}><div className={styles.cardHeader}><div><h2>Top content</h2><p>Up to eight posts created in the selected period, ranked by recorded engagement.</p></div><Link className={styles.button} href="/studio/content">Content library <ArrowRight size={14}/></Link></div><StudioLoadError message={media.error} retry={media.retry}/>{report.top_posts.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th scope="col">Content</th><th scope="col">Views</th><th scope="col">Likes</th><th scope="col">Comments</th><th scope="col">Reposts</th><th scope="col">Action</th></tr></thead><tbody>{report.top_posts.map(post => { const thumb = media.preview.find(item => item.post_id === post.post_id)?.thumb; return <tr key={post.post_id}><td><div className={styles.contentCell}>{thumb ? <img className={styles.thumb} src={thumb} alt=""/> : <span className={styles.thumb}><FileText size={17}/></span>}<div><strong>{post.content || "Media post"}</strong><small>{new Date(post.created_at).toLocaleDateString()}</small></div></div></td><td>{post.views.toLocaleString()}</td><td>{post.likes.toLocaleString()}</td><td>{post.comments.toLocaleString()}</td><td>{post.reposts.toLocaleString()}</td><td><Link className={styles.button} href={`/post/${post.post_id}`}>View post</Link></td></tr>; })}</tbody></table></div> : <div className={styles.empty}><BarChart3 size={26}/><h2>No posts in this period</h2><p>Choose another reporting period or create content in Planner.</p><Link href="/studio/planner?compose=1" className={styles.button}>Create content <ArrowRight size={14}/></Link></div>}</section> : null}
      {view === "business" ? <div className={`${styles.twoColumn} ${styles.sectionGap}`}><section className={styles.card}><div className={styles.cardHeader}><h2>Commerce activity</h2><Link className={styles.button} href="/studio/commerce">Open commerce</Link></div><dl className={`${styles.definition} ${styles.cardBody}`}><div><dt>Conversations</dt><dd>{report.funnel.commerce.chats.toLocaleString()}</dd></div><div><dt>Offers</dt><dd>{report.funnel.commerce.offers.toLocaleString()}</dd></div><div><dt>Chat payments</dt><dd>{report.funnel.commerce.payments.toLocaleString()}</dd></div></dl><p className="px-5 pb-5 text-xs leading-6 text-muted">These are recorded activity counts, not a linked sales attribution funnel.</p></section><section className={styles.card}><div className={styles.cardHeader}><h2>Recruiting progress</h2><Link className={styles.button} href="/studio/recruiter">Open recruiter</Link></div><dl className={`${styles.definition} ${styles.cardBody}`}><div><dt>Applications</dt><dd>{report.funnel.recruiting.applications.toLocaleString()}</dd></div><div><dt>Reached interview</dt><dd>{report.funnel.recruiting.interviews.toLocaleString()}</dd></div><div><dt>Hired</dt><dd>{report.funnel.recruiting.hired.toLocaleString()}</dd></div></dl></section></div> : null}
    </> : null}
  </div>;
}
