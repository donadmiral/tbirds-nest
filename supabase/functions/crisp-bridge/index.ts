import { serveBusinessRequest } from '../_shared/serveBusinessRequest.ts';
// Keep credentials on the server. User identity is verified in the handler.
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createBridgeHandler } from "./handler.ts";

serveBusinessRequest(createBridgeHandler({
  db: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  crispUrl: Deno.env.get("CRISP_API_URL") || "",
  crispKey: Deno.env.get("CRISP_API_KEY") || "",
  fetcher: fetch,
}));
