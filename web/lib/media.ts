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
  return base + (base.includes("?") ? "&" : "?") + "width=" + width + "&quality=80&resize=contain";
}

export function isLikelyUnplayableVideo(url: string | null | undefined): boolean {
  if (!url) return false;
  const clean = url.split("?")[0].toLowerCase();
  return clean.endsWith(".mov") || clean.endsWith(".hevc");
}
// Rendition ladder for images through the render endpoint, doctrine 13, 14, 36.
export function srcSetFor(url: string): { srcSet: string; sizes: string } {
  const widths = [480, 960, 1440];
  return {
    srcSet: widths.map((w) => displayImageUrl(url, w) + " " + w + "w").join(", "),
    sizes: "(max-width: 700px) 92vw, 640px",
  };
}
/**
 * Formats a browser can render. Everything else is refused at the picker with
 * a message that says what to do, so a HEIC photo or a QuickTime clip never
 * reaches the bucket from web again. Phones convert on their side.
 */
const RENDERABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/aac", "application/pdf"]);
const BAD_EXT = /\.(heic|heif|mov|avi|wmv|flv|tiff?|bmp|3gp)$/i;

export function checkUploadable(file: File): string | null {
  const type = (file.type || "").toLowerCase();
  const name = file.name || "";
  if (BAD_EXT.test(name) || type === "image/heic" || type === "image/heif" || type === "video/quicktime") {
    return name.match(/\.(mov|3gp)$/i) || type === "video/quicktime"
      ? "That video is a QuickTime file, which browsers cannot play. Export it as MP4 and try again."
      : "That photo is a HEIC file, which browsers cannot show. Save it as JPG or PNG and try again.";
  }
  if (type && !RENDERABLE.has(type) && !type.startsWith("image/") && !type.startsWith("video/")) {
    return "That file type is not supported here.";
  }
  return null;
}


/**
 * The same judgement, by bytes rather than by name. A phone can hand over a
 * QuickTime clip called photo.jpg with a JPEG label; the first sixteen bytes
 * cannot lie. Call this before uploading anything from a picker.
 */
export async function checkUploadableBytes(file: File): Promise<string | null> {
  const quick = checkUploadable(file);
  if (quick) return quick;
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const brand = String.fromCharCode(...head.slice(4, 12));
    if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return "That photo is a HEIC file, which browsers cannot show. Save it as JPG or PNG and try again.";
    const isVideo = /^ftyp(qt|isom|mp42|mp41|avc1|iso2|M4V)/.test(brand);
    if (isVideo && !file.type.startsWith("video/")) return "That file is a video, not a photo. Choose it as a video instead.";
    if (/^ftypqt/.test(brand)) return "That video is a QuickTime file, which browsers cannot play. Export it as MP4 and try again.";
    const isJpeg = head[0] === 0xff && head[1] === 0xd8;
    const isPng = head[0] === 0x89 && head[1] === 0x50;
    const isWebp = String.fromCharCode(...head.slice(8, 12)) === "WEBP";
    const isGif = String.fromCharCode(...head.slice(0, 3)) === "GIF";
    if (file.type.startsWith("image/") && !(isJpeg || isPng || isWebp || isGif)) return "That file is not an image a browser can show. Save it as JPG or PNG and try again.";
  } catch { /* unreadable slice: let the server decide */ }
  return null;
}
