"use client";

/**
 * The top action bar.
 *
 * Four controls sit above every page: compose, assistant, notifications and
 * the account menu. They live here rather than in each route because they are
 * chrome, not content, and because the unread count has to be one query no
 * matter which page is open.
 *
 * The count is read once on mount and then kept live over realtime, so opening
 * Notifications in another tab clears the dot here without a refresh.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Plus, Sparkles, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function TopBar({ name, username, avatarUrl }: { name: string; username: string; avatarUrl?: string | null }) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    // Held out here so the effect's own cleanup can remove it. Returning a
    // cleanup from inside the async body does nothing: React never sees it,
    // which is why StrictMode's second mount hit an already-subscribed
    // channel. The name carries a per-mount suffix for the same reason, since
    // supabase-js hands back the existing channel for a repeated topic.
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const readCount = async (uid: string) => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", uid)
        .eq("is_read", false);
      if (alive) setUnread(count ?? 0);
    };

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid || !alive) return;
      await readCount(uid);
      if (!alive) return;
      channel = supabase
        .channel("topbar-notifications-" + uid + "-" + Math.random().toString(36).slice(2, 8))
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq." + uid },
          () => { void readCount(uid); },
        )
        .subscribe();
    })();

    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  // A menu that traps nothing and closes on any outside click, which is what
  // people expect from an avatar menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const btn =
    "flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink";

  return (
    <div className="pointer-events-none sticky top-0 z-30 flex justify-end px-6 pt-5">
      <div className="pointer-events-auto flex items-center gap-2.5">
        <Link href="/write" className={btn} aria-label="Create a post">
          <Plus size={19} />
        </Link>
        <Link href="/discover" className={btn} aria-label="Discover">
          <Sparkles size={18} />
        </Link>
        <Link href="/notifications" className={btn + " relative"} aria-label={unread > 0 ? unread + " unread notifications" : "Notifications"}>
          <Bell size={18} />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pearl px-1 text-[10.5px] font-bold tabular-nums text-ink">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>

        <div ref={menuRef} className="relative">
          <button onClick={() => setOpen((v) => !v)} aria-label="Account menu" className="block">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full border border-ink/10 object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-porcelain text-[14px] font-semibold text-white">
                {name ? name.charAt(0).toUpperCase() : "?"}
              </span>
            )}
          </button>
          {open ? (
            <div className="absolute right-0 top-12 w-56 overflow-hidden rounded-2xl border border-ink/10 bg-white py-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.10)]">
              <div className="px-4 py-2">
                <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
                <p className="truncate text-[12px] text-ink/45">@{username}</p>
              </div>
              <div className="my-1 h-px bg-ink/8" />
              <Link href={username ? "/" + username : "/home"} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface">
                <User size={16} className="text-ink/50" /> Your profile
              </Link>
              <button
                onClick={async () => { await supabase.auth.signOut(); router.push("/login"); router.refresh(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13.5px] text-ink transition-colors duration-[140ms] hover:bg-surface"
              >
                <LogOut size={16} className="text-ink/50" /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
