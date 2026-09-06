"use client";
// Login activity: devices signed in, and one action to log every other one out.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Smartphone, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; device_name: string | null; platform: string | null; updated_at: string | null; created_at: string | null };
function ago(iso: string | null) { if (!iso) return ""; const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m < 2) return "Active now"; if (m < 60) return m + " min ago"; const h = Math.floor(m / 60); if (h < 24) return h + " h ago"; const d = Math.floor(h / 24); return d < 7 ? d + " d ago" : new Date(iso).toLocaleDateString(); }

export default function LoginActivityPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser(); const id = auth.user?.id; if (!id) return;
    const { data } = await supabase.from("user_push_tokens").select("id, device_name, platform, updated_at, created_at").eq("user_id", id).order("updated_at", { ascending: false });
    setRows((data as Row[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  const logOutOthers = async () => {
    if (!window.confirm("Log out of all other devices? This browser stays signed in.")) return;
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setMsg(error ? error.message : "Other devices have been signed out."); load();
  };
  return (
    <div className="mx-auto max-w-[640px] px-4 py-6">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
      <h1 className="mt-4 font-display text-[24px] font-bold text-ink">Login activity</h1>
      <p className="mt-1 text-[13.5px] text-ink/60">Phones and tablets signed in to your account. This browser is a separate session. If a device isn't yours, log the others out and change your password.</p>
      <ul className="mt-4 divide-y divide-ink/8">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            {r.platform === "ios" || r.platform === "android" ? <Smartphone size={18} className="text-ink" /> : <Monitor size={18} className="text-ink" />}
            <div className="min-w-0 flex-1"><p className="truncate text-[14.5px] font-semibold text-ink">{r.device_name || (r.platform === "ios" ? "iPhone" : r.platform === "android" ? "Android" : "Device")}</p><p className="text-[12px] text-ink/50">{ago(r.updated_at || r.created_at)}</p></div>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="mt-3 text-[13.5px] text-ink/50">No phones recorded yet.</p> : null}
      <button type="button" onClick={logOutOthers} className="mt-5 rounded-full bg-red-50 px-5 py-2.5 text-[14px] font-bold text-red-600 hover:opacity-90">Log out of all other devices</button>
      {msg ? <p className="mt-3 text-[13px] text-ink/70">{msg}</p> : null}
    </div>
  );
}