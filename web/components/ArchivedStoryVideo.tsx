"use client";

import { useEffect, useRef } from "react";
import { attachAdaptiveVideo } from "@/lib/adaptiveVideo";

/** The archive authorizes this source immediately before opening the viewer. */
export function ArchivedStoryVideo({ source }: { source: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const attachment = attachAdaptiveVideo(element, source);
    const recover = () => attachment.recover();
    const pauseHidden = () => { if (document.hidden) element.pause(); };
    element.addEventListener("error", recover);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseHidden);
      element.removeEventListener("error", recover);
      attachment.dispose();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [source]);
  return <video ref={video} controls autoPlay playsInline preload="metadata" className="max-h-[88vh] rounded-xl" onPlay={event => { if (document.hidden) event.currentTarget.pause(); }} />;
}
