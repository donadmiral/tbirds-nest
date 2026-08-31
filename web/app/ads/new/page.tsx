"use client";

import { useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Eye, UserPlus, MousePointerClick, MessageCircle, ShoppingBag, Briefcase, Check, ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { priceLabel, type Listing } from "@/lib/market";
import { timeAgo } from "@/lib/feed";

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

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { router.push("/login"); return; }
      const [{ data: prof }, { data: p }, { data: l }, { data: j }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, avatar_url").eq("id", uid).maybeSingle(),
        supabase.from("posts").select("id, content, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(12),
        supabase.from("marketplace_listings").select("*").eq("seller_id", uid).eq("status", "available").order("created_at", { ascending: false }).limit(12),
        supabase.from("jobs").select("id, title, company, location").eq("posted_by", uid).order("created_at", { ascending: false }).limit(12),
      ]);
      setMe(prof ?? null);
      setPosts((p ?? []) as MyPost[]);
      setListings((l ?? []) as Listing[]);
      setJobs((j ?? []) as MyJob[]);
    })();
  }, [supabase, router]);

  async function publish() {
    if (pending || !goal || !pick) return;
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { router.push("/login"); return; }

    let postId: string | null = null;
    if (pick.kind === "post") postId = pick.post.id;
    else if (pick.kind === "new") {
      const { data: np, error: e1 } = await supabase.from("posts").insert({ user_id: uid, content: pick.text, audience: "everyone", is_exclusive: false, channel: null }).select("id").single();
      if (e1 || !np) { setError(e1?.message || "Could not create the ad post."); setPending(false); return; }
      postId = np.id;
    } else if (pick.kind === "listing") {
      const l = pick.listing;
      const { data: np, error: e1 } = await supabase.from("posts").insert({ user_id: uid, content: l.title, audience: "everyone", is_exclusive: false, channel: null }).select("id").single();
      if (e1 || !np) { setError(e1?.message || "Could not create the product ad."); setPending(false); return; }
      postId = np.id;
      await supabase.rpc("set_post_products", {
        p_post_id: np.id,
        p_products: [{ id: "listing-" + l.id, title: l.title, subtitle: null, price: Number(l.price), currency: l.currency, image_url: l.images?.[0] ?? null, listing_id: l.id, link_url: null, cta_label: "View listing", sort_order: 0 }],
      });
    } else if (pick.kind === "job") {
      const j = pick.job;
      const jobUrl = window.location.origin + "/jobs/" + j.id;
      const body = "We are hiring: " + j.title + (j.location ? " · " + j.location : "") + "\n\nApply on Platinum Circles: " + jobUrl;
      const { data: np, error: e1 } = await supabase.from("posts").insert({ user_id: uid, content: body, audience: "everyone", is_exclusive: false, channel: null }).select("id").single();
      if (e1 || !np) { setError(e1?.message || "Could not create the job ad."); setPending(false); return; }
      postId = np.id;
    }
    if (!postId) { setError("No content selected."); setPending(false); return; }

    const endsAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const totalCap = cap.trim() ? Number(cap.replace(/,/g, "")) || null : null;
    const { error: e2 } = await supabase.from("promoted_posts").insert({
      post_id: postId, advertiser_id: uid, label: "Sponsored", objective: goal, ends_at: endsAt, total_cap: totalCap,
    });
    setPending(false);
    if (e2) { setError(e2.message); return; }
    router.push("/ads");
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
        <Link href="/ads" className="rounded-full p-1.5 text-ink/50 transition-colors duration-[140ms] hover:bg-surface hover:text-ink" title="Back to Ads"><ArrowLeft size={18} /></Link>
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Megaphone size={19} className="text-pearl" /> New promotion</h1>
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
              <g.icon size={19} className={goal === g.key ? "text-pearl" : "text-ink/50"} />
              <span className="text-[14px] font-semibold text-ink">{g.label}</span>
              {goal === g.key ? <Check size={16} className="ml-auto text-pearl" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Choose a format</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["Image", "One photo with a caption", "/home?compose=photo", "photo"],
                ["Carousel", "Up to ten photos or products to swipe", "/home?compose=photo", "carousel"],
                ["Video", "A clip that plays in the feed", "/home?compose=photo", "video"],
                ["Article", "Long-form with a cover and title", "/write", "article"],
              ] as [string, string, string, string][]).map(([name, blurb, href, kind]) => (
                <Link key={kind} href={href + (href.includes("?") ? "&" : "?") + "then=promote"}
                  className="flex flex-col rounded-xl border border-ink/10 px-3.5 py-3 transition-colors duration-[140ms] hover:border-pearl/60 hover:bg-pearl/5">
                  <span className="text-[13.5px] font-semibold text-ink">{name}</span>
                  <span className="mt-0.5 text-[11.5px] leading-snug text-ink/50">{blurb}</span>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink/45">These open the composer. Publish the post, come back here, and it appears under existing posts to promote.</p>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Or write a text ad now</p>
            <textarea value={newText}
              onChange={(e) => { setNewText(e.target.value); if (e.target.value.trim()) setPick({ kind: "new", text: e.target.value }); }}
              onFocus={() => { if (newText.trim()) setPick({ kind: "new", text: newText }); }}
              placeholder="Write the ad text"
              rows={2}
              className={"w-full resize-none rounded-lg border p-4 text-[14px] text-ink placeholder:text-ink/30 outline-none transition-colors duration-[140ms] " + (pick?.kind === "new" ? "border-pearl bg-surface" : "border-ink/10")}
            />
          </div>
          {posts.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Or promote an existing post</p>
              <div className="flex flex-col gap-2">
                {posts.slice(0, 5).map((p) => (
                  <button key={p.id} onClick={() => setPick({ kind: "post", post: p })} className={card(pick?.kind === "post" && pick.post.id === p.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-[13px] text-ink/85">{p.content || "Media post"}</span>
                      <span className="block text-[11px] text-ink/40">{timeAgo(p.created_at)}</span>
                    </span>
                    {pick?.kind === "post" && pick.post.id === p.id ? <Check size={16} className="shrink-0 text-pearl" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {listings.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Or a Market product, the ad builds itself</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {listings.map((l) => {
                  const on = pick?.kind === "listing" && pick.listing.id === l.id;
                  return (
                    <button key={l.id} onClick={() => setPick({ kind: "listing", listing: l })} className={"relative w-28 shrink-0 overflow-hidden rounded-lg border text-left transition-colors duration-[140ms] " + (on ? "border-pearl" : "border-ink/10 hover:border-ink/25")}>
                      {on ? <span className="absolute right-1 top-1 z-10 rounded-full bg-pearl p-0.5 text-ink"><Check size={11} /></span> : null}
                      {l.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.images[0]} alt="" className="h-20 w-full bg-surface object-cover" />
                      ) : <span className="block h-20 w-full bg-surface" />}
                      <span className="block px-2 py-1.5">
                        <span className="block truncate text-[11px] font-semibold text-ink">{l.title}</span>
                        <span className="block text-[11px] text-pearl">{priceLabel(l)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {jobs.length > 0 ? (
            <div>
              <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Or a job, the ad builds itself</p>
              <div className="flex flex-col gap-2">
                {jobs.slice(0, 5).map((j) => (
                  <button key={j.id} onClick={() => setPick({ kind: "job", job: j })} className={card(pick?.kind === "job" && pick.job.id === j.id)}>
                    <Briefcase size={17} className="shrink-0 text-pearl" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{j.title}</span>
                      <span className="block truncate text-[11px] text-ink/40">{[j.company, j.location].filter(Boolean).join(" · ")}</span>
                    </span>
                    {pick?.kind === "job" && pick.job.id === j.id ? <Check size={16} className="shrink-0 text-pearl" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Audience</p>
            <div className={card(true)}>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">Automatic</span>
                <span className="block text-[12px] text-ink/50">Everyone eligible on Platinum Circles. Audience targeting arrives with Ads Manager.</span>
              </span>
              <Check size={16} className="text-pearl" />
            </div>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Run for</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DURATIONS.map((d) => (
                <button key={d.days} onClick={() => setDays(d.days)} className={card(days === d.days) + " justify-center"}>
                  <span className="text-[13px] font-semibold text-ink">{d.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Impression cap, optional</p>
            <input value={cap}
              onChange={(e) => setCap(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 5000, the promotion stops itself there"
              className="w-full rounded-lg border border-ink/10 bg-transparent p-4 text-[14px] text-ink placeholder:text-ink/30 outline-none transition-colors duration-[140ms] focus:border-pearl"
            />
            <p className="pt-2 text-[11px] leading-relaxed text-ink/35">No charge during the testing phase. At launch, campaigns bill to your IntoBank wallet through Crisp. IntoBank and Crisp are the only payment rails on Platinum Circles.</p>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="flex flex-col gap-4">
          <div className="relative rounded-lg border border-ink/10 p-4">
            <span className="absolute right-3 top-3 rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">Sponsored</span>
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
          <button onClick={() => setStep(step + 1)} disabled={!canNext} className="ml-auto flex items-center gap-1.5 rounded-full bg-pearl px-5 py-2.5 text-[14px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            Continue <ArrowRight size={14} />
          </button>
        ) : (
          <button onClick={publish} disabled={pending} className="ml-auto rounded-full bg-pearl px-6 py-2.5 text-[14px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            {pending ? "Publishing" : "Publish promotion"}
          </button>
        )}
      </div>
    </div>
  );
}