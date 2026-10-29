"use client";

import { useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Eye, UserPlus, MousePointerClick, MessageCircle, ShoppingBag, Briefcase, Check, ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { priceLabel, type Listing } from "@/lib/market";
import { RelativeTime } from "@/components/RelativeTime";

type Goal = { key: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
const GOALS: Goal[] = [
  { key: "views", label: "Get more views", icon: Eye },
  { key: "followers", label: "Get more followers", icon: UserPlus },
  { key: "website_visits", label: "Get website visits", icon: MousePointerClick },
  { key: "messages", label: "Get messages", icon: MessageCircle },
  { key: "market_sales", label: "Sell on the Market", icon: ShoppingBag },
  { key: "job_applications", label: "Get job applications", icon: Briefcase },
];

type MyPost = { id: string; content: string | null; created_at: string };
type MyJob = { id: string; title: string; company: string | null; location: string | null };
type ContentPick =
  | { kind: "post"; post: MyPost }
  | { kind: "listing"; listing: Listing }
  | { kind: "job"; job: MyJob }
  | { kind: "new"; text: string };

const DURATIONS = [
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 0, label: "Until I stop it" },
];

export default function AdWizardPage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState<string | null>(null);
  const [pick, setPick] = useState<ContentPick | null>(null);
  const [newText, setNewText] = useState("");
  const [days, setDays] = useState(7);
  const [cap, setCap] = useState("");
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<MyJob[]>([]);
  const [me, setMe] = useState<{ id: string; full_name: string | null; avatar_url: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishing = useRef(false);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const [hasMore, setHasMore] = useState({ posts: false, listings: false, jobs: false });
  const [pickerBusy, setPickerBusy] = useState(false); const pickerLock = useRef(false);
  const offsets = useRef({ posts: 0, listings: 0, jobs: 0 }); const loadVersion = useRef(0);

  useEffect(() => {
    const version = ++loadVersion.current;
    (async () => {
      try {
        const { data: sess, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const uid = sess.session?.user.id; if (!uid) { router.push('/login'); return; }
        const [profile, postResult, listingResult, jobResult] = await Promise.all([
          supabase.from('profiles').select('id, full_name, avatar_url').eq('id', uid).maybeSingle(),
          supabase.from('posts').select('id, content, created_at').eq('user_id', uid).eq('audience', 'everyone').eq('is_exclusive', false).order('created_at', { ascending: false }).order('id').range(0, 20),
          supabase.from('marketplace_listings').select('*').eq('seller_id', uid).eq('status', 'available').order('created_at', { ascending: false }).order('id').range(0, 20),
          supabase.from('jobs').select('id, title, company, location').eq('posted_by', uid).order('created_at', { ascending: false }).order('id').range(0, 20),
        ]);
        for (const result of [profile, postResult, listingResult, jobResult]) if (result.error) throw result.error;
        if (version !== loadVersion.current) return;
        const { data: current } = await supabase.auth.getSession(); if (current.session?.user.id !== uid) throw new Error('Your account changed. Refresh to continue.');
        setMe(profile.data); setPosts((postResult.data || []).slice(0,20)); setListings((listingResult.data || []).slice(0,20)); setJobs((jobResult.data || []).slice(0,20));
        offsets.current = { posts: Math.min(20, postResult.data?.length || 0), listings: Math.min(20, listingResult.data?.length || 0), jobs: Math.min(20, jobResult.data?.length || 0) };
        setHasMore({ posts: (postResult.data?.length || 0)>20, listings: (listingResult.data?.length || 0)>20, jobs: (jobResult.data?.length || 0)>20 });
        const wanted = new URLSearchParams(window.location.search).get('post');
        if (wanted && /^[0-9a-f-]{36}$/i.test(wanted)) {
          const result = await supabase.from('posts').select('id, content, created_at').eq('user_id', uid).eq('id', wanted).eq('audience', 'everyone').eq('is_exclusive', false).maybeSingle();
          if (result.error) throw result.error; if (version === loadVersion.current && result.data) setPick({ kind: 'post', post: result.data });
        }
      } catch (e: unknown) { if (version === loadVersion.current) setError(e instanceof Error ? e.message : 'Could not load content. Refresh and try again.'); }
    })();
    return () => { loadVersion.current++; };
  }, [supabase, router]);

  async function more(kind: 'posts' | 'listings' | 'jobs') {
    if (!me || pickerLock.current) return; pickerLock.current = true; setPickerBusy(true);
    const version = loadVersion.current;
    try {
      const { data: session } = await supabase.auth.getSession(); if (session.session?.user.id !== me.id) throw new Error('Your account changed. Refresh to continue.');
      let query = kind === 'posts' ? supabase.from('posts').select('id, content, created_at').eq('user_id', me.id).eq('audience', 'everyone').eq('is_exclusive', false)
        : kind === 'listings' ? supabase.from('marketplace_listings').select('*').eq('seller_id', me.id).eq('status', 'available')
        : supabase.from('jobs').select('id, title, company, location').eq('posted_by', me.id);
      const offset = offsets.current[kind]; const result = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + 20);
      if (result.error) throw result.error; if (version !== loadVersion.current) return;
      const { data: current } = await supabase.auth.getSession(); if (current.session?.user.id !== me.id) throw new Error('Your account changed. Refresh to continue.');
      const page = (result.data || []).slice(0,20); const merge = <T extends { id: string }>(old: T[], next: T[]) => [...old, ...next.filter(row => !old.some(x => x.id === row.id))];
      if (kind === 'posts') setPosts(old => merge(old, page as MyPost[])); else if (kind === 'listings') setListings(old => merge(old, page as Listing[])); else setJobs(old => merge(old, page as MyJob[]));
      offsets.current[kind] += page.length; setHasMore(old => ({ ...old, [kind]: (result.data?.length || 0)>20 }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not load more content. Try again.'); }
    finally { pickerLock.current = false; setPickerBusy(false); }
  }

  async function publish() {
    if (publishing.current || !goal || !pick || !me) return;
    publishing.current = true; setPending(true); setError(null);
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const uid = sess.session?.user.id; if (!uid || uid !== me.id) throw new Error('Your account changed. Refresh before publishing.');
      const totalCap = cap.trim() ? Number(cap.replace(/,/g, '')) : null;
      if (totalCap !== null && (!Number.isInteger(totalCap) || totalCap < 1 || totalCap > 2147483647)) throw new Error('Enter a positive whole-number impression limit.');
      const args = { p_expected_user: uid, p_kind: pick.kind, p_content_id: pick.kind === 'post' ? pick.post.id : pick.kind === 'listing' ? pick.listing.id : pick.kind === 'job' ? pick.job.id : null, p_text: pick.kind === 'new' ? newText.trim() : '', p_objective: goal, p_days: days, p_total_cap: totalCap };
      const payload = JSON.stringify(args); if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
      const { data, error: writeError } = await supabase.rpc('create_promotion', { ...args, p_request_key: request.current.key });
      if (writeError || !data) throw writeError || new Error('The promotion was not confirmed. Try again.');
      const { data: current } = await supabase.auth.getSession(); if (current.session?.user.id !== uid) return;
      router.push('/ads');
    } catch (e: unknown) { setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Could not publish. Try again.'); }
    finally { publishing.current = false; setPending(false); }
  }

  const canNext = step === 1 ? !!goal : step === 2 ? (pick !== null && (pick.kind !== "new" || newText.trim().length > 0)) : true;
  const stepTitle = ["", "What do you want people to do?", "What are you promoting?", "Who sees it, and for how long?", "Preview and publish"][step];
  const card = (on: boolean) => "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors duration-[140ms] " + (on ? "border-pearl bg-surface" : "border-ink/10 hover:bg-surface");

  const contentSummary = pick?.kind === "post" ? (pick.post.content ?? "").slice(0, 120)
    : pick?.kind === "listing" ? pick.listing.title + " · " + priceLabel(pick.listing)
    : pick?.kind === "job" ? pick.job.title
    : pick?.kind === "new" ? newText.slice(0, 120)
    : "";

  return (
    <div className="px-1">
      <div className="flex items-center gap-3 pb-1">
        <Link href="/ads" className="rounded-full p-1.5 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink" title="Back to Ads"><ArrowLeft size={18} /></Link>
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Megaphone size={19} className="text-accent" /> New promotion</h1>
      </div>
      <div className="flex gap-1.5 py-3">
        {[1, 2, 3, 4].map((s) => (
          <span key={s} className={"h-1 flex-1 rounded-full transition-colors duration-[140ms] " + (s <= step ? "bg-pearl" : "bg-ink/15")} />
        ))}
      </div>
      <h2 className="pb-4 text-[16px] font-semibold text-ink">{stepTitle}</h2>

      {step === 1 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GOALS.map((g) => (
            <button key={g.key} onClick={() => setGoal(g.key)} className={card(goal === g.key)}>
              <g.icon size={19} className={goal === g.key ? "text-accent" : "text-muted"} />
              <span className="text-[14px] font-semibold text-ink">{g.label}</span>
              {goal === g.key ? <Check size={16} className="ml-auto text-accent" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Choose a format</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["Image", "One photo with a caption", "/home?compose=photo", "photo"],
                ["Carousel", "Up to ten photos or products to swipe", "/home?compose=carousel", "carousel"],
                ["Video", "A clip that plays in the feed", "/home?compose=video", "video"],
                ["Article", "Long-form with a cover and title", "/write", "article"],
              ] as [string, string, string, string][]).map(([name, blurb, href, kind]) => (
                <Link key={kind} href={href + (href.includes("?") ? "&" : "?") + "then=promote"}
                  className="flex flex-col rounded-xl border border-ink/10 px-3.5 py-3 transition-colors duration-[140ms] hover:border-pearl/60 hover:bg-pearl/5">
                  <span className="text-[13.5px] font-semibold text-ink">{name}</span>
                  <span className="mt-0.5 text-[11.5px] leading-snug text-muted">{blurb}</span>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted">These open the composer. Publish the post, come back here, and it appears under existing posts to promote.</p>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Or write a text ad now</p>
            <textarea value={newText}
              onChange={(e) => { setNewText(e.target.value); if (e.target.value.trim()) setPick({ kind: "new", text: e.target.value }); }}
              onFocus={() => { if (newText.trim()) setPick({ kind: "new", text: newText }); }}
              placeholder="Write the ad text"
              rows={2}
              maxLength={10000}
              className={"w-full resize-none rounded-lg border p-4 text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] " + (pick?.kind === "new" ? "border-pearl bg-surface" : "border-ink/10")}
            />
          </div>
          {posts.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Or promote an existing post</p>
              <div className="flex flex-col gap-2">
                {posts.map((p) => (
                  <button key={p.id} onClick={() => setPick({ kind: "post", post: p })} className={card(pick?.kind === "post" && pick.post.id === p.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-[13px] text-ink/85">{p.content || "Media post"}</span>
                      <span className="block text-[11px] text-muted"><RelativeTime dateTime={p.created_at} /></span>
                    </span>
                    {pick?.kind === "post" && pick.post.id === p.id ? <Check size={16} className="shrink-0 text-accent" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {hasMore.posts && <button disabled={pickerBusy} onClick={() => void more('posts')} className="text-left text-sm underline">Load more posts</button>}
          {listings.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Or a Market product, the ad builds itself</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {listings.map((l) => {
                  const on = pick?.kind === "listing" && pick.listing.id === l.id;
                  return (
                    <button key={l.id} onClick={() => setPick({ kind: "listing", listing: l })} className={"relative w-28 shrink-0 overflow-hidden rounded-lg border text-left transition-colors duration-[140ms] " + (on ? "border-pearl" : "border-ink/10 hover:border-ink/25")}>
                      {on ? <span className="absolute right-1 top-1 z-10 rounded-full bg-pearl p-0.5 text-on-pearl"><Check size={11} /></span> : null}
                      {l.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.images[0]} alt="" className="h-20 w-full bg-surface object-cover" />
                      ) : <span className="block h-20 w-full bg-surface" />}
                      <span className="block px-2 py-1.5">
                        <span className="block truncate text-[11px] font-semibold text-ink">{l.title}</span>
                        <span className="block text-[11px] text-accent">{priceLabel(l)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {hasMore.listings && <button disabled={pickerBusy} onClick={() => void more('listings')} className="text-left text-sm underline">Load more products</button>}
          {jobs.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Or a job, the ad builds itself</p>
              <div className="flex flex-col gap-2">
                {jobs.map((j) => (
                  <button key={j.id} onClick={() => setPick({ kind: "job", job: j })} className={card(pick?.kind === "job" && pick.job.id === j.id)}>
                    <Briefcase size={17} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{j.title}</span>
                      <span className="block truncate text-[11px] text-muted">{[j.company, j.location].filter(Boolean).join(" · ")}</span>
                    </span>
                    {pick?.kind === "job" && pick.job.id === j.id ? <Check size={16} className="shrink-0 text-accent" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 && hasMore.jobs && <button disabled={pickerBusy} onClick={() => void more('jobs')} className="my-3 text-left text-sm underline">Load more jobs</button>}
      {step === 3 ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Audience</p>
            <div className={card(true)}>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">Automatic</span>
                <span className="block text-[12px] text-muted">Everyone eligible on Platinum Circles. Audience targeting arrives with Ads Manager.</span>
              </span>
              <Check size={16} className="text-accent" />
            </div>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Run for</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DURATIONS.map((d) => (
                <button key={d.days} onClick={() => setDays(d.days)} className={card(days === d.days) + " justify-center"}>
                  <span className="text-[13px] font-semibold text-ink">{d.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Impression cap, optional</p>
            <input value={cap}
              onChange={(e) => setCap(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 5000, the promotion stops itself there"
              className="w-full rounded-lg border border-ink/10 bg-transparent p-4 text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:border-pearl"
            />
            <p className="pt-2 text-[11px] leading-relaxed text-muted">No charge during the testing phase. At launch, campaigns bill to your IntoBank wallet through Crisp. IntoBank and Crisp are the only payment rails on Platinum Circles.</p>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-4">
          <div className="relative rounded-lg border border-ink/10 p-4">
            <span className="absolute right-3 top-3 rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">Sponsored</span>
            <div className="flex gap-3">
              {me?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(me.avatar_url, 200) ?? me.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">{(me?.full_name ?? "?").charAt(0)}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{me?.full_name}</p>
                <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink/85">{contentSummary}</p>
                {pick?.kind === "listing" && pick.listing.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pick.listing.images[0]} alt="" className="mt-2 h-36 w-36 rounded-lg object-cover" />
                ) : null}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-ink/10 p-4 text-[13px] text-ink/70">
            <p>Goal: <span className="font-semibold text-ink">{GOALS.find((g) => g.key === goal)?.label}</span></p>
            <p className="mt-1">Audience: <span className="font-semibold text-ink">Automatic</span></p>
            <p className="mt-1">Duration: <span className="font-semibold text-ink">{days > 0 ? days + " days" : "Until stopped"}</span>{cap.trim() ? " · cap " + cap : ""}</p>
          </div>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-6">
        {step > 1 ? (
          <button onClick={() => setStep(step - 1)} className="flex items-center gap-1.5 rounded-full bg-surface px-4 py-2.5 text-[13px] text-ink transition-colors duration-[140ms] hover:bg-surface-elevated"><ArrowLeft size={14} /> Back</button>
        ) : null}
        {step < 4 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canNext} className="ml-auto flex items-center gap-1.5 rounded-full bg-pearl px-5 py-2.5 text-[14px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            Continue <ArrowRight size={14} />
          </button>
        ) : (
          <button onClick={publish} disabled={pending} className="ml-auto rounded-full bg-pearl px-6 py-2.5 text-[14px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            {pending ? "Publishing" : "Publish promotion"}
          </button>
        )}
      </div>
    </div>
  );
}