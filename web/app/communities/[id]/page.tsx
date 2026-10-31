"use client";
import NextImage from "next/image";

import { errorMessage } from "@/lib/errors";

import { useCallback, useEffect, useRef, useState } from "react";
import { createScopedMutation } from "../../../../shared/scopedMutation";
import { withTimeout } from "@/lib/withTimeout";
import { checkUploadableBytes, displayImageUrl } from "@/lib/media";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Camera, Check, Hash, Image as ImageIcon, Inbox, Link2, LogOut, MessageCircle, Megaphone, MoreHorizontal, Plus, Send, Settings2, Shield, UserPlus, Users, X } from "lucide-react";
import { useSocialPages } from "@/lib/useSocialPages";
import { SocialPageFooter } from "@/components/SocialPageFooter";
import { ErrorState } from "@/components/ErrorState";
import { PersonName } from "@/components/PersonName";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";
import { ProductDialog } from "@/components/ProductDialog";
import type { CommunityPost, CommunityMember, CommunityRequest, CommunityInvite, CommunityAnnouncement, SubCommunity, CommunityBan, DirectoryPerson } from "@/lib/socialTypes";
import styles from "@/components/SocialWorkspace.module.css";

type Info = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; rules: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
  has_invite?: boolean; my_status?: string | null; is_banned?: boolean; parent_id?: string | null; parent_name?: string | null;
};

export default function CommunityPage() {
  const params = useParams<{ id: string }>();
  const communityId = String(params.id || "");
  return <CommunityWorkspace key={communityId} communityId={communityId} />;
}

