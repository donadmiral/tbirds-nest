import { Heart, MessageCircle, Repeat2, Bookmark, BadgeCheck } from "lucide-react";
import type { FeedRow } from "@/lib/feed";
import { timeAgo } from "@/lib/feed";

function count(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n > 0 ? String(n) : "";
}

function Stat({
  icon: Icon,
  value,
  active,
  activeClass,
}: {
  icon: typeof Heart;
  value: number;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-[13px] ${active ? activeClass : "text-white/50"}`}>
      <Icon size={17} strokeWidth={1.8} fill={active ? "currentColor" : "none"} />
      {count(value)}
    </span>
  );
}

export function PostCard({ post }: { post: FeedRow }) {
  const text = post.content ?? post.body ?? "";
  const media = post.media ?? [];
  const products = post.products ?? [];

  return (
    <article className="border-b border-white/10 px-1 py-5">
      <div className="flex gap-3">
        {post.author_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.author_avatar}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-porcelain">
            {(post.author_name ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-white">
              {post.author_name}
            </span>
            {post.author_verified ? (
              <BadgeCheck size={16} className="shrink-0 text-pearl" />
            ) : null}
            <span className="truncate text-[13px] text-white/50">
              @{post.author_username}
            </span>
            <span className="text-[13px] text-white/30">·</span>
            <span className="shrink-0 text-[13px] text-white/50">
              {timeAgo(post.created_at)}
            </span>
          </div>

          {post.article_title ? (
            <h3 className="mt-1 font-display text-lg text-porcelain">
              {post.article_title}
            </h3>
          ) : null}

          {text ? (
            <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">
              {text}
            </p>
          ) : null}

          {media.length > 0 ? (
            <div className={`mt-3 grid gap-1 overflow-hidden rounded-lg ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {media.slice(0, 4).map((m) =>
                m.media_type === "video" ? (
                  <video key={m.id}
                    src={m.url}
                    controls
                    preload="metadata"
                    className="max-h-[480px] w-full bg-black object-contain"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.id}
                    src={m.url}
                    alt=""
                    loading="lazy"
                    className="max-h-[480px] w-full bg-surface object-cover"
                  />
                )
              )}
            </div>
          ) : null}

          {post.link && media.length === 0 ? (
            <a href={post.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-lg border border-white/10 transition-colors hover:bg-surface"
            >
              {post.link.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.link.image_url}
                  alt=""
                  loading="lazy"
                  className="max-h-60 w-full object-cover"
                />
              ) : null}
              <span className="block px-3 py-2">
                <span className="block text-[11px] uppercase tracking-wide text-white/40">
                  {post.link.domain}
                </span>
                <span className="block truncate text-[14px] text-white/90">
                  {post.link.title ?? post.link.url}
                </span>
              </span>
            </a>
          ) : null}

          {products.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {products.map((p) => (
                <div key={p.id} className="w-52 shrink-0 overflow-hidden rounded-lg border border-white/10">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url}
                      alt=""
                      loading="lazy"
                      className="h-28 w-full bg-surface object-cover"
                    />
                  ) : null}
                  <div className="px-3 py-2">
                    <p className="truncate text-[13px] font-medium text-white">
                      {p.title}
                    </p>
                    {p.price != null ? (
                      <p className="text-[13px] text-pearl">
                        {p.currency ?? ""} {p.price}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-7">
            <Stat icon={MessageCircle} value={post.comments_count} />
            <Stat icon={Repeat2} value={post.reposts_count} active={post.viewer_reposted} activeClass="text-success" />
            <Stat icon={Heart} value={post.likes_count} active={post.viewer_liked} activeClass="text-danger" />
            <Stat icon={Bookmark} value={post.bookmarks_count} active={post.viewer_bookmarked} activeClass="text-pearl" />
          </div>
        </div>
      </div>
    </article>
  );
}