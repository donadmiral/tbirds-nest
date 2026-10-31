"use client";
import NextImage from "next/image";

import Link from "next/link";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ProductDialog } from "@/components/ProductDialog";
import { profilePath } from "@/lib/profileLookup";
import { PersonName } from "@/components/PersonName";
import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Opt = { option_id: string; label: string; votes: number; viewer_vote: string | null; ends_at: string; total: number };

export function PollCard({postId}:{postId:string}) {return <PostPoll key={postId} postId={postId}/>;}
function PostPoll({postId}:{postId:string}) {
  const read=useCallback(async(supabase:ReturnType<typeof createClient>,owner:string)=>{
    const [poll,post]=await Promise.all([supabase.rpc("get_poll",{p_post_id:postId}),supabase.from("posts").select("user_id").eq("id",postId).maybeSingle()]);
    if(poll.error||post.error)throw poll.error||post.error;
    return {options:(poll.data??[]) as Opt[],isAuthor:post.data?.user_id===owner};
  },[postId]);
  const resource=useAccountResource(read,{options:[] as Opt[],isAuthor:false});
  const opts=resource.data.options,isAuthor=resource.data.isAuthor;
  const [votersOpen,setVotersOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef(false),now=useCurrentTime();
  const ended=!!opts.length&&now!==null&&new Date(opts[0].ends_at).getTime()<=now;
  const voted=!!opts[0]?.viewer_vote,total=opts[0]?.total??0,showResults=voted||ended;
  const hoursLeft=opts.length&&now!==null?Math.max(0,Math.round((new Date(opts[0].ends_at).getTime()-now)/3600000)):null;
  async function vote(id:string){
    if(showResults||pending.current)return;pending.current=true;setBusy(true);setError("");
    try{await resource.assertOwner();const {error}=await withTimeout(resource.client.rpc("vote_poll",{p_post_id:postId,p_option_id:id}));if(error)throw error;await resource.assertOwner();resource.reload();}
    catch(cause){setError(errorMessage(cause,"Your vote could not be saved. Please retry."));}
    finally{pending.current=false;setBusy(false);}
  }
  if(resource.error)return <p role="alert" className="mt-3 text-sm text-danger">Poll unavailable. <button className="underline" onClick={resource.retry}>Retry</button></p>;
  if(!opts.length)return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      {opts.map((o) => {
        const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
        const mine = o.viewer_vote === o.option_id;
        return showResults ? (
          <span key={o.option_id} className="relative overflow-hidden rounded-md border border-ink/10 px-3 py-2">
            <span aria-hidden className={"absolute inset-y-0 left-0 " + (mine ? "bg-pearl/40" : "bg-ink/10")} style={{ width: pct + "%" }} />
            <span className="relative flex items-center justify-between text-[13.5px] text-ink">
              <span className={mine ? "font-semibold" : ""}>{o.label}{mine ? " ✓" : ""}</span>
              <span className="text-muted">{pct}%</span>
            </span>
          </span>
        ) : (
          <button key={o.option_id} disabled={busy||resource.loading} onClick={() => vote(o.option_id)}
            className="rounded-md border border-pearl px-3 py-2 text-left text-[13.5px] font-semibold text-ink transition-colors hover:bg-pearl/15"
          >
            {o.label}
          </button>
        );
      })}
      <span className="text-[12px] text-muted">
        {total} {total === 1 ? "vote" : "votes"} · {ended ? "Final results" : hoursLeft===null ? "Open" : hoursLeft + "h left"}{isAuthor ? <> · <button type="button" onClick={() => setVotersOpen(true)} className="underline">See votes</button></> : null}
      </span>
      {votersOpen ? <PollVoters postId={postId} onClose={() => setVotersOpen(false)} /> : null}
    </div>
  );
}

export function PollVoters({ postId, onClose }: { postId: string; onClose: () => void }) {
  type Voter={option_id:string;label:string;user_id:string;full_name:string|null;username:string|null;avatar_url:string|null};
  const read=useCallback(async(client:ReturnType<typeof createClient>)=>{const {data,error}=await client.rpc("get_poll_voters",{p_post_id:postId});if(error)throw error;return (data??[]) as Voter[];},[postId]);
  const resource=useAccountResource(read,[]),rows=resource.data;
  const groups: Record<string, typeof rows> = {};
  (rows ?? []).forEach((r) => { (groups[r.label] = groups[r.label] ?? []).push(r); });
  return (
    <ProductDialog open title="Poll votes" onClose={onClose}>
      <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[15px] font-semibold">Votes</div>
        {resource.error?<p role="alert">{resource.error} <button onClick={resource.retry}>Retry</button></p>:resource.loading ? <div className="text-[13px] text-muted">Loading</div> : rows.length === 0 ? <div className="text-[13px] text-muted">No votes yet</div> : Object.entries(groups).map(([label, list]) => (
          <div key={label} className="mb-3">
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{label} · {list?.length}</div>
            {(list ?? []).map((r) => (
              <Link key={r.user_id} href={profilePath(r.username, r.user_id)} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? <NextImage unoptimized width={32} height={32} src={r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full bg-surface" />}
                <PersonName name={r.full_name ?? r.username ?? ""} userId={r.user_id} className="text-[14px] font-semibold" />
              </Link>
            ))}
          </div>
        ))}
      </div>
    </ProductDialog>
  );
}
