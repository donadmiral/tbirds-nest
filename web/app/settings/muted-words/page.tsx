"use client";
// Muted words: comments on your posts containing any of these are hidden the
// moment they're written. Same rows the phone edits.
import { useState } from "react";

import { X } from "lucide-react";
import { useWordPreferences } from "@/lib/useWordPreferences";

export default function MutedWordsPage() {
  const { words, loading, loadError, error, ready, saving, retry, save } = useWordPreferences("muted_words");
  const [draft, setDraft] = useState("");
  const add = async () => {
    const submitted = draft, word = draft.trim().toLowerCase();
    if (!ready || saving || !word) return;
    if (words.includes(word) || await save([...words, word])) setDraft(current => current === submitted ? "" : current);
  };

  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Muted words</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Posts that contain any of these words or phrases stay out of your feeds. Nobody is told.</p>
      <div className="mt-5 flex gap-2">
        <input disabled={!ready || saving} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Add a word or phrase" aria-label="Add a muted word or phrase" className="flex-1 rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted focus:border-pearl disabled:opacity-50" />
        <button type="button" onClick={() => void add()} disabled={!ready || saving} className="rounded-xl bg-ink px-4 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-50">Add</button>
      </div>
      {loading ? <p role="status" className="mt-3 text-sm text-muted">Loading word settings…</p> : null}
      {loadError ? <div role="alert" className="mt-3 text-sm text-danger"><p>{loadError}</p><button type="button" onClick={() => void retry()} className="mt-2 underline">Try again</button></div> : null}
      {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <ul className="mt-4 divide-y divide-ink/8">
        {words.map((w) => (
          <li key={w} className="flex items-center justify-between py-3">
            <span className="text-[15px] font-semibold text-ink">{w}</span>
            <button type="button" disabled={!ready || saving} onClick={() => void save(words.filter((x) => x !== w))} className="rounded-full p-1 text-muted hover:bg-surface hover:text-ink disabled:opacity-50" title="Remove"><X size={16} /></button>
          </li>
        ))}
      </ul>
      {ready && words.length === 0 ? <p className="mt-3 text-[13.5px] text-muted">Nothing muted yet.</p> : null}
    </div>
  );
}
