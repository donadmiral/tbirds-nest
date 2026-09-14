import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { createRecoveryHandler } from "./handler.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
Deno.serve(createRecoveryHandler({
  db: createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  serviceKey,
  crispUrl: Deno.env.get("CRISP_API_URL") || "",
  crispKey: Deno.env.get("CRISP_API_KEY") || "",
  fetcher: fetch,
}));
