"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hydratePostMedia } from "@/lib/contentMedia";
import { MediaGallery, type ViewerPost } from "@/components/MediaGallery";

type Media = Parameters<typeof MediaGallery>[0]["media"];

/**
 * The post page's pinned video: it sticks to the top of the screen on phones
 * and to the left column on desktop while the caption and comments scroll,
 * so the video and the thread stay in view together. The box keeps the feed
 * card's own frame, scaled to leave the comments their room. The complete
 * video is fitted inside it so a portrait clip is not cropped on its own page.
 */
export function PinnedMedia({ media, postId, viewsCount, aspect, post, topOffset = 0 }: { media: Media; postId: string; viewsCount?: number | null; aspect: number; post?: ViewerPost; topOffset?: number }) {
  const [mediaResult,setMediaResult]=useState<{ source: Media; safe: Media }>(()=>({source:media,safe:media}));
  const safeMedia=mediaResult.source===media?mediaResult.safe:media;
  const [mediaError,setMediaError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const client=createClient();let live=true,version=0;
    const setSafeMedia=(safe: Media)=>setMediaResult({source:media,safe});
    const refresh=async()=>{const run=++version;try{const [safe]=await hydratePostMedia([{post_id:postId,media}],client);if(live&&run===version){setSafeMedia(safe.media);setMediaError(false);}}catch{if(live&&run===version){setSafeMedia([]);setMediaError(true);}}};
    void refresh();
    const timer=setInterval(()=>void refresh(),240000);
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
    const {data}=client.auth.onAuthStateChange(()=>{version++;setSafeMedia([]);queueMicrotask(()=>{if(live)void refresh();});});
    return()=>{live=false;version++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);data.subscription.unsubscribe();};
  },[postId,media,attempt]);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const calc = () => {
      const lg = window.innerWidth >= 1024;
      const cap = (lg ? 0.82 : 0.42) * window.innerHeight;
      setW(Math.max(160, Math.round(cap / aspect)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [aspect]);
  return (
    <div className="sticky z-20 -mx-4 bg-black lg:mx-0 lg:overflow-hidden lg:rounded-2xl" style={{ top: topOffset }}>
      <div className="mx-auto" style={{ width: w ? "min(100%, " + w + "px)" : "100%" }}>
        {mediaError?<button className="p-5 text-sm text-white underline" onClick={()=>setAttempt(value=>value+1)}>Media could not be loaded. Retry</button>:null}
        <MediaGallery media={safeMedia} postId={postId} viewsCount={viewsCount ?? null} post={post} fullFrame />
      </div>
    </div>
  );
}
