"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { useViewerIdentity } from "@/lib/useViewerIdentity";
import { ProductDialog } from "@/components/ProductDialog";
import { createClient } from "@/lib/supabase/client";

type Check = {
  id: string; body: string; sources: string[]; created_at: string;
  helpful_count: number; not_helpful_count: number;
  viewer_vote: boolean | null; is_mine: boolean; qualifies: boolean;
};

// Fact Check: readers add context with sources, votes decide what shows.
export function FactCheckBanner({postId}:{postId:string}) {return <FactCheckContent key={postId} postId={postId}/>;}
function FactCheckContent({ postId }: { postId: string }) {
  const [supabase] = useState(createClient);
  const [checks, setChecks] = useState<Check[]>([]);

  const {viewer}=useViewerIdentity();
  const owner=viewer?.id??null;
  const [previousOwner,setPreviousOwner]=useState(owner);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  if(previousOwner!==owner){setPreviousOwner(owner);setChecks([]);setError("");}
  const load=useCallback(async()=>{
    const {data,error}=await withTimeout(supabase.rpc("get_fact_checks",{p_post_id:postId}));
    if(error)throw error;
    return (data??[]) as Check[];
  },[postId,supabase]);
  useEffect(()=>{let active=true;void load().then(data=>{if(active){setChecks(data);setError("");}}).catch(cause=>{if(active)setError(errorMessage(cause,"Reader context could not load."));});return()=>{active=false;};},[load,owner,attempt]);
  const top=checks.find(check=>check.qualifies)??null;
  const pendingMine=checks.find(check=>check.is_mine&&!check.qualifies);
  if(!top&&!pendingMine&&!error)return null;
  async function rate(id:string,helpful:boolean) {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");
    try {
      const session=await withTimeout(supabase.auth.getUser());
      if(session.error||!owner||session.data.user?.id!==owner)throw new Error("Sign in again before rating this fact check.");
      const {error}=await withTimeout(supabase.rpc("rate_fact_check",{p_id:id,p_helpful:helpful}));
      if(error)throw error;
      setAttempt(value=>value+1);
    } catch(cause){setError(errorMessage(cause,"Your rating could not be saved. Please retry."));}
    finally{pending.current=false;setBusy(false);}
  }
  return (
    <div className="mt-3 rounded-lg border border-pearl/30 bg-pearl/5 p-3.5">
      {error?<p role="alert" className="mb-2 text-sm text-danger">{error} <button onClick={()=>setAttempt(value=>value+1)} className="underline">Retry</button></p>:null}
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-accent">
        <ShieldCheck size={14} /> {top ? "Readers added a fact check" : "Your fact check is awaiting reader ratings"}
      </p>
      {top ? (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/85">{top.body}</p>
          {top.sources.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-2">
              {top.sources.map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="max-w-full truncate rounded-md bg-surface px-2 py-1 text-[11px] text-accent hover:underline">
                  {s.replace(/^https?:\/\//, "").slice(0, 40)}
                </a>
              ))}
            </span>
          ) : null}
          {!top.is_mine ? (
            <span className="mt-2.5 flex items-center gap-2 text-[12px] text-muted">
              Is this helpful?
              <button disabled={busy} onClick={() => rate(top.id, true)} className={"rounded-md px-2.5 py-1 " + (top.viewer_vote === true ? "bg-pearl font-semibold text-on-pearl" : "bg-surface text-ink hover:bg-surface-elevated")}>Yes</button>
              <button disabled={busy} onClick={() => rate(top.id, false)} className={"rounded-md px-2.5 py-1 " + (top.viewer_vote === false ? "bg-pearl font-semibold text-on-pearl" : "bg-surface text-ink hover:bg-surface-elevated")}>No</button>
              <span className="ml-auto">{top.helpful_count} found this helpful</span>
            </span>
          ) : (
            <span className="mt-2 block text-[12px] text-muted">{top.helpful_count} readers found this helpful</span>
          )}
        </>
      ) : (
        <p className="mt-1 text-[12px] text-muted">It becomes public once at least 3 readers rate it helpful.</p>
      )}
    </div>
  );
}

export function FactCheckModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [supabase] = useState(createClient);
  const [body, setBody] = useState("");
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitting=useRef(false);
  async function submit() {
    if(submitting.current||body.trim().length<20)return;
    submitting.current=true;setBusy(true);setErr(null);
    try{
      const {data,error:authError}=await withTimeout(supabase.auth.getUser());
      if(authError||!data.user)throw new Error("Sign in first.");
      const sources=[s1,s2].map(value=>value.trim()).filter(Boolean);
      if(sources.some(source=>!/^https?:\/\//i.test(source)))throw new Error("Source links must begin with https:// or http://.");
      const {error}=await withTimeout(supabase.from("fact_checks").insert({post_id:postId,author_id:data.user.id,body:body.trim(),sources}));
      if(error)throw error;
      onClose();
      window.dispatchEvent(new CustomEvent("pc-refresh-feed"));
    }catch(cause){const message=errorMessage(cause,"Your fact check could not be saved. Please try again.");setErr(message.includes("duplicate")?"You already added a fact check on this post.":message.includes("row-level")?"You cannot fact check your own post.":message);}
    finally{submitting.current=false;setBusy(false);}
  }

  return (
    <ProductDialog open title="Add a fact check" busy={busy} onClose={onClose}>
      <div className="w-full max-w-md rounded-xl border border-ink/10 bg-navy p-5" onClick={(e) => e.stopPropagation()}>
        <p className="flex items-center justify-between text-[15px] font-semibold text-ink">
          <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-accent" /> Add a fact check</span>
          <button disabled={busy} onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted hover:bg-surface hover:text-ink"><X size={16} /></button>
        </p>
        <p className="mt-1 text-[12px] text-muted">Add missing context with sources. It shows on the post once at least 3 readers rate it helpful. Minimum 20 characters.</p>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4}
          placeholder="What context is missing, and what do the sources actually say?"
          className="mt-3 w-full resize-none rounded-md bg-surface px-3 py-2.5 text-[13.5px] text-ink placeholder:text-muted outline-none focus:bg-surface-elevated"
        />
        <input value={s1} onChange={(e) => setS1(e.target.value)} placeholder="Source link, https://" className="mt-2 w-full rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted outline-none" />
        <input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="Second source, optional" className="mt-2 w-full rounded-md bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted outline-none" />
        {err ? <p className="mt-2 text-[12px] text-danger">{err}</p> : null}
        <button onClick={submit} disabled={busy || body.trim().length < 20}
          className="mt-3 w-full rounded-md bg-pearl py-2.5 text-[13px] font-semibold text-on-pearl transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Submitting" : "Submit fact check"}
        </button>
      </div>
    </ProductDialog>
  );
}