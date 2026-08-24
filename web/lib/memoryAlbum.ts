"use client";

import { createClient } from "@/lib/supabase/client";

export type MemoryPage = {
  id: string; media_url: string | null; media_type: string;
  thumbnail_url: string | null; caption: string | null;
  style: "polaroid" | "full"; taken_at: string | null; sort_order: number;
};
export type MemoryAlbum = {
  is_owner: boolean; can_view: boolean; title: string;
  cover_color: string; audience: string; count: number; pages: MemoryPage[];
};
export type AccessPerson = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

export const COVER_COLORS: Record<string, { cover: string; spine: string; text: string }> = {
  blush: { cover: "#FBE3EA", spine: "#F2B8C6", text: "#8a3b52" },
  rose:  { cover: "#F4C0D1", spine: "#D4537E", text: "#72243E" },
  pearl: { cover: "#F3EDE2", spine: "#C9BFB0", text: "#4a4438" },
  cream: { cover: "#FAF3E3", spine: "#E8D9B8", text: "#6b5b35" },
  sage:  { cover: "#E4EEE2", spine: "#AFC8AB", text: "#3c5738" },
  sky:   { cover: "#E2EEF6", spine: "#A9CBE0", text: "#2c516b" },
  lilac: { cover: "#ECE7F7", spine: "#C4B6E6", text: "#4b3c78" },
  ink:   { cover: "#2A2D33", spine: "#16181c", text: "#f2f0ec" },
};

export async function getMemoryAlbum(ownerId: string): Promise<MemoryAlbum | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_memory_album", { p_owner: ownerId });
  if (error || !data) return null;
  return data as MemoryAlbum;
}

export async function addMemoryPage(storyId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_memory_page", { p_story_id: storyId });
  return !error;
}

export async function saveAlbumSettings(title: string, cover: string, audience: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("upsert_memory_album", {
    p_title: title, p_cover_color: cover, p_audience: audience,
  });
  return !error;
}

export async function updateMemoryPage(id: string, fields: { caption?: string | null; style?: string }): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("memory_pages").update(fields).eq("id", id);
  return !error;
}

export async function swapMemoryPages(a: MemoryPage, b: MemoryPage): Promise<boolean> {
  const supabase = createClient();
  const r1 = await supabase.from("memory_pages").update({ sort_order: b.sort_order }).eq("id", a.id);
  const r2 = await supabase.from("memory_pages").update({ sort_order: a.sort_order }).eq("id", b.id);
  return !r1.error && !r2.error;
}

export async function deleteMemoryPage(id: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("memory_pages").delete().eq("id", id);
  return !error;
}

export async function getMyStories(): Promise<{ id: string; media_url: string | null; media_type: string; thumbnail_url: string | null; caption: string | null; created_at: string }[]> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return [];
  const { data } = await supabase.from("stories")
    .select("id, media_url, media_type, thumbnail_url, caption, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(120);
  return data ?? [];
}

export async function getAccessList(kind: "allow" | "block"): Promise<AccessPerson[]> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return [];
  const { data: rows } = await supabase.from("memory_album_access")
    .select("member_id").eq("owner_id", uid).eq("kind", kind);
  const ids = (rows ?? []).map((r) => r.member_id);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("profiles")
    .select("id, full_name, username, avatar_url").in("id", ids);
  return (data ?? []) as AccessPerson[];
}

export async function setAccess(memberId: string, kind: "allow" | "block", on: boolean): Promise<boolean> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return false;
  if (on) {
    const { error } = await supabase.from("memory_album_access")
      .upsert({ owner_id: uid, member_id: memberId, kind });
    return !error;
  }
  const { error } = await supabase.from("memory_album_access")
    .delete().eq("owner_id", uid).eq("member_id", memberId).eq("kind", kind);
  return !error;
}

export async function searchPeople(q: string): Promise<AccessPerson[]> {
  const supabase = createClient();
  if (q.trim().length < 2) return [];
  const { data } = await supabase.from("profiles")
    .select("id, full_name, username, avatar_url")
    .or("full_name.ilike.%" + q + "%,username.ilike.%" + q + "%")
    .limit(8);
  return (data ?? []) as AccessPerson[];
}