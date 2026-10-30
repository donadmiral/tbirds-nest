import { createBrowserClient } from "@supabase/ssr";
import { createAuthDeadlineFetch } from "../../../shared/authFetch";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: createAuthDeadlineFetch(process.env.NEXT_PUBLIC_SUPABASE_URL!, (input, init) => fetch(input, init)) } }
  );
}
