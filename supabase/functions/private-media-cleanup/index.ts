import { createClient } from "jsr:@supabase/supabase-js@2";
import { createPrivateMediaCleanup } from "./handler.ts";
Deno.serve(
  createPrivateMediaCleanup({
    env: (name) => Deno.env.get(name),
    client: (url, key) =>
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    fetch,
    uuid: () => crypto.randomUUID(),
  }),
);
