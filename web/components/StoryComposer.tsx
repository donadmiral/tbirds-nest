"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ImagePlus, Plus, Trash2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss } from "@/lib/stories";
import { searchPeople, type AccessPerson } from "@/lib/memoryAlbum";

type Draft = {
  id: string; media_url: string | null; media_type: string; caption: string | null;
  audience: string; shared_with: string[]; duration_sec: number | null; created_at: string;
};

const AUD = [
  { key: "everyone", label: "Everyone" },
  { key: "followers", label: "Followers" },
  { key: "close_friends", label: "Close friends" },
  { key: "only_with", label: "Only these people" },
];

function ComposerInner() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const params = useSearchParams();
  const [uid, setUid] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [filterId, setFilterId] = useState<string | null>(null);
  const [audience, setAudience] = useState("everyone");
  const [people, setPeople] = useState<AccessPerson[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AccessPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user.id ?? null;
      setUid(u);
      if (!u) router.push("/login");
    });
  }, [supabase, router]);

  const loadDrafts = async (u: string) => {
    const { data } = await supabase.from("story_drafts").select("*")
      .eq("user_id", u).order("created_at", { ascending: false }).limit(12);
    setDrafts((data ?? []) as Draft[]);
  };
  useEffect(() => { if (uid) loadDrafts(uid); }, [uid]);

  useEffect(() => {
    const d = params.get("draft");
    if (d && drafts.length) {
      const row = drafts.find((x) => x.id === d);
      if (row) applyDraft(row);
    }
  }, [params, drafts.length]);

  useEffect(() => {
    const t = setTimeout(() => { searchPeople(q).then(setResults); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function applyDraft(d: Draft) {
    setDraftId(d.id);
    setMediaUrl(d.media_url);
    setMediaType(d.media_type === "video" ? "video" : "image");
    setDurationSec(d.duration_sec);
    setCaption(d.caption ?? "");
    setAudience(d.audience);
    if (d.shared_with.length) {
      supabase.from("profiles").select("id, full_name, username, avatar_url")
        .in("id", d.shared_with).then(({ data }) => setPeople((data ?? []) as AccessPerson[]));
    } else setPeople([]);
  }

  async function pickFile(f: File) {
    if (!uid) return;
    setBusy("upload");
    setError(null);
    const isVideo = f.type.startsWith("video");
    const ext = (f.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
    const path = uid + "/" + Date.now() + "." + ext;
    const { error: upErr } = await supabase.storage.from("story-media")
      .upload(path, f, { contentType: f.type, upsert: false });
    if (upErr) { setError(upErr.message); setBusy(null); return; }
    const { data: pub } = supabase.storage.from("story-media").getPublicUrl(path);
    setMediaUrl(pub.publicUrl);
    setMediaType(isVideo ? "video" : "image");
    if (isVideo) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => setDurationSec(Math.min(60, Math.max(1, Math.round(v.duration || 10))));
      v.src = URL.createObjectURL(f);
    } else setDurationSec(null);
    setBusy(null);
  }

  async function publish() {
    if (!uid || !mediaUrl || busy) return;
    setBusy("publish");
    setError(null);
    const { data: row, error: insErr } = await supabase.from("stories").insert({
      user_id: uid, media_url: mediaUrl, media_type: mediaType,
      caption: caption.trim() || null, audience, filter_id: filterId,
      duration_sec: mediaType === "video" ? durationSec ?? 10 : null,
    }).select("id").single();
    if (insErr || !row) { setError(insErr?.message || "Could not post the story."); setBusy(null); return; }
    if (audience === "only_with" && people.length) {
      await supabase.from("story_shared_with").insert(people.map((p) => ({ story_id: row.id, user_id: p.id })));
    }
    if (draftId) await supabase.from("story_drafts").delete().eq("id", draftId);
    router.push("/home");
  }

  async function saveDraft() {
    if (!uid || !mediaUrl || busy) return;
    setBusy("draft");
    const payload = {
      user_id: uid, media_url: mediaUrl, media_type: mediaType,
      caption: caption.trim() || null, audience,
      shared_with: people.map((p) => p.id), duration_sec: durationSec,
    };
    const r = draftId
      ? await supabase.from("story_drafts").update(payload).eq("id", draftId)
      : await supabase.from("story_drafts").insert(payload);
    setBusy(null);
    if (!r.error) { setDraftId(null); setMediaUrl(null); setCaption(""); setPeople([]); setAudience("everyone"); if (uid) loadDrafts(uid); }
    else setError(r.error.message);
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-16">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-ink/10 bg-white/75 px-4 py-2.5 backdrop-blur-md">
        <Link href="/home" className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></Link>
        <p className="flex-1 font-display text-[17px] text-ink">New story</p>
        <Link href="/archive" className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink/70">Archive</Link>
      </div>

      {drafts.length > 0 && !mediaUrl ? (
        <div className="mb-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Drafts</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {drafts.map((d) => (
              <div key={d.id} className="relative w-20 shrink-0">
                <button onClick={() => applyDraft(d)} className="block aspect-[9/14] w-full overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                  {d.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    d.media_type === "video" ? <video src={d.media_url} muted className="h-full w-full object-cover" /> : <img src={d.media_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
                <button onClick={async () => { await supabase.from("story_drafts").delete().eq("id", d.id); if (uid) loadDrafts(uid); }}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-1 text-ink/50 shadow" aria-label="Delete draft"><X size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!mediaUrl ? (
        <button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}
          className="flex aspect-[9/14] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 text-ink/45 hover:border-ink/30">
          <ImagePlus size={26} />
          <span className="text-[13px] font-semibold">{busy === "upload" ? "Uploading" : "Add a photo or video"}</span>
        </button>
      ) : (
        <>
        <div className="relative aspect-[9/14] w-full overflow-hidden rounded-2xl bg-ink">
          {mediaType === "video" ? (
            <video src={mediaUrl} controls playsInline className="h-full w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="h-full w-full object-contain" />
          )}
          {/* The chosen look, drawn exactly as the viewer draws it. */}
          {filterId ? (() => { const f = STORY_FILTERS.find((x) => x.id === filterId); return f ? (
            <div className="pointer-events-none absolute inset-0" style={{ backdropFilter: filterCss(filterId), WebkitBackdropFilter: filterCss(filterId) }}>
              {f.layers.map((l, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
            </div>) : null; })() : null}
          <button onClick={() => { setMediaUrl(null); setDraftId(null); }} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white" aria-label="Remove media"><X size={14} /></button>
        </div>
        {mediaType === "image" ? (
          <div className="mt-3">
            {STORY_FILTER_FAMILIES.map((fam) => (
              <div key={fam.key} className="mb-2">
                <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink/40">{fam.label}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(fam.key === "classic" ? [{ id: null as string | null, label: "None", layers: [] as { color: string; opacity: number }[], css: undefined as string | undefined }, ...STORY_FILTERS.filter((f) => f.family === fam.key)] : STORY_FILTERS.filter((f) => f.family === fam.key)).map((f) => {
                    const on = filterId === f.id;
                    return (
                      <button key={f.id ?? "none"} type="button" onClick={() => setFilterId(f.id)} className="flex w-[64px] shrink-0 flex-col items-center gap-1">
                        <span className={"relative block h-[64px] w-[64px] overflow-hidden rounded-xl border-2 " + (on ? "border-pearl" : "border-transparent")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mediaUrl} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(f.id) }} />
                          {f.layers.map((l, i) => <span key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
                        </span>
                        <span className={"text-[11px] " + (on ? "font-semibold text-ink" : "text-ink/50")}>{f.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />

      <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={120} placeholder="Write a caption"
        className="mt-4 w-full rounded-lg border border-ink/15 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40" />

      <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Audience</p>
      <div className="grid grid-cols-2 gap-1.5">
        {AUD.map((a) => (
          <button key={a.key} onClick={() => setAudience(a.key)}
            className={"flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] " + (audience === a.key ? "border-ink bg-black/[0.03] font-semibold text-ink" : "border-ink/10 text-ink/70")}>
            {a.label}{audience === a.key ? <Check size={14} /> : null}
          </button>
        ))}
      </div>

      {audience === "only_with" ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40"><Users size={13} /> Share with</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
            className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
          {results.map((r) => (
            <button key={r.id} onClick={() => { if (!people.some((p) => p.id === r.id)) setPeople([...people, r]); setQ(""); setResults([]); }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5">
              <span className="text-[13px] text-ink">{r.full_name} <VerifiedBadge userId={r.id} size={12} /> <span className="text-ink/40">@{r.username}</span></span>
              <Plus size={13} className="ml-auto text-ink/40" />
            </button>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[12px] text-ink">
                {p.full_name}
                <VerifiedBadge userId={p.id} size={11} />
                <button onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label="Remove"><X size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-red-700">{error}</p> : null}
      <div className="mt-5 flex gap-2">
        <button onClick={saveDraft} disabled={!mediaUrl || !!busy}
          className="flex-1 rounded-md border border-ink/15 py-2.5 text-sm font-semibold text-ink/70 disabled:opacity-40">
          {busy === "draft" ? "Saving" : draftId ? "Update draft" : "Save as draft"}
        </button>
        <button onClick={publish} disabled={!mediaUrl || audience === "only_with" && people.length === 0 || !!busy}
          className="flex-1 rounded-md bg-pearl py-2.5 text-sm font-semibold text-ink disabled:opacity-40">
          {busy === "publish" ? "Posting" : "Share to story"}
        </button>
      </div>
    </div>
  );
}

export function StoryComposer() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-sm text-ink/40">Opening</p>}>
      <ComposerInner />
    </Suspense>
  );
}