function CommunityWorkspace({ communityId }: { communityId: string }) {
  const [supabase] = useState(createClient);
  const [me, setMe] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const postsPage = useSocialPages<CommunityPost>("get_community_posts_page", { p_community: communityId }, { key: "post_id", enabled: !!info?.is_member });
  const { items: posts, setItems: setPosts } = postsPage;
  const infoRequest = useRef(0);
  const postLock = useRef(false);
  const actions=useRef(createScopedMutation());const mutationEpoch=useRef(0);
  const [infoError, setInfoError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const membersPage = useSocialPages<CommunityMember>("get_community_members_page", { p_community: communityId }, { key: "user_id", enabled: membersOpen && !!info?.is_member });
  const { items: members, setItems: setMembers } = membersPage;
  const [requestsOpen, setRequestsOpen] = useState(false);
  const requestsPage = useSocialPages<CommunityRequest>("get_join_requests_page", { p_community: communityId }, { key: "user_id", enabled: requestsOpen && !!info?.is_member });
  const { items: requests, setItems: setRequests } = requestsPage;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Membership machine: invitations, announcements, sub-groups, limited and removed members.
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQ, setInviteQ] = useState("");
  const [inviteHits, setInviteHits] = useState<DirectoryPerson[]>([]);
  const invitesPage = useSocialPages<CommunityInvite>("get_community_invites_page", { p_community: communityId }, { key: "user_id", enabled: inviteOpen && !!info?.is_member });
  const { items: invites, setItems: setInvites } = invitesPage;
  const announcementsPage = useSocialPages<CommunityAnnouncement>("get_community_announcements_page", { p_community: communityId }, { key: "id", enabled: !!info?.is_member });
  const { items: announcements, setItems: setAnnouncements } = announcementsPage;
  const [annDraft, setAnnDraft] = useState("");
  const [annOpen, setAnnOpen] = useState(false);
  const subsPage = useSocialPages<SubCommunity>("get_sub_communities_page", { p_community: communityId }, { key: "id", enabled: !!info?.is_member });
  const { items: subs } = subsPage;
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState("");
  const [subDesc, setSubDesc] = useState("");
  const [subMode, setSubMode] = useState<"open" | "approval" | "invite">("open");
  const [bansOpen, setBansOpen] = useState(false);
  const bansPage = useSocialPages<CommunityBan>("get_community_bans_page", { p_community: communityId }, { key: "user_id", enabled: bansOpen && !!info?.is_member });
  const { items: bans, setItems: setBans } = bansPage;
  const [linkNote, setLinkNote] = useState<string | null>(null);

  const isMember = !!info?.is_member;
  const myRole = info?.my_role || null;
  const isMod = myRole === "owner" || myRole === "moderator";
  const band = COMM_COLORS[info?.cover_color || "sky"] || COMM_COLORS.sky;

  const loadInfo = useCallback(async () => {
    const version = infoRequest.current += 1;
    setInfoError(false);
    try {
      const { data, error } = await withTimeout(supabase.rpc("get_community", { p_community: communityId }));
      if (error) throw error;
      if (version !== infoRequest.current) return;
      const row = Array.isArray(data) ? data[0] : data;
      setInfo((row as Info) ?? null);
    } catch { if (version === infoRequest.current) setInfoError(true); }
    finally { if (version === infoRequest.current) setLoading(false); }
  }, [communityId, supabase]);

  const reloadPosts = postsPage.reload;
  const loadPosts = useCallback(async () => { await reloadPosts(); }, [reloadPosts]);
  const reloadAnnouncements = announcementsPage.reload, reloadSubs = subsPage.reload;
  const loadExtras = useCallback(async () => { await Promise.all([reloadAnnouncements(), reloadSubs()]); }, [reloadAnnouncements, reloadSubs]);

  useEffect(() => {
    let alive = true;
    let uid: string | null | undefined;
    const bind = (next: string | null) => { if (alive && uid !== next) { uid = next; setLoading(true); setMembersOpen(false); setRequestsOpen(false); setBansOpen(false); mutationEpoch.current += 1;actions.current.reset();postLock.current=false;setPosting(false);setAnnDraft("");setSubName("");setSubDesc("");setLinkNote(null);setSettingsOpen(false);setInviteOpen(false);setAnnOpen(false);setSubOpen(false);setMe(next); setInfo(null); setDraft(""); setFile(null); setInviteQ(""); setInviteHits([]); void loadInfo(); } };
    const scopeActions=actions.current;
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    withTimeout(supabase.auth.getSession()).then(({data,error})=>{if(error)throw error;if(uid===undefined)bind(data.session?.user.id??null);}).catch(()=>{if(alive&&uid===undefined){setLoading(false);setInfoError(true);}});
    return () => { alive = false; infoRequest.current += 1;mutationEpoch.current += 1;scopeActions.reset(); auth.subscription.unsubscribe(); };
  }, [supabase, loadInfo]);

  useEffect(() => {
    if (!inviteOpen) return;
    const q = inviteQ.trim().replace(/^@/, "");
    let dead = false;
    const t = window.setTimeout(async () => {
      if (q.length < 2) { if (!dead) setInviteHits([]); return; }
      try {
      const { data, error } = await withTimeout(supabase.rpc("search_people_page", { p_q: q, p_limit: 12, p_offset: 0 }));
      if (!dead) {
        setInviteHits(error ? [] : (data ?? []));
        setLinkNote(error ? "Could not search people. Please try again." : null);
      }
      } catch {if(!dead){setInviteHits([]);setLinkNote("Could not search people. Please try again.");}}
    }, 160);
    return () => { dead = true; window.clearTimeout(t); };
  }, [inviteQ, inviteOpen, supabase]);

  const actionRpc = (name:string,args:Record<string,unknown>) => actions.current.run(name+JSON.stringify(args), async()=>{
    if(!me)throw new Error("Sign in before continuing.");
    return await withTimeout(supabase.rpc(name,args));
  });
  const respondInvite = async (accept: boolean) => {
    const { error, stale } = await actionRpc("respond_community_invite", { p_community: communityId, p_accept: accept });
    if (stale) return;
    if (error) { alert(error.message); return; }
    await loadInfo();
  };
  const openInvite = async () => { setInviteOpen(true); setLinkNote(null); };

  const invitePerson = async (p: DirectoryPerson) => {
    const { error, stale } = await actionRpc("invite_to_community", { p_community: communityId, p_user: p.id });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setInvites(prev => [{ user_id: p.id, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url, invited_by: me, created_at: new Date().toISOString() }, ...prev.filter(x => x.user_id !== p.id)]);
    setInviteQ("");
  };
  const revokeInvite = async (r: CommunityInvite) => {
    const { error, stale } = await actionRpc("revoke_community_invite", { p_community: communityId, p_user: r.user_id });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setInvites(prev => prev.filter(x => x.user_id !== r.user_id));
  };
  const copyInviteLink = async (fresh: boolean) => {
    let token: string | null = null;
    if (!fresh) {
      const { data, error, stale } = await actionRpc("get_community_invite_link", { p_community: communityId });
      if (stale) return;
    if (error) { setLinkNote("Could not read the invite link. Please try again."); return; }
      const row = Array.isArray(data) ? data[0] : data;
      token = row && typeof row === "object" && "token" in row && typeof row.token === "string" ? row.token : null;
    }
    if (!token) {
      const { data, error, stale } = await actionRpc("create_community_invite_link", { p_community: communityId, p_expires_days: 7, p_max_uses: null });
      if (stale) return;
    if (error) { alert(error.message); return; }
      token = String(data);
    }
    const url = window.location.origin + "/communities/join/" + encodeURIComponent(token!);
    try { await navigator.clipboard.writeText(url); setLinkNote("Link copied. It admits anyone for 7 days: " + url); }
    catch { setLinkNote(url); }
  };
  const openChat = async () => {
    const { data, error, stale } = await actionRpc("get_community_conversation", { p_community: communityId });
    if (stale) return;
    if (error || !data) { alert(error?.message || "Could not open the chat"); return; }
    router.push("/messages?c=" + data);
  };
  const postAnnouncement = async () => {
    const body = annDraft.trim(); if (!body) return;
    const { error, stale } = await actionRpc("post_community_announcement", { p_community: communityId, p_body: body });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setAnnDraft(""); setAnnOpen(false); void loadExtras();
  };
  const deleteAnnouncement = async (a: CommunityAnnouncement) => {
    if (!confirm("Remove this announcement?")) return;
    const { error, stale } = await actionRpc("delete_community_announcement", { p_id: a.id });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setAnnouncements(prev => prev.filter(x => x.id !== a.id));
  };
  const createSub = async () => {
    const nm = subName.trim(); if (nm.length < 3) return;
    const { data, error, stale } = await actionRpc("create_sub_community", { p_parent: communityId, p_name: nm, p_description: subDesc.trim() || null, p_join_mode: subMode, p_cover_color: info?.cover_color || "sky" });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setSubOpen(false); setSubName(""); setSubDesc(""); setSubMode("open");
    router.push("/communities/" + data);
  };
  const applyStatus = async (m: CommunityMember, status: "active" | "limited") => {
    const { error, stale } = await actionRpc("set_community_member_status", { p_community: communityId, p_user: m.user_id, p_status: status });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, status } : x));
  };
  const removeMember = async (m: CommunityMember, ban: boolean) => {
    if (!confirm(ban ? "Remove and block from rejoining?" : "Remove from the community?")) return;
    const { error, stale } = await actionRpc("remove_community_member", { p_community: communityId, p_user: m.user_id, p_ban: ban, p_reason: null });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    await loadInfo();
  };
  const memberAction = (m: CommunityMember, v: string) => {
    if (v === "moderator" || v === "member") void applyRole(m, v);
    else if (v === "limit") void applyStatus(m, "limited");
    else if (v === "unlimit") void applyStatus(m, "active");
    else if (v === "remove") void removeMember(m, false);
    else if (v === "ban") void removeMember(m, true);
  };
  const openBans = async () => { setBansOpen(true); };

  const unban = async (b: CommunityBan) => {
    const { error, stale } = await actionRpc("unban_community_member", { p_community: communityId, p_user: b.user_id });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setBans(prev => prev.filter(x => x.user_id !== b.user_id));
  };

  const join = async () => {
    const { error, stale } = await actionRpc("join_community", { p_community: communityId });
    if (stale) return;
    if (error) { alert(error.message); return; }
    await loadInfo();
  };

  const cancelRequest = async () => {
    const { error, stale } = await actionRpc("cancel_join_request", { p_community: communityId });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setInfo(p => p ? { ...p, has_pending: false } : p);
  };

  const leave = async () => {
    if (!confirm("Leave this community?")) return;
    const { error, stale } = await actionRpc("leave_community", { p_community: communityId });
    if (stale) return;
    if (error) { alert(error.message); return; }
    await loadInfo();
    setPosts(() => []);
  };

  const submitPost = async () => {
    const body = draft.trim();
    if ((!body && !file) || postLock.current || !me) return;
    postLock.current = true; setPosting(true);
    const version = mutationEpoch.current;
    try {
      let mediaUrl: string | null = null;
      if (file) {
        if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.size > 20 * 1024 * 1024) throw new Error("Choose a photo smaller than 20 MB.");
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
        const path = me + "/community_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
        const up = await supabase.storage.from("post-media").upload(path, file, { contentType: file.type || "image/jpeg" });
        if (up.error) throw up.error;
        mediaUrl = supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
      }
      if (version !== mutationEpoch.current) return;
      const { error } = await supabase.from("posts")
        .insert({ user_id: me, content: body || null, media_url: mediaUrl, community_id: communityId })
        .select("id, created_at").single();
      if (error) throw error;
      if (version !== mutationEpoch.current) return;
      setDraft(""); setFile(null);
      await loadPosts();
    } catch (err: unknown) { if(version===mutationEpoch.current)alert(errorMessage(err, "Could not post.")); }
    finally { if(version===mutationEpoch.current){postLock.current = false; setPosting(false);} }
  };

  const pin = async (p: CommunityPost) => {
    const { error, stale } = await actionRpc("pin_community_post", { p_post: p.post_id, p_pin: !p.is_pinned });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setMenuFor(null);
    await loadPosts();
  };

  const removePost = async (p: CommunityPost) => {
    const own = p.author_id === me;
    if (!confirm(own ? "Delete this post?" : "Remove this post from the community?")) return;
    const r = await actions.current.run('remove:'+p.post_id,()=>withTimeout(own
      ? supabase.from("posts").delete().eq("id",p.post_id)
      : supabase.rpc("remove_community_post",{p_post:p.post_id})));
    if(r.stale)return;
    if (r.error) { alert(r.error.message); return; }
    setMenuFor(null);
    setPosts(prev => prev.filter(x => x.post_id !== p.post_id));
  };

  const openMembers = async () => { setMembersOpen(true); };

  const applyRole = async (m: CommunityMember, role: string) => {
    const { error, stale } = await actionRpc("set_community_role", { p_community: communityId, p_user: m.user_id, p_role: role });
    if (stale) return;
    if (error) { alert(error.message); return; }
    if (role === "remove") setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    else setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role } : x));
  };

  const openRequests = async () => { setRequestsOpen(true); };

  const resolveReq = async (r: CommunityRequest, approve: boolean) => {
    const { error, stale } = await actionRpc("resolve_join_request", { p_community: communityId, p_user: r.user_id, p_approve: approve });
    if (stale) return;
    if (error) { alert(error.message); return; }
    setRequests(prev => prev.filter(x => x.user_id !== r.user_id));
    await loadInfo();
  };

  const catLabel = info?.category ? (CATEGORIES.find(c => c.key === info.category)?.label || info.category) : null;

  return (
    <section className={styles.detail}>
      <div className={styles.communityHero} style={{ background: band }}>
        <div className={styles.heroTop}>
          <Link href="/communities"><ArrowLeft size={16} aria-hidden />Communities</Link>
          <nav aria-label="Community actions">
            {isMember && info?.join_mode === 'approval' && isMod ? <button onClick={openRequests}><Inbox size={16} aria-hidden />Requests</button> : null}
            {isMember ? <button onClick={openChat}><MessageCircle size={16} aria-hidden />Open chat</button> : null}
            {isMember && isMod ? <button onClick={openInvite}><UserPlus size={16} aria-hidden />Invite</button> : null}
            {myRole === 'owner' ? <button onClick={() => setSettingsOpen(true)}><Settings2 size={16} aria-hidden />Settings</button> : isMember ? <button onClick={leave}><LogOut size={16} aria-hidden />Leave</button> : null}
          </nav>
        </div>
        <div className={styles.heroIdentity}>
          {info?.icon_url ? (

            <NextImage unoptimized width={80} height={80} src={info.icon_url} alt="" className={styles.heroAvatar} />
          ) : (
            <span className={styles.heroAvatar}><Users size={22} /></span>
          )}
          <div className="min-w-0 flex-1">
            <h1>{info?.name || "Community"}</h1>
            <p className="text-[12.5px] text-[#1F2937]/70">
              {String(info?.member_count || 0)} {info?.member_count === 1 ? "member" : "members"}{catLabel ? " · " + catLabel : ""}
            </p>
            {info?.parent_id ? <Link href={"/communities/" + info.parent_id} className="text-[12px] font-semibold text-[#1F2937]/70 hover:underline">Part of {info.parent_name}</Link> : null}
          </div>
          {info && !isMember ? (
            info.has_invite ? (
              <span className="flex gap-1.5">
                <button onClick={() => respondInvite(true)} className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-bold text-white">Accept</button>
                <button onClick={() => respondInvite(false)} className="rounded-full bg-[#FFFFFF]/70 px-3.5 py-1.5 text-[12.5px] font-bold text-[#1F2937]">Decline</button>
              </span>
            ) : info.is_banned ? (
              <span className="rounded-full bg-[#FFFFFF]/70 px-3 py-1.5 text-[12px] font-bold text-[#1F2937]/70">Removed</span>
            ) : info.has_pending ? (
              <button onClick={cancelRequest} className="rounded-full bg-[#FFFFFF]/70 px-3.5 py-1.5 text-[12.5px] font-bold text-[#1F2937]">Requested</button>
            ) : info.join_mode === "invite" ? (
              <span className="rounded-full bg-[#FFFFFF]/70 px-3 py-1.5 text-[12px] font-bold text-[#1F2937]/70">Invite only</span>
            ) : me ? (
              <button onClick={join} className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-bold text-white">{info.join_mode === "approval" ? "Request" : "Join"}</button>
            ) : null
          ) : null}
        </div>
        {info?.description ? <p className={styles.heroDescription}>{info.description}</p> : null}
      </div>

      <nav className={styles.tabs} aria-label="Community sections"><a href="#community-discussion" aria-current="page">Discussions</a>{isMember ? <button onClick={openMembers}><Users size={16} aria-hidden />Members</button> : null}<a href="#community-about">About</a></nav>
      <div className={styles.discussion}><section id="community-discussion" aria-label="Community discussions">
      {infoError ? <ErrorState title="Could not load this community" onRetry={() => void loadInfo()} /> : null}
      {!loading && !info && !infoError ? <p className="py-8 text-center text-sm text-muted">This community is unavailable.</p> : null}
      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading&hellip;</p>
      ) : !isMember ? (
        <p className="py-16 text-center text-sm text-muted">{info?.has_invite ? "Accept the invitation above to see the posts." : info?.is_banned ? "You were removed from this community." : info?.join_mode === "invite" ? "Ask a moderator for an invite to see the posts." : "Join to see and share posts inside this community."}</p>
      ) : (
        <div className="mt-3">
          {(announcements.length > 0 || isMod) ? (
            <div className="mb-3 rounded-2xl border border-ink/15 bg-[#C9BFB0]/15 p-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink">
                <Megaphone size={13} /> Announcements
                <span className="flex-1" />
                {isMod ? <button onClick={() => setAnnOpen(o => !o)} className="rounded-full p-1 text-ink hover:bg-black/5" aria-label="Post an announcement"><Plus size={15} /></button> : null}
              </div>
              {annOpen ? (
                <div className="mt-2 flex gap-2">
                  <input value={annDraft} onChange={e => setAnnDraft(e.target.value)} maxLength={2000} aria-label="Announcement" placeholder="What should everyone know?" onKeyDown={e => { if (e.key === "Enter") void postAnnouncement(); }}
                    className="w-full rounded-full bg-white px-4 py-2 text-[13.5px] text-ink outline-none placeholder:text-muted" />
                  <button onClick={postAnnouncement} disabled={!annDraft.trim()} className="rounded-full bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-30">Post</button>
                </div>
              ) : null}
              {announcements.length === 0 ? <p className="mt-1 text-[12.5px] text-ink/60">Nothing announced yet. Only moderators post here; every member sees it.</p> : announcements.map((a) => (
                <div key={a.id} className="group mt-2">
                  <p className="whitespace-pre-wrap text-[13px] text-ink">{a.body}</p>
                  <p className="text-[11.5px] text-muted">{(a.full_name || a.username || "Moderator")}{isMod ? <button onClick={() => deleteAnnouncement(a)} className="ml-2 hidden text-danger group-hover:inline">Remove</button> : null}</p>
                </div>
              ))}
              <SocialPageFooter {...announcementsPage} />
            </div>
          ) : null}
          {announcementsPage.error && announcements.length === 0 && !isMod ? <SocialPageFooter {...announcementsPage} /> : null}
          {(subs.length > 0 || isMod) ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {subs.map((s) => (
                <Link key={s.id} href={"/communities/" + s.id} className="flex items-center gap-1 rounded-full border border-ink/20 bg-white px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-black/[0.03]">
                  <Hash size={12} /> {s.name}{s.join_mode === "invite" && !s.is_member ? <span className="text-muted"> · invite only</span> : null}
                </Link>
              ))}
              {isMod ? (
                <button onClick={() => setSubOpen(o => !o)} className="flex items-center gap-1 rounded-full border border-dashed border-ink/30 px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-black/[0.03]"><Plus size={12} /> Sub-group</button>
              ) : null}
            </div>
          ) : null}
          <SocialPageFooter {...subsPage} />
          {subOpen ? (
            <div className="mb-3 rounded-2xl border border-ink/10 p-3">
              <p className="mb-2 text-[12.5px] text-ink/60">A sub-group lives inside {info?.name}. Only its members can join, and leaving {info?.name} leaves the sub-group too.</p>
              <input value={subName} onChange={e => setSubName(e.target.value)} maxLength={60} placeholder="Name" className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
              <input value={subDesc} onChange={e => setSubDesc(e.target.value)} maxLength={300} placeholder="What is it for?" className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
              <div className="mb-2 flex gap-2">
                {(["open", "approval", "invite"] as const).map(k => (
                  <button key={k} onClick={() => setSubMode(k)} className={"flex-1 rounded-lg border px-2 py-2 text-[12.5px] font-semibold " + (subMode === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>{k === "open" ? "Open" : k === "approval" ? "Approval" : "Invite only"}</button>
                ))}
              </div>
              <button onClick={createSub} disabled={subName.trim().length < 3} className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">Create sub-group</button>
            </div>
          ) : null}
          {info?.my_status === "limited" ? (
            <p className="mb-3 rounded-2xl border border-ink/10 px-3 py-2.5 text-center text-[13px] font-semibold text-muted">You can view this community but not post in it</p>
          ) : (
          <div className="mb-3 rounded-2xl border border-ink/10 p-3">
            {file ? (
              <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink/60">
                <ImageIcon size={13} /> {file.name}
                <button onClick={() => setFile(null)} className="text-muted hover:text-ink" aria-label="Remove attachment"><X size={13} /></button>
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <button onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-muted hover:bg-black/5" aria-label="Attach a photo"><ImageIcon size={18} /></button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void submitPost(); }}
                aria-label="Community post" placeholder="Share with the community"
                className="w-full rounded-full bg-ink/5 px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted" />
              <button onClick={submitPost} disabled={(!draft.trim() && !file) || posting} className="rounded-full bg-ink p-2.5 text-white disabled:opacity-30" aria-label="Post"><Send size={15} /></button>
            </div>
          </div>
          )}
          {postsPage.loading && posts.length === 0 ? <p className="py-6 text-center text-sm text-muted">Loading posts…</p> : null}
          {posts.length === 0 && !postsPage.loading && !postsPage.error ? (
            <p className="py-12 text-center text-sm text-muted">Quiet in here. Be the first to post.</p>
          ) : (
            posts.map(p => (
              <div key={p.post_id} className="relative mb-1">
                {(p.is_pinned || isMod || p.author_id === me) ? (
                  <div className="flex items-center justify-between px-1 pt-2">
                    <span className="text-[11px] font-extrabold text-ink">{p.is_pinned ? "Pinned" : ""}</span>
                    {(isMod || p.author_id === me) ? (
                      <button onClick={() => setMenuFor(menuFor === p.post_id ? null : p.post_id)} className="rounded-full p-1 text-muted hover:bg-black/5" aria-label="Post actions"><MoreHorizontal size={15} /></button>
                    ) : null}
                  </div>
                ) : null}
                {menuFor === p.post_id ? (
                  <div className="absolute right-1 top-8 z-10 w-44 rounded-xl border border-ink/10 bg-white p-1 shadow-lg">
                    {isMod ? (
                      <button onClick={() => pin(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-black/5">{p.is_pinned ? "Unpin from top" : "Pin to top"}</button>
                    ) : null}
                    <button onClick={() => removePost(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-danger hover:bg-black/5">{p.author_id === me ? "Delete post" : "Remove post"}</button>
                  </div>
                ) : null}
                <PostCard post={p} />
              </div>
            ))
          )}
          <SocialPageFooter {...postsPage} />
        </div>
      )}

      </section><aside id="community-about" className={styles.aside} aria-label="About this community"><section><h2>About this community</h2><p>{info?.description || 'A space for members to share and connect.'}</p><div className={styles.meta}><Users size={15} aria-hidden />{info ? `${info.member_count.toLocaleString()} members` : 'Community information unavailable'}</div>{info ? <div className={styles.meta}><Shield size={15} aria-hidden />{info.join_mode === 'invite' ? 'Invitation required' : info.join_mode === 'approval' ? 'Membership requires approval' : 'Open membership'}</div> : null}{catLabel ? <div className={styles.meta}>{catLabel}</div> : null}</section>{info?.rules ? <section><h2>Community rules</h2><p>{info.rules}</p></section> : null}{isMod ? <section><h2>Moderation</h2><p>Review membership and keep conversations welcoming. Actions are checked against your current community role.</p><button className={styles.button} onClick={openMembers} style={{ marginTop: 14 }}>Manage members</button></section> : null}</aside></div>

      {membersOpen ? (
        <ProductDialog open title="Members" onClose={() => setMembersOpen(false)}>
          {isMod ? <button onClick={openBans} className={styles.button} style={{ marginBottom: 16 }}>Blocked members</button> : null}
{members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 py-1.5">
                {m.avatar_url ? (

                  <NextImage unoptimized width={32} height={32} src={displayImageUrl(m.avatar_url, 200) ?? m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(m.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={m.full_name || "Member"} userId={m.user_id} badgeSize={12} />{m.user_id === me ? " (you)" : ""}</span>
                  {m.username ? <span className="block text-[12px] text-muted">@{m.username}</span> : null}
                </span>
                {m.status === "limited" ? <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10.5px] font-bold text-muted">Limited</span> : null}
                {m.role !== "member" ? <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10.5px] font-bold text-ink">{m.role === "owner" ? "Owner" : "Moderator"}</span> : null}
                {isMod && m.role !== "owner" && m.user_id !== me && (m.role !== "moderator" || myRole === "owner") ? (
                  <select value="" onChange={e => { memberAction(m, e.target.value); e.target.value = ""; }} aria-label="Member actions"
                    className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-[12px] text-ink outline-none">
                    <option value="" disabled>Manage</option>
                    {myRole === "owner" ? <option value={m.role === "moderator" ? "member" : "moderator"}>{m.role === "moderator" ? "Make member" : "Make moderator"}</option> : null}
                    <option value={m.status === "limited" ? "unlimit" : "limit"}>{m.status === "limited" ? "Allow posting again" : "Limit to viewing only"}</option>
                    <option value="remove">Remove from community</option>
                    <option value="ban">Remove and block from rejoining</option>
                  </select>
                ) : null}
              </div>
            ))}
            <SocialPageFooter {...membersPage} />
        </ProductDialog>
      ) : null}

      {requestsOpen ? (
        <ProductDialog open title="Join requests" onClose={() => setRequestsOpen(false)}>
          {requests.length === 0 ? <p className="py-8 text-center text-sm text-muted">No pending requests.</p> : requests.map(r => (
              <div key={r.user_id} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? (

                  <NextImage unoptimized width={32} height={32} src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={r.full_name || "Member"} userId={r.user_id} badgeSize={12} /></span>
                  {r.username ? <span className="block text-[12px] text-muted">@{r.username}</span> : null}
                </span>
                <button onClick={() => resolveReq(r, true)} className="rounded-full bg-ink p-1.5 text-white" aria-label="Approve"><Check size={14} /></button>
                <button onClick={() => resolveReq(r, false)} className="rounded-full bg-ink/5 p-1.5 text-ink/60" aria-label="Deny"><X size={14} /></button>
              </div>
            ))}
            <SocialPageFooter {...requestsPage} />
        </ProductDialog>
      ) : null}

      {inviteOpen ? (
        <ProductDialog open title="Invite people" onClose={() => setInviteOpen(false)}>
          <p className="mb-2 text-[12.5px] text-ink/60">An invitation always admits, even when the community is invite only.</p>
            <div className="mb-3 flex gap-2">
              <button onClick={() => copyInviteLink(false)} className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white"><Link2 size={13} /> Copy invite link</button>
              <button onClick={() => copyInviteLink(true)} className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:text-ink">New link</button>
            </div>
            {linkNote ? <p className="mb-3 break-all rounded-lg bg-ink/5 px-3 py-2 text-[12px] text-ink/70">{linkNote}</p> : null}
            <input value={inviteQ} onChange={e => setInviteQ(e.target.value)} aria-label="Search people to invite" placeholder="Search people" autoFocus
              className="mb-2 w-full rounded-full bg-ink/5 px-4 py-2 text-[13.5px] text-ink outline-none placeholder:text-muted" />
            {inviteHits.filter(h => h.id !== me && !invites.some(i => i.user_id === h.id)).map(h => (
              <div key={h.id} className="flex items-center gap-2 py-1.5">
                {h.avatar_url ? (

                  <NextImage unoptimized width={32} height={32} src={displayImageUrl(h.avatar_url, 200) ?? h.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(h.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={h.full_name || "Member"} userId={h.id} badgeSize={12} /></span>
                  {h.username ? <span className="block text-[12px] text-muted">@{h.username}</span> : null}
                </span>
                <button onClick={() => invitePerson(h)} className="rounded-full bg-ink px-3 py-1 text-[12px] font-bold text-white">Invite</button>
              </div>
            ))}
            {invites.length > 0 ? <p className="mb-1 mt-3 text-[12px] font-bold uppercase tracking-wide text-muted">Pending</p> : null}
            {invites.map(r => (
              <div key={r.user_id} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? (

                  <NextImage unoptimized width={32} height={32} src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={r.full_name || "Member"} userId={r.user_id} badgeSize={12} /></span>
                  {r.username ? <span className="block text-[12px] text-muted">@{r.username}</span> : null}
                </span>
                <button onClick={() => revokeInvite(r)} className="rounded-full p-1.5 text-muted hover:bg-black/5" aria-label="Withdraw invitation"><X size={14} /></button>
              </div>
            ))}
            <SocialPageFooter {...invitesPage} />
        </ProductDialog>
      ) : null}

      {bansOpen ? (
        <ProductDialog open title="Blocked from rejoining" onClose={() => setBansOpen(false)}>
          {bans.length === 0 ? <p className="py-8 text-center text-sm text-muted">No one is blocked.</p> : bans.map(b => (
              <div key={b.user_id} className="flex items-center gap-2 py-1.5">
                {b.avatar_url ? (

                  <NextImage unoptimized width={32} height={32} src={displayImageUrl(b.avatar_url, 200) ?? b.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white">{(b.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={b.full_name || "Member"} userId={b.user_id} badgeSize={12} /></span>
                  {b.username ? <span className="block text-[12px] text-muted">@{b.username}</span> : null}
                </span>
                <button onClick={() => unban(b)} className="rounded-full bg-ink/5 px-3 py-1 text-[12px] font-bold text-ink">Allow back</button>
              </div>
            ))}
            <SocialPageFooter {...bansPage} />
        </ProductDialog>
      ) : null}

      {settingsOpen && info ? (
        <CommunitySettings info={info} meId={me} onClose={() => setSettingsOpen(false)}
          onSaved={async () => { setSettingsOpen(false); await loadInfo(); }} />
      ) : null}
    </section>
  );
}

function CommunitySettings({ info, meId, onClose, onSaved }: { info: Info; meId: string | null; onClose: () => void; onSaved: () => void }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [eName, setEName] = useState(info.name || '');
  const [eDesc, setEDesc] = useState(info.description || '');
  const [eRules, setERules] = useState(info.rules || '');
  const [eMode, setEMode] = useState(info.join_mode || 'open');
  const [eColor, setEColor] = useState(info.cover_color || 'sky');
  const [eCat, setECat] = useState<string | null>(info.category || null);
  const [photo, setPhoto] = useState<{ file: File; path: string; url: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const iconRef = useRef<HTMLInputElement | null>(null);
  const live = useRef(false), locked = useRef(false), imageGeneration = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; imageGeneration.current += 1; }; }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  const dirty = !!photo || eName !== (info.name || '') || eDesc !== (info.description || '') || eRules !== (info.rules || '') || eMode !== (info.join_mode || 'open') || eColor !== (info.cover_color || 'sky') || eCat !== (info.category || null);
  const close = () => { if (!saving && !checking && (!dirty || window.confirm('Discard these unsaved community changes?'))) onClose(); };
  const verifyOwner = async () => {
    const { data, error: cause } = await withTimeout(supabase.auth.getUser());
    if (!live.current || cause || !meId || data.user?.id !== meId) throw new Error('Your account changed. Reopen community settings before saving.');
  };
  const onPickIcon = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !meId || locked.current) return;
    const generation = imageGeneration.current += 1; setChecking(true); setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP photo under 10 MB.');
      const issue = await checkUploadableBytes(file); if (issue) throw new Error(issue);
      if (!live.current || generation !== imageGeneration.current) return;
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      setPhoto({ file, path: `${meId}/community_${info.id}_${crypto.randomUUID()}.${ext}`, url: URL.createObjectURL(file) });
    } catch (cause) { if (live.current && generation === imageGeneration.current) setError(cause instanceof Error ? cause.message : 'This photo could not be opened.'); }
    finally { if (live.current && generation === imageGeneration.current) setChecking(false); }
  };
  const save = async () => {
    if (locked.current || checking || !eName.trim() || !dirty) return;
    locked.current = true; setSaving(true); setError('');
    try {
      await verifyOwner();
      let iconUrl = info.icon_url;
      if (photo) {
        const result = await withTimeout(supabase.storage.from('avatars').upload(photo.path, photo.file, { contentType: photo.file.type, upsert: true }), 45000);
        if (!live.current) return;
        if (result.error) throw new Error('The community photo could not upload. Your changes are still here; try again.');
        iconUrl = supabase.storage.from('avatars').getPublicUrl(photo.path).data.publicUrl;
      }
      await verifyOwner();
      const { error: cause } = await withTimeout(supabase.rpc('update_community_settings', { p_community: info.id, p_name: eName.trim(), p_description: eDesc.trim() || null, p_category: eCat, p_join_mode: eMode, p_cover_color: eColor, p_rules: eRules.trim() || null, ...(photo ? { p_icon_url: iconUrl } : {}) }));
      if (cause) throw new Error('Your changes could not be confirmed. Keep this window open and retry.');
      if (live.current) onSaved();
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : 'Your changes could not be confirmed.'); }
    finally { locked.current = false; if (live.current) setSaving(false); }
  };
  const remove = async () => {
    if (locked.current || checking || !window.confirm('Delete this community? Members lose access, the posts stop showing and the chat closes. This cannot be undone.')) return;
    locked.current = true; setSaving(true); setError('');
    try {
      await verifyOwner();
      const { error: cause } = await withTimeout(supabase.rpc('delete_community', { p_community: info.id }));
      if (cause) throw new Error('Community deletion was not confirmed. Refresh before trying again.');
      if (live.current) router.replace('/communities');
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : 'Community deletion was not confirmed.'); }
    finally { locked.current = false; if (live.current) setSaving(false); }
  };
  return <ProductDialog open title="Community settings" description="Manage your community identity and membership. Changes are applied when you save." busy={saving || checking} onClose={close}>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="flex items-center gap-4"><button type="button" disabled={saving || checking} onClick={() => iconRef.current?.click()} className={styles.heroAvatar} aria-label="Change community photo">{photo?.url || info.icon_url ? <NextImage unoptimized width={320} height={320} src={photo?.url || info.icon_url!} alt="Community photo preview" className="h-full w-full rounded-2xl object-cover" /> : <Camera size={26} aria-hidden />}</button><div><strong className="text-sm">Community photo</strong><p className={styles.hint}>JPG, PNG or WebP · up to 10 MB.<br />Preview first, then save your changes.</p></div><input ref={iconRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickIcon} className="sr-only" tabIndex={-1} aria-label="Community photo file" /></div>
      <label>Community name<input autoFocus required disabled={saving || checking} value={eName} maxLength={60} onChange={event => setEName(event.target.value)} /></label>
      <label>Description<textarea disabled={saving || checking} value={eDesc} maxLength={200} onChange={event => setEDesc(event.target.value)} /></label>
      <label>Who can join<select disabled={saving || checking} value={eMode} onChange={event => setEMode(event.target.value)}><option value="open">Open to everyone</option><option value="approval">Approval required</option><option value="invite">Invite only</option></select></label>
      <label>Category<select disabled={saving || checking} value={eCat ?? ''} onChange={event => setECat(event.target.value || null)}><option value="">No category</option>{CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
      <fieldset disabled={saving || checking}><legend>Cover color</legend><div className={styles.colors}>{Object.entries(COMM_COLORS).map(([key, color]) => <button type="button" key={key} onClick={() => setEColor(key)} aria-label={`${key} cover`} aria-pressed={eColor === key} style={{ background: color }}>{eColor === key ? <Check size={18} aria-hidden /> : null}</button>)}</div></fieldset>
      <label>Community rules<textarea disabled={saving || checking} value={eRules} onChange={event => setERules(event.target.value)} maxLength={600} /></label>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <footer className={styles.footer}><button type="button" className={styles.button} disabled={saving || checking} onClick={close}>Cancel</button><button type="submit" className={styles.primary} disabled={saving || checking || !eName.trim() || !dirty}>{saving ? 'Saving…' : checking ? 'Checking photo…' : 'Save changes'}</button></footer>
      <button type="button" disabled={saving || checking} className="min-h-11 rounded-lg border border-danger/40 px-4 text-sm text-danger disabled:opacity-50" onClick={() => void remove()}>Delete community</button>
    </form>
  </ProductDialog>;
}
