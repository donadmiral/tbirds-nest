"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, ShieldOff, UserMinus, UserCheck, Flag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

import { ACCOUNT_REPORT_REASONS, reportAccount } from "../../shared/accountReporting";

// The profile's "more" menu: Restrict (quiet, the person is not told) and Block.
export function ProfileMoreMenu({ profileId, name }: { profileId: string; name: string | null }) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('impersonation');
  const [reportDetails, setReportDetails] = useState('');
  const [reportResult, setReportResult] = useState('');
  const [reportError, setReportError] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const reportPending = useRef(false);
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
    window.dispatchEvent(new CustomEvent('pc-feed-author-hidden', { detail: { ownerId: uid, authorId: profileId } }));
    router.push("/home");
  };

  return (
    <div className="relative" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); setReporting(false); } }}>
      <button onClick={() => { setOpen(v => !v); setReporting(false); }} aria-expanded={open} aria-label="More options" className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <>
          <button tabIndex={-1} aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <div className={"absolute left-1/2 top-11 z-20 -translate-x-1/2 overflow-hidden rounded-lg border border-ink/10 bg-surface shadow-xl " + (reporting ? "w-64" : "w-44")}>
          {reporting ? <form className="space-y-3 p-3" aria-label="Report account" onSubmit={async event => {
            event.preventDefault(); if (reportPending.current) return; reportPending.current=true; setReportBusy(true); setReportError('');
            try { setReportResult(await reportAccount(supabase, uid, profileId, reportReason, reportDetails)); }
            catch(error) { setReportError(error instanceof Error ? error.message : 'Your report was not sent. Please try again.'); }
            finally {reportPending.current=false; setReportBusy(false);}
          }}>
            {reportResult ? <p role="status" className="text-sm">{reportResult}</p> : <>
            <p className="text-sm font-semibold">Report {who}</p>
            <label className="block text-xs">Reason<select autoFocus className="mt-1 w-full rounded border border-ink/15 bg-surface p-2" value={reportReason} onChange={event => setReportReason(event.target.value)}>{ACCOUNT_REPORT_REASONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs">Details (optional)<textarea className="mt-1 w-full rounded border border-ink/15 bg-surface p-2" maxLength={2000} rows={3} value={reportDetails} onChange={event=>setReportDetails(event.target.value)} placeholder="For impersonation, include a link to the real person or organisation." /></label>
            {reportError && <p role="alert" className="text-xs text-danger">{reportError}</p>}
            <button disabled={reportBusy} className="rounded bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reportBusy ? 'Sending…' : 'Send report'}</button>
            </>}<button type="button" onClick={() => {setReporting(false); setOpen(false);}} className="ml-3 text-xs underline">Close</button>
          </form> : <>
            <button onClick={toggleRestrict} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-ink transition-colors duration-[140ms] hover:bg-surface">
              {restricted ? <UserCheck size={14} /> : <UserMinus size={14} />} {restricted ? "Unrestrict" : "Restrict"}
            </button>
            <button onClick={() => {setReportResult(''); setReportError(''); setReporting(true);}} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-surface"><Flag size={14} /> Report account</button>
            <button onClick={block} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-danger transition-colors duration-[140ms] hover:bg-surface">
              <ShieldOff size={14} /> Block
            </button>
          </>}
          </div>
        </>
      ) : null}
    </div>
  );
}
