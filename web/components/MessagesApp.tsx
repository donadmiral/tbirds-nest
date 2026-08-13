"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Send, FileText, Tag, Wallet, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, type Conv, type Msg } from "@/lib/messages";
import { signChatMedia, isChatMediaUrl } from "@/lib/chatMedia";
import { StoryAvatar } from "@/components/StoryAvatar";
import { timeAgo } from "@/lib/feed";

type OfferLive = { id: string; status: string; proposer_id: string; amount: number; currency: string };
type MiniListing = { id: string; title: string; price: number; currency: string; images: string[]; status: string };

export function MessagesApp({ context = "personal", heading = "Messages", compact = false }: { context?: string; heading?: string; compact?: boolean }) {
  const supabase = useRef(createClient()).current;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [active, setActive] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offers, setOffers] = useState<Record<string, OfferLive>>({});
  const [refListing, setRefListing] = useState<MiniListing | null>(null);
  const [countering, setCountering] = useState<string | null>(null);
  const [counterAmt, setCounterAmt] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<Conv | null>(null);
  const typingSentAt = useRef(0);
  activeRef.current = active;

  const hydrateOffers = useCallback(async (rows: Msg[]) => {
    const ids: string[] = [];
    rows.forEach((m) => {
      if (m.media_type === "offer" && m.media_url) {
        try { const j = JSON.parse(m.media_url); if (j?.offer_id) ids.push(j.offer_id); } catch { /* not json */ }
      }
    });
    if (ids.length === 0) return;
    const { data } = await supabase.from("listing_offers").select("id, status, proposer_id, amount, currency").in("id", ids);
    setOffers((prev) => {
      const next = { ...prev };
      ((data ?? []) as OfferLive[]).forEach((o) => { next[o.id] = o; });
      return next;
    });
  }, [supabase]);

  const openConv = useCallback(async (c: Conv) => {
    setActive(c);
    setLoadingMsgs(true);
    setMsgs([]);
    setRefListing(null);
    setOtherTyping(false);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true })
      .limit(200);
    const rows = await signChatMedia(((data ?? []) as Msg[]));
    setMsgs(rows);
    setLoadingMsgs(false);
    hydrateOffers(rows);
    if (c.context === "market" && c.context_ref_id) {
      const { data: lst } = await supabase
        .from("marketplace_listings")
        .select("id, title, price, currency, images, status")
        .eq("id", c.context_ref_id)
        .maybeSingle();
      if (lst) setRefListing(lst as MiniListing);
    }
    supabase.rpc("mark_conversation_read_v2", { p_conversation_id: c.id }).then(() => {
      setConvs((l) => l.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
    }, () => {});
    setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 60);
  }, [supabase, hydrateOffers]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user.id ?? null;
      setUid(id);
      if (!id) { setLoadingConvs(false); return; }
      const list = await loadConversations(id, context);
      setConvs(list);
      setLoadingConvs(false);
      const target = new URLSearchParams(window.location.search).get("c");
      const t = target ? list.find((x) => x.id === target) : null;
      if (t) openConv(t);
    })();
  }, [supabase, context, openConv]);

  useEffect(() => {
    if (!active || !uid) return;
    const ch = supabase
      .channel("web_messages_" + active.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, async (p) => {
        let incoming = p.new as Msg;
        if (activeRef.current?.id !== incoming.conversation_id) return;
        if (isChatMediaUrl(incoming.media_url)) incoming = (await signChatMedia([incoming]))[0];
        setMsgs((l) => (l.some((m) => m.id === incoming.id) ? l.map((m) => (m.id === incoming.id ? incoming : m)) : [...l, incoming]));
        hydrateOffers([incoming]);
        if (incoming.sender_id !== uid) {
          supabase.rpc("mark_conversation_read_v2", { p_conversation_id: incoming.conversation_id }).then(() => {}, () => {});
        }
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 40);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: "conversation_id=eq." + active.id }, async (p) => {
        let upd = p.new as Msg;
        if (isChatMediaUrl(upd.media_url)) upd = (await signChatMedia([upd]))[0];
        setMsgs((l) => l.map((m) => (m.id === upd.id ? { ...m, ...upd, media_url: upd.media_url ?? m.media_url } : m)));
      })
      .subscribe();

    const fetchTyping = async () => {
      const { data } = await supabase.from("conversation_typing").select("*").eq("conversation_id", active.id);
      const fresh = ((data ?? []) as { user_id: string; is_typing: boolean; updated_at: string }[])
        .filter((r) => r.user_id !== uid && r.is_typing && Date.now() - new Date(r.updated_at).getTime() < 7000);
      setOtherTyping(fresh.length > 0);
    };
    const typeCh = supabase
      .channel("web_typing_" + active.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_typing", filter: "conversation_id=eq." + active.id }, fetchTyping)
      .subscribe();
    const typePoll = setInterval(fetchTyping, 3000);

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(typeCh);
      clearInterval(typePoll);
    };
  }, [supabase, active, uid, hydrateOffers]);

  const setTyping = useCallback(async (isTyping: boolean) => {
    if (!active || !uid) return;
    try {
      await supabase.from("conversation_typing").upsert(
        { conversation_id: active.id, user_id: uid, is_typing: isTyping, updated_at: new Date().toISOString() },
        { onConflict: "conversation_id,user_id" }
      );
    } catch { /* non-fatal */ }
  }, [supabase, active, uid]);

  function onDraftChange(v: string) {
    setDraft(v);
    const now = Date.now();
    if (now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      setTyping(true);
    }
  }

  async function insertMessage(text: string | null, mediaUrl: string | null, mediaType: string | null) {
    if (!active || !uid) return false;
    const temp: Msg = {
      id: "temp-" + Date.now(), conversation_id: active.id, sender_id: uid,
      receiver_id: active.other_id, text, media_url: mediaUrl, media_type: mediaType,
      reply_to_id: null, created_at: new Date().toISOString(),
    };
    setMsgs((l) => [...l, temp]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);
    const { data, error } = await supabase.from("messages").insert([{
      conversation_id: active.id, text, sender_id: uid,
      receiver_id: active.other_id, media_url: mediaUrl, media_type: mediaType, reply_to_id: null,
    }]).select().single();
    if (error) {
      setMsgs((l) => l.filter((m) => m.id !== temp.id));
      return false;
    }
    let saved = data as Msg;
    if (isChatMediaUrl(saved.media_url)) saved = { ...saved, media_url: mediaUrl };
    setMsgs((l) => l.map((m) => (m.id === temp.id ? saved : m)));
    setConvs((l) => l.map((c) => (c.id === active.id ? { ...c, last_message: text || "Attachment", last_message_time: data.created_at } : c)));
    return true;
  }

  async function send() {
    const text = draft.trim();
    if (!text || !active || !uid) return;
    setDraft("");
    setTyping(false);
    const ok = await insertMessage(text, null, null);
    if (!ok) setDraft(text);
  }

  async function attach(list: FileList | null) {
    if (!list || !active || !uid || sendingFile) return;
    const f = list[0];
    if (!f) return;
    setSendingFile(true);
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    const bucket = isImage || isVideo ? "chat-media" : "chat-files";
    const safeName = f.name.replace(/[^a-zA-Z0-9/_.\-]/g, "_");
    const path = uid + "/" + Date.now() + "_" + safeName;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (upErr) { alert("Upload failed: " + upErr.message); setSendingFile(false); return; }
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    if (isImage) await insertMessage(null, pub.publicUrl, "image");
    else if (isVideo) await insertMessage(null, pub.publicUrl, "video");
    else await insertMessage("📄 " + f.name, pub.publicUrl, "document");
    setSendingFile(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function respondOffer(offerId: string, action: string, counterAmount?: number) {
    const { error } = await supabase.rpc("respond_offer", { p_offer_id: offerId, p_action: action, p_counter_amount: counterAmount ?? null });
    if (error) { alert("Could not respond: " + error.message); return; }
    setOffers((prev) => ({ ...prev, [offerId]: { ...(prev[offerId] || ({} as OfferLive)), status: action } }));
    setCountering(null);
    setCounterAmt("");
  }

  const shownConvs = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return convs;
    return convs.filter((c) => (c.title + " " + (c.username ?? "")).toLowerCase().includes(t));
  }, [convs, query]);

  function OfferCard({ m }: { m: Msg }) {
    let j: { offer_id?: string; amount?: number; currency?: string; status?: string } = {};
    try { j = JSON.parse(m.media_url || "{}"); } catch { return null; }
    if (!j.offer_id) return null;
    const live = offers[j.offer_id];
    const status = live?.status || j.status || "pending";
    const amount = live?.amount ?? j.amount ?? 0;
    const currency = live?.currency ?? j.currency ?? "";
    const proposer = live?.proposer_id ?? m.sender_id;
    const canRespond = status === "pending" && uid !== null && uid !== proposer;
    const color = status === "accepted" ? "text-success" : status === "pending" ? "text-pearl" : "text-white/40";
    return (
      <div className="min-w-48 rounded-lg border border-white/15 p-3">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40"><Tag size={12} /> Offer</p>
        <p className="mt-0.5 text-[18px] font-semibold text-white">{(currency === "USD" ? "$" : currency + " ") + Number(amount).toLocaleString()}</p>
        <p className={"text-[12px] font-semibold capitalize " + color}>{status}</p>
        {canRespond ? (
          countering === j.offer_id ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <input value={counterAmt} onChange={(e) => setCounterAmt(e.target.value)} inputMode="numeric" placeholder="Counter amount" className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/30 outline-none" />
              <div className="flex gap-1.5">
                <button onClick={() => { const n = Number(counterAmt.replace(/,/g, "")); if (n > 0) respondOffer(j.offer_id!, "countered", n); }} className="rounded-md bg-pearl px-2.5 py-1.5 text-[12px] font-semibold text-ink">Send counter</button>
                <button onClick={() => setCountering(null)} className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[12px] text-white">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => respondOffer(j.offer_id!, "accepted")} className="rounded-md bg-success/20 px-2.5 py-1.5 text-[12px] font-semibold text-success">Accept</button>
              <button onClick={() => setCountering(j.offer_id!)} className="rounded-md bg-surface-elevated px-2.5 py-1.5 text-[12px] text-white">Counter</button>
              <button onClick={() => respondOffer(j.offer_id!, "declined")} className="rounded-md bg-danger/15 px-2.5 py-1.5 text-[12px] font-semibold text-danger">Decline</button>
            </div>
          )
        ) : null}
      </div>
    );
  }

  function Bubble({ m }: { m: Msg }) {
    const mine = m.sender_id === uid;
    if (m.deleted_at) return null;
    return (
      <div className={"flex " + (mine ? "justify-end" : "justify-start")}>
        <div className={"max-w-[70%] rounded-2xl px-3.5 py-2 " + (mine ? "bg-navy text-white" : "bg-surface text-white")}>
          {m.media_type === "payment" || m.payment_id ? (
            <span className="flex items-center gap-1.5 text-[13px] text-white/70"><Wallet size={14} /> Payment · open the Platinum Circles app</span>
          ) : null}
          {m.media_type === "offer" && m.media_url ? <OfferCard m={m} /> : null}
          {(m.media_type === "image" || m.media_type === "gif") && m.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.media_url} alt="" className="mb-1 max-h-72 rounded-lg object-contain" />
          ) : null}
          {m.media_type === "video" && m.media_url ? (
            <video src={m.media_url} controls preload="metadata" className="mb-1 max-h-72 rounded-lg" />
          ) : null}
          {m.media_type === "audio" && m.media_url ? (
            <audio src={m.media_url} controls className="mb-1" />
          ) : null}
          {m.media_type === "document" && m.media_url ? (
            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 text-[13px] underline">
              <FileText size={14} /> {m.text?.replace("📄 ", "") || "Document"}
            </a>
          ) : null}
          {m.text && m.media_type !== "document" ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{m.text}</p> : null}
          <p className={"mt-0.5 text-[10px] " + (mine ? "text-white/50" : "text-white/40")}>{timeAgo(m.created_at)}</p>
        </div>
      </div>
    );
  }

  const refCard = refListing ? (
    <Link href={"/market/" + refListing.id} className="mt-2 flex items-center gap-3 rounded-lg border border-white/10 p-2.5 transition-colors hover:bg-surface">
      {refListing.images?.[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={refListing.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-white">{refListing.title}</span>
        <span className="block text-[13px] text-pearl">{(refListing.currency === "USD" ? "$" : refListing.currency + " ") + Number(refListing.price).toLocaleString()}</span>
      </span>
      {refListing.status !== "available" ? (
        <span className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/60">{refListing.status}</span>
      ) : null}
    </Link>
  ) : null;

  const typingLine = otherTyping ? <p className="text-[12px] text-pearl">typing…</p> : null;

  const convButton = (c: Conv) => (
    <button key={c.id}
      onClick={() => openConv(c)}
      className={"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors " + (active?.id === c.id ? "bg-surface-elevated" : "hover:bg-surface")}
    >
      <StoryAvatar userId={c.other_id} name={c.title} avatarUrl={c.avatar} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold text-white">{c.title}</span>
          {c.last_message_time ? <span className="shrink-0 text-[11px] text-white/40">{timeAgo(c.last_message_time)}</span> : null}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-white/50">{c.last_message || "Say hello"}</span>
          {c.unread > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-pearl px-1.5 text-[11px] font-bold text-ink">{c.unread}</span> : null}
        </span>
      </span>
    </button>
  );

  const composer = (
    <div className="flex items-end gap-2">
      <button onClick={() => fileRef.current?.click()} disabled={sendingFile} title="Attach" className="rounded-md p-2.5 text-white/50 transition-colors hover:bg-surface hover:text-pearl disabled:opacity-40">
        <Paperclip size={18} />
      </button>
      <input ref={fileRef} type="file" hidden onChange={(e) => attach(e.target.files)} />
      <textarea value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        onBlur={() => setTyping(false)}
        placeholder={sendingFile ? "Sending attachment" : "Message"}
        rows={1}
        className="max-h-32 flex-1 resize-none rounded-md bg-surface px-4 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
      />
      <button onClick={send} disabled={!draft.trim()} className="rounded-md bg-pearl p-2.5 text-ink transition-opacity hover:opacity-90 disabled:opacity-30" title="Send">
        <Send size={18} />
      </button>
    </div>
  );

  if (compact) {
    return (
      <div className="flex min-h-[70vh] flex-col px-1">
        {!active ? (
          <>
            <h1 className="mb-3 font-display text-xl text-porcelain">{heading}</h1>
            {loadingConvs ? (
              <p className="py-12 text-center text-sm text-white/40">Loading</p>
            ) : shownConvs.length === 0 ? (
              <p className="py-12 text-center text-sm text-white/40">No conversations here yet.</p>
            ) : (
              shownConvs.map(convButton)
            )}
          </>
        ) : (
          <>
            <header className="border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setActive(null)} className="rounded-md p-1.5 text-white/60 hover:bg-surface hover:text-white" title="Back">←</button>
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-white">{active.title}</p>
                  {typingLine}
                </div>
              </div>
              {refCard}
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto py-4">
              {loadingMsgs ? <p className="py-12 text-center text-sm text-white/40">Loading</p> : msgs.map((m) => <Bubble key={m.id} m={m} />)}
              <div ref={bottomRef} />
            </div>
            <footer className="border-t border-white/10 pt-3">{composer}</footer>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <section className="flex w-[340px] shrink-0 flex-col border-r border-white/10">
        <div className="px-4 pb-2 pt-6">
          <h1 className="font-display text-xl text-porcelain">{heading}</h1>
          <div className="relative mt-3">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-md bg-surface py-2 pl-9 pr-3 text-[13px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <p className="py-12 text-center text-sm text-white/40">Loading</p>
          ) : shownConvs.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-white/40">No conversations yet.</p>
          ) : (
            shownConvs.map(convButton)
          )}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <span className="h-14 w-14 rounded-full border-2 border-pearl opacity-40" aria-hidden />
            <p className="text-sm text-white/40">Pick a conversation</p>
          </div>
        ) : (
          <>
            <header className="border-b border-white/10 px-5 py-3">
              <div className="flex items-center gap-3">
                <StoryAvatar userId={active.other_id} name={active.title} avatarUrl={active.avatar} size={38} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-white">{active.title}</p>
                  {typingLine ?? (active.username ? <p className="text-[12px] text-white/40">@{active.username}</p> : null)}
                </div>
              </div>
              {refCard}
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {loadingMsgs ? (
                <p className="py-12 text-center text-sm text-white/40">Loading</p>
              ) : (
                msgs.map((m) => <Bubble key={m.id} m={m} />)
              )}
              <div ref={bottomRef} />
            </div>
            <footer className="border-t border-white/10 px-4 py-3">{composer}</footer>
          </>
        )}
      </section>
    </div>
  );
}