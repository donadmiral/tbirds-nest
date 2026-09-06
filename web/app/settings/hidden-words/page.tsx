"use client";
// Hidden words: comments on your posts containing any of these are hidden the
// moment they're written. Same rows the phone edits.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function HiddenWordsPage() {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id ?? null; setUid(id); if (!id) return;
      const { data } = await supabase.from("profiles").select("hidden_words").eq("id", id).maybeSingle();
      setWords(((data as { hidden_words?: string[] } | null)?.hidden_words) || []);
    })();
  }, [supabase]);

  const save = async (next: string[]) => {
    if (!uid) return;
    const { error } = await supabase.from("profiles").update({ hidden_words: next }).eq("id", uid);
    if (error) { setErr(error.message); return; }
    setErr(null); setWords(next);
  };
  const add = () => { const w = draft.trim().toLowerCase(); if (!w) return; if (!words.includes(w)) save([...words, w]); setDraft(""); };

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Hidden words</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Comments on your posts that contain any of these are hidden as soon as they're written. Only the person who wrote one can see it.</p>
      <div className="mt-5 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a word or phrase" className="flex-1 rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink/35 focus:border-pearl" />
        <button type="button" onClick={add} className="rounded-xl bg-ink px-4 text-[14px] font-bold text-white hover:opacity-90">Add</button>
      </div>
      {err ? <p className="mt-2 text-[13px] text-red-500">{err}</p> : null}
      <ul className="mt-4 divide-y divide-ink/8">
        {words.map((w) => (
          <li key={w} className="flex items-center justify-between py-3">
            <span className="text-[15px] font-semibold text-ink">{w}</span>
            <button type="button" onClick={() => save(words.filter((x) => x !== w))} className="rounded-full p-1 text-ink/50 hover:bg-surface hover:text-ink" title="Remove"><X size={16} /></button>
          </li>
        ))}
      </ul>
      {words.length === 0 ? <p className="mt-3 text-[13.5px] text-ink/50">Nothing hidden yet.</p> : null}
    </div>
  );
}