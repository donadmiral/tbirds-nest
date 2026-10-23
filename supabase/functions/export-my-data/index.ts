import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { createExportHandler } from "./handler.ts";

// The caller JWT reaches PostgREST unchanged; no service key or identity argument.
function callerClient(authorization: string, signal: AbortSignal) {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: {
      headers: { Authorization: authorization },
      fetch: (input, init) => fetch(input, { ...init, signal }),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
Deno.serve(createExportHandler({
  authenticate: async (authorization, signal) => {
    const { data, error } = await callerClient(authorization, signal).auth.getUser();
    return error ? null : data.user;
  },
  snapshot: async (authorization, signal) => {
    const { data, error } = await callerClient(authorization, signal).rpc("account_export_snapshot").abortSignal(signal);
    return { data, error };
  },
}));
