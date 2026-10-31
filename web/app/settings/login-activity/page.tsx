"use client";
// Login activity: devices signed in, and one action to log every other one out.
import { useState } from "react";
import { useAccountResource } from "@/lib/useAccountResource";
import { errorMessage } from "@/lib/errors";
import { withTimeout } from "@/lib/withTimeout";
import { ErrorState } from "@/components/ErrorState";

import { Smartphone, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; device_name: string | null; platform: string | null; updated_at: string | null; created_at: string | null };
function ago(iso: string | null) { if (!iso) return ""; const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m < 2) return "Active now"; if (m < 60) return m + " min ago"; const h = Math.floor(m / 60); if (h < 24) return h + " h ago"; const d = Math.floor(h / 24); return d < 7 ? d + " d ago" : new Date(iso).toLocaleDateString(); }

async function fetchRows(supabase: ReturnType<typeof createClient>, uid: string): Promise<Row[]> {
  const { data, error } = await supabase.from("user_push_tokens").select("id, device_name, platform, updated_at, created_at").eq("user_id", uid).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Row[];
}

export default function LoginActivityPage() {
  const { client: supabase, data: rows, error: loadError, loading, retry, assertOwner } = useAccountResource<Row[]>(fetchRows, []);
  const [msg, setMsg] = useState<string | null>(null);
  const logOutOthers = async () => {
    if (!window.confirm("Log out of all other devices? This browser stays signed in.")) return;
    try {
    await assertOwner();
    const { error } = await withTimeout(supabase.auth.signOut({ scope: "others" }));
    setMsg(error ? error.message : "Other devices have been signed out."); retry();
    } catch (cause) { setMsg(errorMessage(cause, "The other sessions could not be signed out. Please try again.")); }
  };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Login activity</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Phones and tablets signed in to your account. This browser is a separate session. If a device is not yours, log the others out and change your password.</p>
      {loadError ? <ErrorState title={loadError} onRetry={retry} /> : null}
      <ul className="mt-4 divide-y divide-ink/8">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            {r.platform === "ios" || r.platform === "android" ? <Smartphone size={18} className="text-ink" /> : <Monitor size={18} className="text-ink" />}
            <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-semibold text-ink">{r.device_name || (r.platform === "ios" ? "iPhone" : r.platform === "android" ? "Android" : "Device")}</p><p className="text-[12px] text-muted">{ago(r.updated_at || r.created_at)}</p></div>
          </li>
        ))}
      </ul>
      {!loading && !loadError && rows.length === 0 ? <p className="mt-3 text-[13.5px] text-muted">No phones recorded yet.</p> : null}
      <button type="button" onClick={logOutOthers} className="mt-5 rounded-full bg-red-50 px-5 py-2.5 text-[14px] font-bold text-danger hover:opacity-90">Log out of all other devices</button>
      {msg ? <p className="mt-3 text-[13px] text-ink/70">{msg}</p> : null}
    </div>
  );
}