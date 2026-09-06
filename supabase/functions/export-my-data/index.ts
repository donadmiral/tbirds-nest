// export-my-data: everything that belongs to the signed-in person, as one JSON.
// Reads with the service role but only rows keyed to the caller's own id, so
// the caller gets exactly their data and nothing else.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("authorization") || "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: me } = await anon.auth.getUser();
  const uid = me?.user?.id;
  if (!uid) return json(401, { error: "Sign in first" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const pick = async (table: string, column: string, select = "*") => {
    const { data, error } = await admin.from(table).select(select).eq(column, uid).limit(5000);
    return error ? { error: error.message } : (data ?? []);
  };

  const out = {
    exported_at: new Date().toISOString(),
    account: { id: uid, email: me!.user!.email ?? null, created_at: me!.user!.created_at ?? null },
    profile: (await admin.from("profiles").select("*").eq("id", uid).maybeSingle()).data ?? null,
    posts: await pick("posts", "user_id"),
    post_media: (await admin.from("post_media").select("*").in("post_id", (((await admin.from("posts").select("id").eq("user_id", uid).limit(5000)).data ?? []) as { id: string }[]).map((p) => p.id))).data ?? [],
    comments: await pick("post_comments", "user_id"),
    likes: await pick("post_likes", "user_id", "post_id, created_at"),
    saved: await pick("post_bookmarks", "user_id", "post_id, created_at"),
    reposts: await pick("post_reposts", "user_id", "post_id, created_at"),
    following: await pick("follows", "follower_id", "following_id, created_at"),
    followers: await pick("follows", "following_id", "follower_id, created_at"),
    stories: await pick("stories", "user_id"),
    story_views_given: await pick("story_views", "viewer_id", "story_id, viewed_at"),
    messages_sent: await pick("messages", "sender_id", "id, conversation_id, content, media_url, created_at"),
    listings: await pick("marketplace_listings", "user_id"),
    job_applications: await pick("job_applications", "applicant_id"),
    support_tickets: await pick("support_tickets", "user_id"),
    blocked: await pick("blocked_users", "blocker_id", "blocked_id, created_at"),
    push_devices: await pick("user_push_tokens", "user_id", "device_name, platform, created_at"),
  };
  return json(200, out);
});