/** Storage URLs are object references, never an authorization fallback. */
export function channelMediaObject(value: string, supabaseUrl: string): { bucket: "channel-media" | "chat-media"; path: string } | null {
  try {
    const url = new URL(value), base = new URL(supabaseUrl);
    if (url.origin !== base.origin || url.username || url.password || url.hash) return null;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(channel-media|chat-media)\/(.+)$/);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (path.includes('%') || path.includes('\\') || path.length > 1024 || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
    return { bucket: match[1] as "channel-media" | "chat-media", path };
  } catch { return null; }
}
