// Browser-safe display URLs. iPhone uploads store HEIC images and HEVC
// .mov videos; browsers decode neither. Images route through Supabase's
// render endpoint which decodes HEIC server-side; the caller falls back
// to the original on error in case transforms are unavailable.
const OBJ = "/storage/v1/object/public/";
const REN = "/storage/v1/render/image/public/";

export function displayImageUrl(url: string | null | undefined, width = 1200): string | null {
  if (!url) return null;
  if (!url.includes(OBJ)) return url;
  const base = url.replace(OBJ, REN);
  return base + (base.includes("?") ? "&" : "?") + "width=" + width + "&quality=80";
}

export function isLikelyUnplayableVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  const clean = url.split("?")[0].toLowerCase();
  return clean.endsWith(".mov") || clean.endsWith(".hevc");
}