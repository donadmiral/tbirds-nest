"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Camera, Check, Image as ImageIcon, Inbox, LogOut, MoreHorizontal, Send, Settings2, Shield, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PostCard } from "@/components/PostCard";
import { CATEGORIES } from "@/lib/categories";
import { COMM_COLORS } from "@/lib/communities";

type Info = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; category: string | null; rules: string | null; join_mode: string;
  member_count: number; is_member: boolean; my_role: string | null; has_pending: boolean;
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
          </div>
          {info && !isMember ? (
            info.has_pending ? (
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
        <p className="py-16 text-center text-sm text-ink/40">{info?.join_mode === "invite" ? "Ask a moderator for an invite to see the posts." : "Join to see and share posts inside this community."}</p>
      ) : (
        <div className="mt-3">
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
              <p className="text-[15px] font-semibold text-ink">Members</p>
              <button onClick={() => setMembersOpen(false)} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={16} /></button>
            </div>
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 py-1.5">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(m.avatar_url, 200) ?? m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0B1E3D] text-[12px] font-bold text-white">{(m.full_name || "?").charAt(0)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{m.full_name || "Member"}{m.user_id === me ? " (you)" : ""}</span>
                  {m.username ? <span className="block text-[12px] text-ink/45">@{m.username}</span> : null}
                </span>
                {m.role !== "member" ? <span className="rounded-full bg-[#0B1E3D]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">{m.role === "owner" ? "Owner" : "Moderator"}</span> : null}
                {myRole === "owner" && m.role !== "owner" && m.user_id !== me ? (
                  <select value={m.role} onChange={e => applyRole(m, e.target.value)} aria-label="Change role"
                    className="rounded-md border border-ink/15 bg-white px-1.5 py-1 text-[12px] text-ink outline-none">
                    <option value="member">Member</option>
                    <option value="moderator">Moderator</option>
                    <option value="remove">Remove</option>
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
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{r.full_name || "Member"}</span>
                  {r.username ? <span className="block text-[12px] text-ink/45">@{r.username}</span> : null}
                </span>
                <button onClick={() => resolveReq(r, true)} className="rounded-full bg-[#0B1E3D] p-1.5 text-white" aria-label="Approve"><Check size={14} /></button>
                <button onClick={() => resolveReq(r, false)} className="rounded-full bg-ink/5 p-1.5 text-ink/60" aria-label="Deny"><X size={14} /></button>
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
      </div>
    </div>
  );
}
