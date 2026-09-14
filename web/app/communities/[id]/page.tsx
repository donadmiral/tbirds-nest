"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Camera, Check, Hash, Image as ImageIcon, Inbox, Link2, LogOut, MessageCircle, Megaphone, MoreHorizontal, Plus, Send, Settings2, Shield, UserPlus, Users, X } from "lucide-react";
import { PersonName } from "@/components/PersonName";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";

type Info = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; rules: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
  has_invite?: boolean; my_status?: string | null; is_banned?: boolean; parent_id?: string | null; parent_name?: string | null;
};

export default function CommunityPage() {
  const supabase = useRef(createClient()).current;
  const params = useParams<{ id: string }>();
  const communityId = String(params.id || "");
  const [me, setMe] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Membership machine: invitations, announcements, sub-groups, limited and removed members.
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQ, setInviteQ] = useState("");
  const [inviteHits, setInviteHits] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [annDraft, setAnnDraft] = useState("");
  const [annOpen, setAnnOpen] = useState(false);
  const [subs, setSubs] = useState<any[]>([]);
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState("");
  const [subDesc, setSubDesc] = useState("");
  const [subMode, setSubMode] = useState<"open" | "approval" | "invite">("open");
  const [bans, setBans] = useState<any[]>([]);
  const [bansOpen, setBansOpen] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  const isMember = !!info?.is_member;
  const myRole = info?.my_role || null;
  const isMod = myRole === "owner" || myRole === "moderator";
  const band = COMM_COLORS[info?.cover_color || "sky"] || COMM_COLORS.sky;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [supabase]);

  const loadInfo = useCallback(async () => {
    const { data } = await supabase.rpc("get_community", { p_community: communityId });
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setInfo(row as Info);
  }, [communityId, supabase]);

  const loadPosts = useCallback(async (cursor?: string | null) => {
    const { data, error } = await supabase.rpc("get_community_posts", { p_community: communityId, p_cursor: cursor ?? null, p_limit: 25 });
    if (error) return;
    const rows = (data as any[]) ?? [];
    if (cursor) {
      setPosts(prev => {
        const seen = new Set(prev.map(p => p.post_id));
        return [...prev, ...rows.filter(r => !seen.has(r.post_id))];
      });
    } else setPosts(rows);
  }, [communityId, supabase]);

  useEffect(() => {
    (async () => { await loadInfo(); setLoading(false); })();
  }, [loadInfo]);

  useEffect(() => { if (isMember) void loadPosts(null); }, [isMember, loadPosts]);

  const loadExtras = useCallback(async () => {
    const [{ data: an }, { data: sb }] = await Promise.all([
      supabase.rpc("get_community_announcements", { p_community: communityId, p_limit: 20 }),
      supabase.rpc("get_sub_communities", { p_community: communityId, p_limit: 30 }),
    ]);
    setAnnouncements((an as any[]) ?? []); setSubs((sb as any[]) ?? []);
  }, [communityId, supabase]);
  useEffect(() => { if (isMember) void loadExtras(); }, [isMember, loadExtras]);

  useEffect(() => {
    if (!inviteOpen) return;
    const q = inviteQ.trim().replace(/^@/, "");
    let dead = false;
    const t = window.setTimeout(async () => {
      const base = supabase.from("profiles").select("id, full_name, username, avatar_url").limit(12);
      const { data } = q ? await base.or("username.ilike." + q + "%,full_name.ilike.%" + q + "%") : await base.order("last_seen", { ascending: false });
      if (!dead) setInviteHits((data as any[]) ?? []);
    }, 160);
    return () => { dead = true; window.clearTimeout(t); };
  }, [inviteQ, inviteOpen, supabase]);

  const respondInvite = async (accept: boolean) => {
    const { data, error } = await supabase.rpc("respond_community_invite", { p_community: communityId, p_accept: accept });
    if (error) { alert(error.message); return; }
    if (data === "joined") setInfo(p => p ? { ...p, is_member: true, my_role: p.my_role || "member", my_status: "active", has_invite: false, member_count: (p.member_count || 0) + 1 } : p);
    else setInfo(p => p ? { ...p, has_invite: false } : p);
  };
  const openInvite = async () => {
    setInviteOpen(true); setLinkNote(null);
    const { data } = await supabase.rpc("get_community_invites", { p_community: communityId, p_limit: 60 });
    setInvites((data as any[]) ?? []);
  };
  const invitePerson = async (p: any) => {
    const { error } = await supabase.rpc("invite_to_community", { p_community: communityId, p_user: p.id });
    if (error) { alert(error.message); return; }
    setInvites(prev => [{ user_id: p.id, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url, created_at: new Date().toISOString() }, ...prev.filter(x => x.user_id !== p.id)]);
    setInviteQ("");
  };
  const revokeInvite = async (r: any) => {
    const { error } = await supabase.rpc("revoke_community_invite", { p_community: communityId, p_user: r.user_id });
    if (error) { alert(error.message); return; }
    setInvites(prev => prev.filter(x => x.user_id !== r.user_id));
  };
  const copyInviteLink = async (fresh: boolean) => {
    let token: string | null = null;
    if (!fresh) {
      const { data } = await supabase.rpc("get_community_invite_link", { p_community: communityId });
      const row = Array.isArray(data) ? data[0] : data;
      token = (row as any)?.token || null;
    }
    if (!token) {
      const { data, error } = await supabase.rpc("create_community_invite_link", { p_community: communityId, p_expires_days: 7, p_max_uses: null });
      if (error) { alert(error.message); return; }
      token = String(data);
    }
    const url = "https://platinumcircles.app/communities/join/" + token;
    try { await navigator.clipboard.writeText(url); setLinkNote("Link copied. It admits anyone for 7 days: " + url); }
    catch { setLinkNote(url); }
  };
  const openChat = async () => {
    const { data, error } = await supabase.rpc("get_community_conversation", { p_community: communityId });
    if (error || !data) { alert(error?.message || "Could not open the chat"); return; }
    router.push("/messages?c=" + data);
  };
  const postAnnouncement = async () => {
    const body = annDraft.trim(); if (!body) return;
    const { error } = await supabase.rpc("post_community_announcement", { p_community: communityId, p_body: body });
    if (error) { alert(error.message); return; }
    setAnnDraft(""); setAnnOpen(false); void loadExtras();
  };
  const deleteAnnouncement = async (a: any) => {
    if (!confirm("Remove this announcement?")) return;
    await supabase.rpc("delete_community_announcement", { p_id: a.id });
    setAnnouncements(prev => prev.filter(x => x.id !== a.id));
  };
  const createSub = async () => {
    const nm = subName.trim(); if (nm.length < 3) return;
    const { data, error } = await supabase.rpc("create_sub_community", { p_parent: communityId, p_name: nm, p_description: subDesc.trim() || null, p_join_mode: subMode, p_cover_color: info?.cover_color || "sky" });
    if (error) { alert(error.message); return; }
    setSubOpen(false); setSubName(""); setSubDesc(""); setSubMode("open");
    router.push("/communities/" + data);
  };
  const applyStatus = async (m: any, status: "active" | "limited") => {
    const { error } = await supabase.rpc("set_community_member_status", { p_community: communityId, p_user: m.user_id, p_status: status });
    if (error) { alert(error.message); return; }
    setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, status } : x));
  };
  const removeMember = async (m: any, ban: boolean) => {
    if (!confirm(ban ? "Remove and block from rejoining?" : "Remove from the community?")) return;
    const { error } = await supabase.rpc("remove_community_member", { p_community: communityId, p_user: m.user_id, p_ban: ban, p_reason: null });
    if (error) { alert(error.message); return; }
    setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    setInfo(p => p ? { ...p, member_count: Math.max((p.member_count || 1) - 1, 0) } : p);
  };
  const memberAction = (m: any, v: string) => {
    if (v === "moderator" || v === "member") void applyRole(m, v);
    else if (v === "limit") void applyStatus(m, "limited");
    else if (v === "unlimit") void applyStatus(m, "active");
    else if (v === "remove") void removeMember(m, false);
    else if (v === "ban") void removeMember(m, true);
  };
  const openBans = async () => {
    setBansOpen(true);
    const { data } = await supabase.rpc("get_community_bans", { p_community: communityId, p_limit: 60 });
    setBans((data as any[]) ?? []);
  };
  const unban = async (b: any) => {
    const { error } = await supabase.rpc("unban_community_member", { p_community: communityId, p_user: b.user_id });
    if (error) { alert(error.message); return; }
    setBans(prev => prev.filter(x => x.user_id !== b.user_id));
  };

  const join = async () => {
    const { data, error } = await supabase.rpc("join_community", { p_community: communityId });
    if (error) { alert(error.message); return; }
    if (data === "joined") setInfo(p => p ? { ...p, is_member: true, my_role: p.my_role || "member", member_count: (p.member_count || 0) + 1 } : p);
    else setInfo(p => p ? { ...p, has_pending: true } : p);
  };

  const cancelRequest = async () => {
    await supabase.rpc("cancel_join_request", { p_community: communityId });
    setInfo(p => p ? { ...p, has_pending: false } : p);
  };

  const leave = async () => {
    if (!confirm("Leave this community?")) return;
    const { error } = await supabase.rpc("leave_community", { p_community: communityId });
    if (error) { alert(error.message); return; }
    setInfo(p => p ? { ...p, is_member: false, my_role: null, member_count: Math.max((p.member_count || 1) - 1, 0) } : p);
    setPosts([]);
  };

  const submitPost = async () => {
    const body = draft.trim();
    if ((!body && !file) || posting || !me) return;
    setPosting(true);
    try {
      let mediaUrl: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
        const path = me + "/community_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
        const up = await supabase.storage.from("post-media").upload(path, file, { contentType: file.type || "image/jpeg" });
        if (up.error) throw up.error;
        mediaUrl = supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("posts")
        .insert({ user_id: me, content: body || null, media_url: mediaUrl, community_id: communityId })
        .select("id, created_at").single();
      if (error) throw error;
      setDraft(""); setFile(null);
      await loadPosts(null);
    } catch (err: any) { alert(err?.message || "Could not post."); }
    finally { setPosting(false); }
  };

  const pin = async (p: any) => {
    const { error } = await supabase.rpc("pin_community_post", { p_post: p.post_id, p_pin: !p.is_pinned });
    if (error) { alert(error.message); return; }
    setMenuFor(null);
    await loadPosts(null);
  };

  const removePost = async (p: any) => {
    const own = p.author_id === me;
    if (!confirm(own ? "Delete this post?" : "Remove this post from the community?")) return;
    const r = own
      ? await supabase.from("posts").delete().eq("id", p.post_id)
      : await supabase.rpc("remove_community_post", { p_post: p.post_id });
    if ((r as any).error) { alert((r as any).error.message); return; }
    setMenuFor(null);
    setPosts(prev => prev.filter(x => x.post_id !== p.post_id));
  };

  const openMembers = async () => {
    setMembersOpen(true);
    const { data } = await supabase.rpc("get_community_members", { p_community: communityId, p_limit: 100 });
    setMembers((data as any[]) ?? []);
  };

  const applyRole = async (m: any, role: string) => {
    const { error } = await supabase.rpc("set_community_role", { p_community: communityId, p_user: m.user_id, p_role: role });
    if (error) { alert(error.message); return; }
    if (role === "remove") setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    else setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role } : x));
  };

  const openRequests = async () => {
    setRequestsOpen(true);
    const { data } = await supabase.rpc("get_join_requests", { p_community: communityId, p_limit: 60 });
    setRequests((data as any[]) ?? []);
  };

  const resolveReq = async (r: any, approve: boolean) => {
    const { error } = await supabase.rpc("resolve_join_request", { p_community: communityId, p_user: r.user_id, p_approve: approve });
    if (error) { alert(error.message); return; }
    setRequests(prev => prev.filter(x => x.user_id !== r.user_id));
    if (approve) setInfo(p => p ? { ...p, member_count: (p.member_count || 0) + 1 } : p);
  };

  const catLabel = info?.category ? (CATEGORIES.find(c => c.key === info.category)?.label || info.category) : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 pb-10">
      <div className="-mx-4 px-4 pb-4 pt-3" style={{ background: band }}>
        <div className="flex items-center gap-1">
          <Link href="/communities" className="rounded-full p-1.5 text-[#1F2937] hover:bg-black/10" aria-label="Back"><ArrowLeft size={18} /></Link>
          <span className="flex-1" />
          {isMember && info?.join_mode === "approval" && isMod ? (
            <button onClick={openRequests} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Join requests"><Inbox size={17} /></button>
          ) : null}
          {isMember ? (
            <button onClick={openChat} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Community chat"><MessageCircle size={17} /></button>
          ) : null}
          {isMember && isMod ? (
            <button onClick={openInvite} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Invite people"><UserPlus size={17} /></button>
          ) : null}
          {isMember ? (
            <button onClick={openMembers} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Members"><Users size={17} /></button>
          ) : null}
          {myRole === "owner" ? (
            <button onClick={() => setSettingsOpen(true)} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Settings"><Settings2 size={17} /></button>
          ) : isMember ? (
            <button onClick={leave} className="rounded-full p-2 text-[#1F2937] hover:bg-black/10" title="Leave"><LogOut size={16} /></button>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {info?.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.icon_url} alt="" className="h-[52px] w-[52px] rounded-2xl object-cover" />
          ) : (
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-white/60 text-[#1F2937]"><Users size={22} /></span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-extrabold text-[#1F2937]">{info?.name || "Community"}</h1>
            <p className="text-[12.5px] text-[#1F2937]/70">
              {String(info?.member_count || 0)} {info?.member_count === 1 ? "member" : "members"}{catLabel ? " · " + catLabel : ""}
            </p>
            {info?.parent_id ? <Link href={"/communities/" + info.parent_id} className="text-[12px] font-semibold text-[#1F2937]/70 hover:underline">Part of {info.parent_name}</Link> : null}
          </div>
          {info && !isMember ? (
            info.has_invite ? (
              <span className="flex gap-1.5">
                <button onClick={() => respondInvite(true)} className="rounded-full bg-[#0F1419] px-4 py-1.5 text-[13px] font-bold text-white">Accept</button>
                <button onClick={() => respondInvite(false)} className="rounded-full bg-white/70 px-3.5 py-1.5 text-[12.5px] font-bold text-[#1F2937]">Decline</button>
              </span>
            ) : info.is_banned ? (
              <span className="rounded-full bg-white/70 px-3 py-1.5 text-[12px] font-bold text-[#1F2937]/70">Removed</span>
            ) : info.has_pending ? (
              <button onClick={cancelRequest} className="rounded-full bg-white/70 px-3.5 py-1.5 text-[12.5px] font-bold text-[#1F2937]">Requested</button>
            ) : info.join_mode === "invite" ? (
              <span className="rounded-full bg-white/70 px-3 py-1.5 text-[12px] font-bold text-[#1F2937]/70">Invite only</span>
            ) : me ? (
              <button onClick={join} className="rounded-full bg-[#0F1419] px-4 py-1.5 text-[13px] font-bold text-white">{info.join_mode === "approval" ? "Request" : "Join"}</button>
            ) : null
          ) : null}
        </div>
        {info?.description ? <p className="mt-2 line-clamp-2 text-[13px] text-[#1F2937]/80">{info.description}</p> : null}
      </div>

      {info?.rules ? (
        <button onClick={() => setRulesOpen(o => !o)} className="mt-3 w-full rounded-xl border border-ink/10 p-3 text-left">
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#0B1E3D]"><Shield size={13} /> Community rules</span>
          <span className={"mt-1 block whitespace-pre-wrap text-[12.5px] text-ink/60" + (rulesOpen ? "" : " line-clamp-2")}>{info.rules}</span>
        </button>
      ) : null}

      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading&hellip;</p>
      ) : !isMember ? (
        <p className="py-16 text-center text-sm text-ink/40">{info?.has_invite ? "Accept the invitation above to see the posts." : info?.is_banned ? "You were removed from this community." : info?.join_mode === "invite" ? "Ask a moderator for an invite to see the posts." : "Join to see and share posts inside this community."}</p>
      ) : (
        <div className="mt-3">
          {(announcements.length > 0 || isMod) ? (
            <div className="mb-3 rounded-2xl border border-[#0B1E3D]/15 bg-[#C9BFB0]/15 p-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#0B1E3D]">
                <Megaphone size={13} /> Announcements
                <span className="flex-1" />
                {isMod ? <button onClick={() => setAnnOpen(o => !o)} className="rounded-full p-1 text-[#0B1E3D] hover:bg-black/5" aria-label="Post an announcement"><Plus size={15} /></button> : null}
              </div>
              {annOpen ? (
                <div className="mt-2 flex gap-2">
                  <input value={annDraft} onChange={e => setAnnDraft(e.target.value)} maxLength={2000} placeholder="What should everyone know?" onKeyDown={e => { if (e.key === "Enter") void postAnnouncement(); }}
                    className="w-full rounded-full bg-white px-4 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink/40" />
                  <button onClick={postAnnouncement} disabled={!annDraft.trim()} className="rounded-full bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-30">Post</button>
                </div>
              ) : null}
              {announcements.length === 0 ? <p className="mt-1 text-[12.5px] text-ink/60">Nothing announced yet. Only moderators post here; every member sees it.</p> : announcements.slice(0, 3).map((a: any) => (
                <div key={a.id} className="group mt-2">
                  <p className="whitespace-pre-wrap text-[13px] text-ink">{a.body}</p>
                  <p className="text-[11.5px] text-ink/45">{(a.full_name || a.username || "Moderator")}{isMod ? <button onClick={() => deleteAnnouncement(a)} className="ml-2 hidden text-red-600 group-hover:inline">Remove</button> : null}</p>
                </div>
              ))}
            </div>
          ) : null}
          {(subs.length > 0 || isMod) ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {subs.map((s: any) => (
                <Link key={s.id} href={"/communities/" + s.id} className="flex items-center gap-1 rounded-full border border-[#0B1E3D]/20 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#0B1E3D] hover:bg-black/[0.03]">
                  <Hash size={12} /> {s.name}{s.join_mode === "invite" && !s.is_member ? <span className="text-ink/40"> · invite only</span> : null}
                </Link>
              ))}
              {isMod ? (
                <button onClick={() => setSubOpen(o => !o)} className="flex items-center gap-1 rounded-full border border-dashed border-[#0B1E3D]/30 px-3 py-1.5 text-[13px] font-semibold text-[#0B1E3D] hover:bg-black/[0.03]"><Plus size={12} /> Sub-group</button>
              ) : null}
            </div>
          ) : null}
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
            <p className="mb-3 rounded-2xl border border-ink/10 px-3 py-2.5 text-center text-[13px] font-semibold text-ink/50">You can view this community but not post in it</p>
          ) : (
          <div className="mb-3 rounded-2xl border border-ink/10 p-3">
            {file ? (
              <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink/60">
                <ImageIcon size={13} /> {file.name}
                <button onClick={() => setFile(null)} className="text-ink/40 hover:text-ink" aria-label="Remove attachment"><X size={13} /></button>
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <button onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-ink/45 hover:bg-black/5" aria-label="Attach a photo"><ImageIcon size={18} /></button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
              <input value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void submitPost(); }}
                placeholder="Share with the community"
                className="w-full rounded-full bg-ink/5 px-4 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink/40" />
              <button onClick={submitPost} disabled={(!draft.trim() && !file) || posting} className="rounded-full bg-ink p-2.5 text-white disabled:opacity-30" aria-label="Post"><Send size={15} /></button>
            </div>
          </div>
          )}
          {posts.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink/40">Quiet in here. Be the first to post.</p>
          ) : (
            posts.map(p => (
              <div key={p.post_id} className="relative mb-1">
                {(p.is_pinned || isMod || p.author_id === me) ? (
                  <div className="flex items-center justify-between px-1 pt-2">
                    <span className="text-[11px] font-extrabold text-[#0B1E3D]">{p.is_pinned ? "Pinned" : ""}</span>
                    {(isMod || p.author_id === me) ? (
                      <button onClick={() => setMenuFor(menuFor === p.post_id ? null : p.post_id)} className="rounded-full p-1 text-ink/40 hover:bg-black/5" aria-label="Post actions"><MoreHorizontal size={15} /></button>
                    ) : null}
                  </div>
                ) : null}
                {menuFor === p.post_id ? (
                  <div className="absolute right-1 top-8 z-10 w-44 rounded-xl border border-ink/10 bg-white p-1 shadow-lg">
                    {isMod ? (
                      <button onClick={() => pin(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-black/5">{p.is_pinned ? "Unpin from top" : "Pin to top"}</button>
                    ) : null}
                    <button onClick={() => removePost(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-red-600 hover:bg-black/5">{p.author_id === me ? "Delete post" : "Remove post"}</button>
                  </div>
                ) : null}
                <PostCard post={p} />
              </div>
            ))
          )}
          {posts.length >= 25 ? (
            <button onClick={() => { const last = posts[posts.length - 1]; if (last) void loadPosts(last.created_at); }}
              className="mx-auto mb-6 block rounded-full bg-ink/5 px-4 py-2 text-[13px] font-semibold text-ink/60 hover:text-ink">Load more</button>
          ) : null}
        </div>
      )}

      {membersOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setMembersOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">Members{isMod ? <button onClick={openBans} className="ml-3 text-[12.5px] font-semibold text-[#0B1E3D] hover:underline">Blocked</button> : null}</p>
              <button onClick={() => setMembersOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 py-1.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(m.avatar_url, 200) ?? m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(m.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={m.full_name || "Member"} userId={m.user_id} badgeSize={12} />{m.user_id === me ? " (you)" : ""}</span>
                  {m.username ? <span className="block text-[12px] text-ink/45">@{m.username}</span> : null}
                </span>
                {m.status === "limited" ? <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10.5px] font-bold text-ink/50">Limited</span> : null}
                {m.role !== "member" ? <span className="rounded-full bg-[#0B1E3D]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">{m.role === "owner" ? "Owner" : "Moderator"}</span> : null}
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
          </div>
        </div>
      ) : null}

      {requestsOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setRequestsOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">Join requests</p>
              <button onClick={() => setRequestsOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            {requests.length === 0 ? <p className="py-8 text-center text-sm text-ink/40">No pending requests.</p> : requests.map(r => (
              <div key={r.user_id} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={r.full_name || "Member"} userId={r.user_id} badgeSize={12} /></span>
                  {r.username ? <span className="block text-[12px] text-ink/45">@{r.username}</span> : null}
                </span>
                <button onClick={() => resolveReq(r, true)} className="rounded-full bg-[#0B1E3D] p-1.5 text-white" aria-label="Approve"><Check size={14} /></button>
                <button onClick={() => resolveReq(r, false)} className="rounded-full bg-ink/5 p-1.5 text-ink/60" aria-label="Deny"><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {inviteOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setInviteOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">Invite people</p>
              <button onClick={() => setInviteOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            <p className="mb-2 text-[12.5px] text-ink/60">An invitation always admits, even when the community is invite only.</p>
            <div className="mb-3 flex gap-2">
              <button onClick={() => copyInviteLink(false)} className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-white"><Link2 size={13} /> Copy invite link</button>
              <button onClick={() => copyInviteLink(true)} className="rounded-full bg-ink/5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink/70 hover:text-ink">New link</button>
            </div>
            {linkNote ? <p className="mb-3 break-all rounded-lg bg-ink/5 px-3 py-2 text-[12px] text-ink/70">{linkNote}</p> : null}
            <input value={inviteQ} onChange={e => setInviteQ(e.target.value)} placeholder="Search people" autoFocus
              className="mb-2 w-full rounded-full bg-ink/5 px-4 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink/40" />
            {inviteHits.filter(h => h.id !== me && !invites.some(i => i.user_id === h.id)).map(h => (
              <div key={h.id} className="flex items-center gap-2 py-1.5">
                {h.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(h.avatar_url, 200) ?? h.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(h.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={h.full_name || "Member"} userId={h.id} badgeSize={12} /></span>
                  {h.username ? <span className="block text-[12px] text-ink/45">@{h.username}</span> : null}
                </span>
                <button onClick={() => invitePerson(h)} className="rounded-full bg-[#0B1E3D] px-3 py-1 text-[12px] font-bold text-white">Invite</button>
              </div>
            ))}
            {invites.length > 0 ? <p className="mb-1 mt-3 text-[12px] font-bold uppercase tracking-wide text-ink/40">Pending</p> : null}
            {invites.map(r => (
              <div key={r.user_id} className="flex items-center gap-2 py-1.5">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(r.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={r.full_name || "Member"} userId={r.user_id} badgeSize={12} /></span>
                  {r.username ? <span className="block text-[12px] text-ink/45">@{r.username}</span> : null}
                </span>
                <button onClick={() => revokeInvite(r)} className="rounded-full p-1.5 text-ink/40 hover:bg-black/5" aria-label="Withdraw invitation"><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {bansOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setBansOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-ink">Blocked from rejoining</p>
              <button onClick={() => setBansOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            {bans.length === 0 ? <p className="py-8 text-center text-sm text-ink/40">No one is blocked.</p> : bans.map(b => (
              <div key={b.user_id} className="flex items-center gap-2 py-1.5">
                {b.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(b.avatar_url, 200) ?? b.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(b.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink"><PersonName name={b.full_name || "Member"} userId={b.user_id} badgeSize={12} /></span>
                  {b.username ? <span className="block text-[12px] text-ink/45">@{b.username}</span> : null}
                </span>
                <button onClick={() => unban(b)} className="rounded-full bg-ink/5 px-3 py-1 text-[12px] font-bold text-ink">Allow back</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {settingsOpen && info ? (
        <CommunitySettings info={info} meId={me} onClose={() => setSettingsOpen(false)}
          onSaved={async () => { setSettingsOpen(false); await loadInfo(); }} />
      ) : null}
    </main>
  );
}

function CommunitySettings({ info, meId, onClose, onSaved }: { info: Info; meId: string | null; onClose: () => void; onSaved: () => void }) {
  const supabase = useRef(createClient()).current;
  const [eName, setEName] = useState(info.name || "");
  const [eDesc, setEDesc] = useState(info.description || "");
  const [eRules, setERules] = useState(info.rules || "");
  const [eMode, setEMode] = useState<string>(info.join_mode || "open");
  const [eColor, setEColor] = useState(info.cover_color || "sky");
  const [eCat, setECat] = useState<string | null>(info.category || null);
  const [iconUrl, setIconUrl] = useState<string | null>(info.icon_url || null);
  const [iconBusy, setIconBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const iconRef = useRef<HTMLInputElement | null>(null);

  const onPickIcon = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !meId || iconBusy) return;
    setIconBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
      const path = meId + "/community_" + info.id + "_" + Date.now() + "." + ext;
      const up = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (up.error) throw up.error;
      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.rpc("update_community_settings", { p_community: info.id, p_icon_url: url });
      if (error) throw error;
      setIconUrl(url);
    } catch (err: any) { alert(err?.message || "Could not update the icon."); }
    finally { setIconBusy(false); }
  };

  const save = async () => {
    if (saving || !eName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_community_settings", {
        p_community: info.id, p_name: eName.trim(), p_description: eDesc.trim() || null,
        p_category: eCat, p_join_mode: eMode, p_cover_color: eColor, p_rules: eRules.trim() || null,
      });
      if (error) throw error;
      onSaved();
    } catch (err: any) { alert(err?.message || "Could not save."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-[460px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-ink">Community settings</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="mb-4 flex flex-col items-center">
          <button onClick={() => iconRef.current?.click()} className="relative" aria-label="Change the community icon">
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconUrl} alt="" className="h-[72px] w-[72px] rounded-2xl object-cover" />
            ) : (
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl text-[#1F2937]" style={{ background: COMM_COLORS[eColor] || COMM_COLORS.sky }}><Users size={24} /></span>
            )}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#0B1E3D] text-white">
              {iconBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Camera size={12} />}
            </span>
          </button>
          <input ref={iconRef} type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
        </div>
        <input value={eName} onChange={e => setEName(e.target.value)} maxLength={60}
          className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
        <input value={eDesc} onChange={e => setEDesc(e.target.value)} maxLength={200} placeholder="Description"
          className="mb-3 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />
        <div className="mb-3 flex gap-2">
          {(["open", "approval", "invite"] as const).map(k => (
            <button key={k} onClick={() => setEMode(k)}
              className={"flex-1 rounded-lg border px-2 py-2 text-[12.5px] font-semibold " + (eMode === k ? "border-ink bg-black/[0.03] text-ink" : "border-ink/10 text-ink/60")}>
              {k === "open" ? "Open" : k === "approval" ? "Approval" : "Invite only"}
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button key={c.key} onClick={() => setECat(eCat === c.key ? null : c.key)}
              className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold " + (eCat === c.key ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(COMM_COLORS).map(([k, v]) => (
            <button key={k} onClick={() => setEColor(k)} aria-label={k}
              className={"h-8 w-8 rounded-full border-2 " + (eColor === k ? "border-ink" : "border-transparent")} style={{ background: v }} />
          ))}
        </div>
        <textarea value={eRules} onChange={e => setERules(e.target.value)} maxLength={600} placeholder="Rules shown to people when they join"
          className="mb-4 h-20 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none focus:border-ink/40" />
        <button onClick={save} disabled={!eName.trim() || saving}
          className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {saving ? "Saving\u2026" : "Save changes"}
        </button>
        <button onClick={async () => {
          if (!confirm("Delete this community? Members lose access, the posts stop showing and the chat closes. This cannot be undone.")) return;
          const { error } = await supabase.rpc("delete_community", { p_community: info.id });
          if (error) { alert(error.message); return; }
          window.location.href = "/communities";
        }} className="mt-3 w-full rounded-md border border-red-600 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">Delete community</button>
      </div>
    </div>
  );
}
