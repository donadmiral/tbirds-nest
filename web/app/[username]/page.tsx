import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProfilePosts } from "@/components/ProfilePosts";

type Params = { params: Promise<{ username: string }> };

async function loadProfile(username: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, bio, is_verified, verified_tier")
    .ilike("username", username)
    .limit(1)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const p = await loadProfile(username);
  if (!p) return { title: "Platinum Circles" };
  return {
    title: `${p.full_name ?? p.username} (@${p.username}) on Platinum Circles`,
    description: p.bio ?? `See ${p.full_name ?? p.username} on Platinum Circles.`,
  };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  const supabase = await createClient();
  const p = await loadProfile(username);

  if (!p) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-porcelain">Profile not found</h1>
        <Link href="/" className="mt-2 rounded-md bg-pearl px-5 py-2.5 text-sm font-semibold text-ink">
          Open Platinum Circles
        </Link>
      </main>
    );
  }

  const [followers, following] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", p.id),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", p.id),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <Link href="/home" className="mb-6 inline-block text-sm text-white/50 hover:text-white">
        ← Platinum Circles
      </Link>
      <header className="flex items-start gap-5 px-1 pb-6">
        {p.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-navy text-2xl font-semibold text-porcelain">
            {(p.full_name ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-xl font-semibold text-white">{p.full_name}</h1>
            {p.is_verified ? <BadgeCheck size={18} className="shrink-0 text-pearl" /> : null}
          </div>
          <p className="text-sm text-white/50">@{p.username}</p>
          {p.bio ? <p className="mt-2 whitespace-pre-wrap text-[14px] text-white/80">{p.bio}</p> : null}
          <p className="mt-3 flex gap-4 text-[13px] text-white/50">
            <span><span className="font-semibold text-white">{following.count ?? 0}</span> Following</span>
            <span><span className="font-semibold text-white">{followers.count ?? 0}</span> Followers</span>
          </p>
        </div>
      </header>
      <div className="border-t border-white/10">
        <ProfilePosts profileId={p.id}
          authorName={p.full_name}
          authorUsername={p.username}
          authorAvatar={p.avatar_url}
          authorVerified={!!p.is_verified}
        />
      </div>
    </main>
  );
}