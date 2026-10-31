"use client";

import { hydrateMemoryAlbumMedia, hydrateStoryMedia } from "@/lib/contentMedia";
import { createClient } from "@/lib/supabase/client";
import type { StoryMediaTransform, StoryRow } from "@/lib/stories";
import { memoryAlbumStoryLayers } from '../../shared/memoryStoryPresentation';

export type MemoryPage = {
  id: string; media_url: string | null; media_type: string;
  thumbnail_url: string | null; caption: string | null;
  style?: "polaroid" | "full"; taken_at: string | null; sort_order: number;
  story_id?: string; kind?: string; story_caption?: string | null; text_background?: StoryRow["text_background"]; stickers?: StoryRow["stickers_json"] | string;
  media_transform?: StoryMediaTransform | null; filter_id?: string | null;
  audio_sound_id?: string | null; audio_duration_sec?: number | null;
  duration_sec?: number | null; dual_front_url?: string | null; audio_url?: string | null; audio_title?: string | null;
};
export type MemoryAlbum = {
  cover_artwork?: import('../../shared/memoryBookCreative').MemoryCoverArtwork; film_settings?: import('../../shared/memoryBookCreative').MemoryFilmSettings; presentation_revision?: number;
  subtitle?: string; cover_story_id?: string | null; cover_page?: import('../../shared/memoryBookDesign').MemoryCoverPage | null;
  id: string; user_id?: string; is_default?: boolean; cover_design?: string; soundtrack?: import("../../shared/soundtrack").SoundtrackSelection | null;
  is_owner: boolean; can_view: boolean; title: string;
  cover_color: string; audience: string; count: number; pages: MemoryPage[];
};
export type AccessPerson = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

export { MEMORY_COVER_COLORS as COVER_COLORS } from "../../shared/memoryBookDesign";

export async function getMemoryAlbum(ownerId: string): Promise<MemoryAlbum | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_memory_album", { p_owner: ownerId });
  if (error) throw error;
  if (!data) return null;
  const [album] = await hydrateMemoryAlbumMedia([memoryAlbumStoryLayers(data as MemoryAlbum)], supabase);
  return album;
}

export type MemoryBookInfo = { cover_artwork?: import('../../shared/memoryBookCreative').MemoryCoverArtwork; film_settings?: import('../../shared/memoryBookCreative').MemoryFilmSettings; presentation_revision?: number; id: string; title: string; subtitle?: string; cover_story_id?: string | null; cover_page?: import('../../shared/memoryBookDesign').MemoryCoverPage | null; cover_color: string; cover_design?: string; audience: string; count: number; is_default?: boolean; is_owner?: boolean; can_view?: boolean };

export type MemoryShelf = { is_owner: boolean; books: MemoryBookInfo[] };

export async function getMemoryBooks(ownerId: string, signal?: AbortSignal): Promise<MemoryShelf> {
  const supabase = createClient();
  const query = supabase.rpc("get_memory_albums", { p_owner: ownerId });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  if (!data) throw new Error("Memory books unavailable");
  const env = data as MemoryShelf | MemoryBookInfo[];
  if (Array.isArray(env)) return { is_owner: false, books: await hydrateMemoryAlbumMedia(env as MemoryBookInfo[], supabase) };
  return { is_owner: !!env.is_owner, books: await hydrateMemoryAlbumMedia((env.books ?? []) as MemoryBookInfo[], supabase) };
}

export async function saveBookPresentation(albumId:string,title:string,color:string,audience:string,design:string,subtitle:string,coverStoryId:string|null):Promise<boolean> {
  const {error}=await createClient().rpc('save_memory_book_presentation',{p_album:albumId,p_title:title,p_cover_color:color,p_audience:audience,p_cover_design:design,p_subtitle:subtitle,p_cover_story_id:coverStoryId});
  return !error;
}

export async function getMemoryBook(albumId: string): Promise<MemoryAlbum | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_memory_book", { p_album: albumId });
  if (error) throw error;
  if (!data) return null;
  const [album] = await hydrateMemoryAlbumMedia([memoryAlbumStoryLayers(data as MemoryAlbum)], supabase);
  return album;
}

export async function addMemoryPage(storyId: string, albumId?: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("add_memory_page", { p_story_id: storyId, p_album_id: albumId ?? null });
  return !error;
}

export async function updateMemoryPage(id: string, fields: { caption?: string | null; style?: string }): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.from("memory_pages").update(fields).eq("id", id).select("id");
  return !error && data?.length === 1;
}

export async function swapMemoryPages(a: MemoryPage, b: MemoryPage): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.rpc("swap_memory_pages", { p_first: a.id, p_second: b.id });
  return !error;
}

export async function deleteMemoryPage(id: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.from("memory_pages").delete().eq("id", id).select("id");
  return !error && data?.length === 1;
}

export async function getMyStories(limit = 120): Promise<{ id: string; media_url: string | null; media_type: string; thumbnail_url: string | null; caption: string | null; created_at: string; text_background?: {color?:string;colors?:string[]} | string | null; stickers_json?: unknown }[]> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return [];
  const { data, error } = await supabase.from("stories")
    .select("id, media_url, media_type, thumbnail_url, caption, created_at, text_background, stickers_json")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return hydrateStoryMedia(data ?? [], supabase);
}

export async function getAccessList(kind: "allow" | "block"): Promise<AccessPerson[]> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return [];
  const { data: rows, error } = await supabase.from("memory_album_access")
    .select("member_id").eq("owner_id", uid).eq("kind", kind);
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.member_id);
  if (ids.length === 0) return [];
  const { data, error: profilesError } = await supabase.from("profiles")
    .select("id, full_name, username, avatar_url").in("id", ids);
  if (profilesError) throw profilesError;
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
  const query = q.trim().replace(/[%,().]/g, " ").slice(0, 80);
  if (query.length < 2) return [];
  const { data, error } = await supabase.from("profiles")
    .select("id, full_name, username, avatar_url")
    .or("full_name.ilike.%" + query + "%,username.ilike.%" + query + "%")
    .limit(8);
  if (error) throw error;
  return (data ?? []) as AccessPerson[];
}
