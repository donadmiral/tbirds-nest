import NextImage from "next/image";
import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, BriefcaseBusiness, CalendarDays, ChevronRight, FileText, LockKeyhole, MapPin, PenLine, Link as LinkIcon } from "lucide-react";
import styles from "@/components/ProfilePage.module.css";
import { createClient } from "@/lib/supabase/server";
import { getServerViewer } from "@/lib/serverViewer";
import { FollowButton } from "@/components/FollowButton";
import { safeProfileLinks } from "@/lib/profileForm";
import { ProfilePosts } from "@/components/ProfilePosts";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { BusinessProfile } from "@/components/BusinessProfile";
import { MemoryAlbumBook } from "@/components/MemoryAlbumBook";
import { MessageButton } from "@/components/MessageButton";
import { ProfileMoreMenu } from "@/components/ProfileMoreMenu";
import { ProfileContext } from "@/components/ProfileContext";
import { isProfileId, matchesUsername, profilePath, usernameLookupPattern } from "@/lib/profileLookup";

type Params = { params: Promise<{ username: string }> };

const loadProfile = cache(async (username: string) => {
  const supabase = await createClient();
  const query = supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, banner_url, bio, headline, workplace, location, created_at, links, is_verified, verified_tier, account_type, account_class, account_labels");
  const byId = isProfileId(username);
  const { data, error } = await (byId ? query.eq("id", username) : query.ilike("username", usernameLookupPattern(username))).limit(1).maybeSingle();
  if (error) throw new Error("This profile could not load. Please try again.");
  return (byId ? data?.id === username.toLowerCase() : matchesUsername(data, username)) ? data : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const p = await loadProfile(username);
  if (!p) return { title: "Platinum Circles" };
  return {
    title: (p.full_name ?? p.username ?? "Member") + (p.username ? " (@" + p.username + ")" : "") + " on Platinum Circles",
    description: p.bio ?? "See " + (p.full_name ?? p.username) + " on Platinum Circles.",
  };
}

function fmtCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  const supabase = await createClient();
  const p = await loadProfile(username);

  if (!p) {
    return (
      <section className="flex min-h-[65vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-ink">Profile not found</h1>
        <Link href="/" className="mt-2 rounded-full bg-pearl px-5 py-2.5 text-sm font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">
          Open Platinum Circles
        </Link>
      </section>
    );
  }

  const { user } = await getServerViewer();
  const isOwner = user?.id === p.id;
  const isBusiness = p.account_type === "business";
  const isCreator = p.account_class === "creator";
  const links = safeProfileLinks(p.links);
  const labels = (p.account_labels ?? {}) as Record<string, boolean>;
  const chips = [isBusiness ? "Business" : isCreator ? "Creator" : p.account_class === "organization" ? "Organization" : p.account_class === "automated" ? "Automated" : null, labels.parody ? "Parody" : null, labels.fan ? "Fan account" : null, labels.commentary ? "Commentary" : null, labels.memorialized ? "Remembering" : null].filter(Boolean);
  const [followers, following, postCount] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", p.id),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", p.id),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", p.id),
  ]);

  const posts = (
    <ProfilePosts profileId={p.id}
      authorName={p.full_name}
      authorUsername={p.username}
      authorAvatar={p.avatar_url}
      authorVerified={!!p.is_verified}
    />
  );

  return (
    <section className={styles.profile}>
      <div className={styles.topline}>
        <Link href="/home" className={styles.back}><ArrowLeft size={18} aria-hidden /><span>Back to Home</span></Link>
        <span className={styles.eyebrow}>{isBusiness ? "Business profile" : isCreator ? "Creator profile" : "Profile"}</span>
      </div>
      <header className={styles.header}>
        <div className={styles.banner}>
          {p.banner_url ? <NextImage unoptimized fill sizes="100vw" src={p.banner_url} alt="" className={styles.bannerImage} /> : <span className={styles.coverMark} aria-hidden>Platinum Circles</span>}
        </div>
        <div className={styles.identity}>
          <div className={styles.avatar}><StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={128} /></div>
          <div className={styles.heading}>
            <div className={styles.nameRow}><h1 className={styles.name}>{p.full_name || p.username || 'Member'}</h1>{p.is_verified ? <VerifiedBadge userId={p.id} tier={p.verified_tier} size={21} /> : null}</div>
            <p className={styles.username}>{p.username ? '@' + p.username : 'Platinum Circles member'}{chips.length ? ' · ' + chips.join(' · ') : ''}</p>
            {p.bio ? <p className={styles.bio}>{p.bio}</p> : null}
            {p.headline ? <p className={styles.headline}>{p.headline}</p> : null}
            <div className={styles.metadata}>
              {p.location ? <span><MapPin size={15} aria-hidden />{p.location}</span> : null}
              {p.workplace ? <span><BriefcaseBusiness size={15} aria-hidden />{p.workplace}</span> : null}
              {links.slice(0, 1).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"><LinkIcon size={15} aria-hidden />{link.title || new URL(link.url).hostname}</a>)}
            </div>
            <div className={styles.stats}>
              <Link href={profilePath(p.username, p.id) + '/follows?tab=followers'}><strong>{followers.error ? '—' : fmtCount(followers.count ?? 0)}</strong><span>followers</span></Link>
              {!isBusiness ? <Link href={profilePath(p.username, p.id) + '/follows?tab=following'}><strong>{following.error ? '—' : fmtCount(following.count ?? 0)}</strong><span>following</span></Link> : null}
              <a href="#profile-posts"><strong>{postCount.error ? '—' : fmtCount(postCount.count ?? 0)}</strong><span>posts</span></a>
            </div>
          </div>
          <div className={styles.actions}>
            {isOwner ? <Link href="/settings/profile" className={styles.primaryAction}><PenLine size={16} aria-hidden />Edit profile</Link> : <><FollowButton authorId={p.id} /><MessageButton profileId={p.id} /></>}
            <ProfileContext key={p.id} profileId={p.id} username={p.username ?? ''} compact />
            {!isOwner ? <ProfileMoreMenu key={p.id} profileId={p.id} name={p.full_name ?? null} /> : null}
          </div>
        </div>
      </header>
      <div className={styles.columns}>
        <div className={styles.main}>
          <MemoryAlbumBook profileId={p.id} />
          <div id="profile-posts" className={styles.posts}>
            {isBusiness ? <BusinessProfile profileId={p.id} postsSlot={posts} /> : posts}
          </div>
        </div>
        <aside className={styles.rail} aria-label="Profile details">
          {isOwner ? <section className={styles.panel}>
            <h2><LockKeyhole size={19} aria-hidden />Your private space</h2>
            <p>Keep your ideas, links and drafts close.</p>
            <Link href="/saved" className={styles.railLink}><Bookmark size={19} aria-hidden /><span><strong>Saved collections</strong><small>Posts and ideas you saved</small></span><ChevronRight size={17} aria-hidden /></Link>
            <Link href="/home?compose=post" className={styles.railLink}><FileText size={19} aria-hidden /><span><strong>Continue a post</strong><small>Open your draft on this browser</small></span><ChevronRight size={17} aria-hidden /></Link>
            {isBusiness || isCreator ? <Link href="/studio" className={styles.railLink}><BriefcaseBusiness size={19} aria-hidden /><span><strong>Open Studio</strong><small>Content, insights and professional work</small></span><ChevronRight size={17} aria-hidden /></Link> : null}
          </section> : null}
          <section className={styles.panel}>
            <div className={styles.panelHeading}><h2>Profile details</h2>{isOwner ? <Link href="/settings/profile" aria-label="Edit profile details"><PenLine size={17} /></Link> : null}</div>
            <dl className={styles.details}>
              <div><dt>Name</dt><dd>{p.full_name || p.username || 'Member'}</dd></div>
              {p.username ? <div><dt>Username</dt><dd>@{p.username}</dd></div> : null}
              {p.headline ? <div><dt>Headline</dt><dd>{p.headline}</dd></div> : null}
              {p.location ? <div><dt><MapPin size={14} aria-hidden />Location</dt><dd>{p.location}</dd></div> : null}
              {p.workplace ? <div><dt>Work</dt><dd>{p.workplace}</dd></div> : null}
              {links.map(link => <div key={link.url}><dt><LinkIcon size={14} aria-hidden />Website</dt><dd><a href={link.url} target="_blank" rel="noopener noreferrer">{link.title || new URL(link.url).hostname}</a></dd></div>)}
              {p.created_at ? <div><dt><CalendarDays size={14} aria-hidden />Joined</dt><dd>{new Date(p.created_at).toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'})}</dd></div> : null}
            </dl>
          </section>
          {isCreator && !isOwner ? <section className={styles.panel}><h2><BriefcaseBusiness size={19} aria-hidden />Connect with {p.full_name?.split(' ')[0] || 'this creator'}</h2><p>Explore their work and start a conversation about a collaboration.</p><MessageButton profileId={p.id} />{links.length ? <a className={styles.railLink} href={links[0].url} target="_blank" rel="noopener noreferrer"><LinkIcon size={18} aria-hidden /><span>{links[0].title || 'Creator website'}</span><ChevronRight size={17} aria-hidden /></a> : null}</section> : null}
        </aside>
      </div>
    </section>
  );
}
