"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, ShieldOff, UserMinus, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// The profile's "more" menu: Restrict (quiet, the person is not told) and Block.
export function ProfileMoreMenu({ profileId, name }: { profileId: string; name: string | null }) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const who = name || "this person";

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id ?? null;
      if (!alive) return;
      setUid(id);
      if (id && id !== profileId) {
        supabase.from("user_restrictions").select("restricted_id").eq("restrictor_id", id).eq("restricted_id", profileId).maybeSingle()
          .then(({ data: r }) => { if (alive) setRestricted(!!r); });
      }
    });
    return () => { alive = false; };
  }, [supabase, profileId]);

  if (!uid || uid === profileId) return null;

  const toggleRestrict = async () => {
    setOpen(false);
    if (!restricted && !confirm("Restrict " + who + "? Their comments on your posts will only be visible to them until you approve them, their messages move to Message requests, and you will not get notifications from them. They will not know.")) return;
    const { error } = await supabase.rpc("set_restriction", { p_user: profileId, p_on: !restricted });
    if (error) { alert(error.message); return; }
    setRestricted((v) => !v);
  };
  const block = async () => {
    setOpen(false);
    if (!confirm("Block " + who + "? They will not be able to see your posts or message you. You can undo this in Settings, under Blocked accounts.")) return;
    const { error } = await supabase.from("blocked_users").insert({ blocker_id: uid, blocked_id: profileId });
    if (error) { alert(error.message); return; }
    router.push("/home");
  };

  return (
    <span className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="More options" className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <>
          <button aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <span className="absolute left-1/2 top-11 z-20 w-44 -translate-x-1/2 overflow-hidden rounded-lg border border-ink/10 bg-white shadow-xl">
            <button onClick={toggleRestrict} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-ink transition-colors duration-[140ms] hover:bg-surface">
              {restricted ? <UserCheck size={14} /> : <UserMinus size={14} />} {restricted ? "Unrestrict" : "Restrict"}
            </button>
            <button onClick={block} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-red-600 transition-colors duration-[140ms] hover:bg-surface">
              <ShieldOff size={14} /> Block
            </button>
          </span>
        </>
      ) : null}
    </span>
  );
}
