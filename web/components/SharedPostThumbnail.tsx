"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, Layers, Music, Play, Video } from "lucide-react";
import { sharedPostImageUri, sharedPostMediaKind, sharedPostMediaLabel, type SharedPostMedia } from "../../shared/sharedPostPreview";

export function SharedPostThumbnail({ postId, media, mediaCount = 0 }: { postId: string; media: SharedPostMedia; mediaCount?: number }) {
  const uri = sharedPostImageUri(media);
  const identity = `${postId}:${uri ?? ""}`;
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!uri && failed !== identity;
  const kind = sharedPostMediaKind(media.media_type, media.url);
  const label = sharedPostMediaLabel(media, mediaCount);
  const Icon = mediaCount > 1 ? Layers : kind === "video" ? Video : kind === "audio" ? Music : kind === "file" ? FileText : ImageIcon;

  return (
    <span role="img" aria-label={`${label} from original post${failed === identity ? ". Preview unavailable" : ""}`} className="relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg bg-surface text-muted">
      <Icon size={20} aria-hidden />
      <span className="max-w-full truncate px-0.5 text-[10px] font-medium">{label}</span>
      {showImage ? (
        // Keep the granted URL intact; an unsigned original is not a fallback.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={identity} src={uri} alt="" loading="lazy" decoding="async" onError={() => setFailed(identity)} className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {showImage && kind === "video" ? <span className="absolute inset-0 flex items-center justify-center bg-black/10 text-white"><Play size={14} fill="currentColor" aria-hidden /></span> : null}
      {showImage && mediaCount > 1 ? <span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[9px] text-white"><Layers size={9} aria-hidden />{mediaCount}</span> : null}
    </span>
  );
}
