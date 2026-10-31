"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CommunityJoinPage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token || "");
  return <CommunityInvitation key={token} token={token}/>;
}
function CommunityInvitation({token}: {token:string}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [state, setState] = useState<{ kind: "working" | "signed_out" | "error"; text?: string }>(token ? { kind: "working" } : {kind:"error",text:"This invite link is incomplete."});

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const { data: s, error: authError } = await supabase.auth.getSession();
      if (!active) return;
      if (authError) throw authError;
      if (!s.session) { setState({ kind: "signed_out" }); return; }
      const { data, error } = await supabase.rpc("join_community_by_link", { p_token: token });
      if (!active) return;
      if (error) { setState({ kind: "error", text: error.message }); return; }
      const row = data as { community_id?: string; name?: string } | null;
      if (row?.community_id) router.replace("/communities/" + row.community_id);
      else setState({ kind: "error", text: "This invite link is no longer valid." });
    })().catch(() => {if(active)setState({kind:"error",text:"The invitation could not load. Check your connection and reopen the link."});});
    return () => {active=false;};
  }, [token, router, supabase]);

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-[520px] flex-col items-center justify-center px-6 text-center">
      {state.kind === "error" ? (
        <>
          <p className="text-[17px] font-bold text-ink">This invitation cannot be used</p>
          <p className="mt-2 text-[14px] text-ink/60">{state.text}</p>
          <Link href="/communities" className="mt-6 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-white">Browse communities</Link>
        </>
      ) : state.kind === "signed_out" ? (
        <>
          <p className="text-[17px] font-bold text-ink">Sign in to accept this invitation</p>
          <p className="mt-2 text-[14px] text-ink/60">Log in, then open the invite link again. It stays valid until it expires.</p>
          <Link href="/login" className="mt-6 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-white">Log in</Link>
        </>
      ) : (
        <p className="text-[14px] text-ink/60">Opening your invitation&hellip;</p>
      )}
    </section>
  );
}
