import { createClient } from "jsr:@supabase/supabase-js@2";
import { createPrivateMediaSession } from "./handler.ts";
Deno.serve(
  createPrivateMediaSession({
    env: (name) => Deno.env.get(name),
    client: (url, key, authorization) =>
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authorization || "" } },
      }),
    fetch,
  }),
);
