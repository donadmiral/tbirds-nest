"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Handshake, History, Link2, Megaphone, Pencil, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useStudio } from "@/components/StudioShell";
import { StudioDialog } from "@/components/StudioDialog";
import { useStudioMutation, WorkflowRecovery } from "@/components/StudioWorkflowState";
import { can } from "@/lib/studio";
import {
  workflowRead, workflowReadItem, toIsoTime, toLocalTime, parsePostReference,
  quoteToMinor, quoteInput, formatQuote,
  type PartnershipItem, type WorkflowCursor, type WorkflowPage,
} from "@/lib/studioWorkflows";
import { StudioLoadError } from "../LoadError";
import styles from "@/components/StudioWorkspace.module.css";

type BriefForm = {
  title: string; brief: string; deliverables: string; creator_username: string;
  due_at: string; fee: string; currency: string; disclosure: string;
};
type Permission = "publishing" | "paid_promotion";
const blankBrief = (): BriefForm => ({ title: "", brief: "", deliverables: "", creator_username: "", due_at: "", fee: "", currency: "USD", disclosure: "" });
const fromPartnership = (row: PartnershipItem): BriefForm => ({
  title: row.title, brief: row.brief, deliverables: row.deliverables, creator_username: row.creator_username,
  due_at: toLocalTime(row.due_at), fee: quoteInput(row.fee_minor, row.currency), currency: row.currency, disclosure: row.disclosure,
});
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "Not set";
const readable = (value: string) => value.replaceAll("_", " ");
const labels: Record<string, string> = {
  propose: "Propose partnership", accept: "Accept brief", decline: "Decline brief", request_changes: "Request changes",
  approve: "Approve deliverable", cancel: "Cancel partnership", withdraw: "Withdraw from partnership", close: "Close partnership",
};

export default function PartnershipsPage() {
  const { me, accountId } = useStudio();
  const [data, setData] = useState<WorkflowPage<PartnershipItem> | null>(null);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnershipItem | null>(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PartnershipItem | null>(null), [formOpen, setFormOpen] = useState(false), [form, setForm] = useState<BriefForm>(blankBrief);
  const [formError, setFormError] = useState<string | null>(null), [discardOpen, setDiscardOpen] = useState(false);
  const formBaseline = useRef(JSON.stringify(blankBrief()));
  const [action, setAction] = useState<{ row: PartnershipItem; kind: string } | null>(null), [note, setNote] = useState("");
  const [deliver, setDeliver] = useState<PartnershipItem | null>(null), [delivery, setDelivery] = useState(""), [postLink, setPostLink] = useState("");
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [permission, setPermission] = useState<{ row: PartnershipItem; kind: Permission; granted: boolean } | null>(null);
  const [expires, setExpires] = useState(""), [permissionAccepted, setPermissionAccepted] = useState(false), [permissionError, setPermissionError] = useState<string | null>(null);
  const mounted = useRef(false), generation = useRef(0), detailGeneration = useRef(0);
  const currencies = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "KES", "NGN", "USD", "ZAR"];

  const load = useCallback(async (cursor?: WorkflowCursor | null) => {
    const run = ++generation.current;
    setLoading(true);
    try {
      const page = await workflowRead<PartnershipItem>("studio_partnerships_list", cursor);
      if (!mounted.current || run !== generation.current) return;
      setData(previous => cursor && previous ? { ...page, items: [...previous.items, ...page.items.filter(row => !previous.items.some(old => old.id === row.id))] } : page);
      setLoadError(null); setRefreshVersion(value => value + 1);
      setSelectedId(value => value || page.items[0]?.id || null);
    } catch (error) {
      if (mounted.current && run === generation.current) setLoadError(error instanceof Error ? error.message : "Partnerships could not be loaded.");
    } finally { if (mounted.current && run === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const pending = [generation, detailGeneration]; let active = true; mounted.current = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; mounted.current = false; pending.forEach(version => version.current++); };
  }, [load]);
  useEffect(() => { const update=()=>setCurrentTime(Date.now()); const timer=setInterval(update,30000); window.addEventListener("focus",update); return()=>{clearInterval(timer);window.removeEventListener("focus",update);}; }, []);

  const shown = (data?.items ?? []).filter(row => (filter === "all" || row.state === filter) && `${row.title} ${row.creator_username} ${row.creator_name} ${row.owner_name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = shown.find(row => row.id === selectedId) ?? shown[0] ?? null;
  const openDetail = useCallback(async (id: string) => {
    const run = ++detailGeneration.current;
    setDetailLoading(true); setDetailError(null);
    try {
      const row = await workflowReadItem<PartnershipItem>("studio_partnership_get", id);
      if (mounted.current && run === detailGeneration.current) setDetail(row);
    } catch (error) {
      if (mounted.current && run === detailGeneration.current) { setDetail(null); setDetailError(error instanceof Error ? error.message : "This partnership could not be opened."); }
    } finally { if (mounted.current && run === detailGeneration.current) setDetailLoading(false); }
  }, []);
  const detailId = selected?.id;
  useEffect(() => {
    const pending = detailGeneration; let active=true;
    void Promise.resolve().then(()=>{if(!active)return;setDetail(null);if(detailId)void openDetail(detailId);else{setDetailLoading(false);setDetailError(null);}});
    return()=>{active=false;pending.current++;};
  }, [detailId, selected?.version, refreshVersion, openDetail]);
  const visible = detail && selected?.id === detail.id && selected.version === detail.version && !detailLoading ? detail : null;
  const mutation = useStudioMutation<PartnershipItem>({ owner: accountId, member: me?.member_id ?? null, kind: "partnerships", onConfirmed: row => {
    setData(previous => previous ? { ...previous, items: [row, ...previous.items.filter(item => item.id !== row.id)] } : previous);
    setSelectedId(row.id); setFilter("all"); setQuery(""); setFormOpen(false); setAction(null); setDeliver(null); setPermission(null);
    void openDetail(row.id);
  } });
  const locked = mutation.busy || mutation.pending;
  const canCreate = !!me?.is_business && can(me.role, "publish");

  function startBrief(row?: PartnershipItem) {
    const next = row ? fromPartnership(row) : blankBrief();
    setEditing(row ?? null); setForm(next); formBaseline.current = JSON.stringify(next);
    setFormError(null); setFormOpen(true); mutation.clearError();
  }
  function closeBrief() {
    if (mutation.busy) return;
    if (JSON.stringify(form) !== formBaseline.current) setDiscardOpen(true);
    else setFormOpen(false);
  }
  function saveBrief() {
    if (!form.title.trim() || !form.creator_username.trim()) { setFormError("Add a title and the creator’s Platinum Circles username."); return; }
    try {
      const input = { title: form.title.trim(), brief: form.brief, deliverables: form.deliverables,
        creator_username: form.creator_username.trim().replace(/^@/, ""), due_at: toIsoTime(form.due_at),
        fee_minor: quoteToMinor(form.fee, form.currency), currency: form.currency, disclosure: form.disclosure,
      };
      setFormError(null);
      void mutation.run("studio_partnership_save", { p_id: editing?.id ?? null, p_version: editing?.version ?? null, p_input: input });
    } catch (error) { setFormError(error instanceof Error ? error.message : "Check the brief details."); }
  }
  function beginAction(kind: string) {
    if (!visible) return;
    setAction({ row: visible, kind }); setNote(""); mutation.clearError();
  }
  function saveDelivery() {
    if (!deliver || !delivery.trim()) { setDeliveryError("Add the deliverable text, caption or submission notes."); return; }
    try {
      const postId = parsePostReference(postLink);
      setDeliveryError(null);
      void mutation.run("studio_partnership_deliver", { p_id: deliver.id, p_version: deliver.version, p_content: delivery.trim(), p_post_id: postId });
    } catch (error) { setDeliveryError(error instanceof Error ? error.message : "Check the post link."); }
  }
  function beginPermission(kind: Permission, granted: boolean) {
    if (!visible) return;
    setPermission({ row: visible, kind, granted }); setExpires(""); setPermissionAccepted(false); setPermissionError(null); mutation.clearError();
  }
  function savePermission() {
    if (!permission) return;
    try {
      const expiry = permission.granted ? toIsoTime(expires) : null;
      if (permission.granted && (!expiry || Date.parse(expiry) <= Date.now() || Date.parse(expiry) > Date.now() + 366 * 86400000)) throw new Error("Choose a future expiry within one year.");
      if (permission.granted && !permissionAccepted) throw new Error("Confirm this permission before continuing.");
      setPermissionError(null);
      void mutation.run("studio_partnership_permission", { p_id: permission.row.id, p_version: permission.row.version, p_permission: permission.kind, p_granted: permission.granted, p_expires_at: expiry });
    } catch (error) { setPermissionError(error instanceof Error ? error.message : "Check the permission details."); }
  }

  const currentDeliverable = visible?.versions.find(version => version.version === visible.deliverable_version);
  const actionDescription = action ? ({
    propose: `Make this brief available to @${action.row.creator_username} for acceptance in their Studio. The recorded fee is a proposed term; no payment is created.`,
    accept: "Accept the current brief, deliverables, quoted fee and disclosure terms. Publishing and paid-promotion permissions remain separate decisions after approval.",
    decline: "Decline this proposal. The business will see the updated partnership status.",
    approve: "Approve the current deliverable version. This does not grant publishing permission, permission to run ads, or confirm a payment.",
    request_changes: "Explain what needs to change in the current deliverable. The creator can submit a new version for review.",
    cancel: "Cancel this partnership and revoke its recorded permissions. This does not recall previously published content or settle fees.",
    withdraw: "Withdraw from this partnership and revoke its recorded permissions. This does not recall previously published content or settle fees.",
    close: "Close this completed partnership and revoke its recorded permissions. This does not confirm that a fee has been paid or recall previously published content.",
  }[action.kind] || "Review this change before continuing.") : "";

  return <div>
    <header className={styles.pageHeader}><div><h1>Creator partnerships</h1><p>{me?.is_business ? "Brief creators, review their work and agree how approved content may be used." : "Review your collaboration briefs, submit work and control permission to use it."}</p></div><div className={styles.actions}>{canCreate ? <button className={styles.buttonPrimary} disabled={locked} onClick={() => startBrief()}><Plus size={17}/>New partnership</button> : null}<Link className={styles.button} href="/studio/earnings">Earnings <ArrowRight size={15}/></Link></div></header>
    <div className={styles.tabs}>{[["all", "All partnerships"], ["proposed", "Proposals"], ["accepted", "In production"], ["submitted", "Needs review"], ["approved", "Approved"]].map(([key, label]) => <button className={styles.tab} key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    <div className={styles.toolbar}><label><Search size={16}/><input aria-label="Search partnerships" placeholder="Search briefs or creators" value={query} onChange={event => setQuery(event.target.value)}/></label><button className={styles.button} disabled={loading || mutation.busy} onClick={() => void load()}><RefreshCw size={15}/>Refresh</button><span className="ml-auto text-xs text-muted">{data ? `${shown.length} matching · ${data.items.length} loaded` : ""}</span></div>
    <StudioLoadError message={loadError} retry={() => { void load(); }} busy={loading}/><WorkflowRecovery {...mutation}/>
    {loading && !data ? <p className={styles.empty} role="status">Opening partnerships…</p> : !data ? null : !data.items.length ? <section className={styles.card}><div className={styles.empty}><Handshake size={32}/><h2>{me?.is_business ? "Make room for your next collaboration" : "Your collaborations, in one place"}</h2><p>{me?.is_business ? "Start a brief with a named creator, clear deliverables and disclosure terms." : "Business proposals addressed to your account appear here. You choose whether to accept them."}</p>{canCreate ? <button className={styles.buttonPrimary} disabled={locked} onClick={() => startBrief()}>Create a partnership brief</button> : null}</div></section> : <div className={styles.workflowGrid}>
      <aside className={styles.workflowList} aria-label="Partnerships">{shown.map(row => <button className={styles.workflowItem} key={row.id} aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)}><strong>{row.title}</strong><small>{row.is_creator ? row.owner_name : `@${row.creator_username}`}{row.due_at ? ` · Due ${new Date(row.due_at).toLocaleDateString()}` : ""}</small><span className={styles.status} data-state={row.state}>{readable(row.state)}</span></button>)}{!shown.length ? <p className={styles.empty}>No partnerships match these filters.</p> : null}{data.has_more ? <button className={styles.button} disabled={loading} onClick={() => void load(data.next_cursor)}>{loading ? "Loading…" : "Load more partnerships"}</button> : null}</aside>
      <div className={styles.workflowDetail}>
        {detailLoading ? <p className={styles.empty} role="status">Opening the latest brief and deliverable…</p> : null}<StudioLoadError message={detailError} retry={() => { if (selected) void openDetail(selected.id); }} busy={detailLoading}/>
        {visible ? <>
          <header className={styles.pageHeader}><div><h2 className="text-[23px] font-bold tracking-tight">{visible.title}</h2><p>{visible.owner_name} · <Link className="underline" href={`/${encodeURIComponent(visible.creator_username)}`}>@{visible.creator_username}</Link></p></div><div className={styles.actions}><span className={styles.status} data-state={visible.state}>{readable(visible.state)}</span>{visible.can_edit ? <button className={styles.button} disabled={locked} onClick={() => startBrief(visible)}><Pencil size={14}/>Edit brief</button> : null}</div></header>
          <div className={styles.reviewGrid}>
            <div className="space-y-5">
              <section className={styles.card}><div className={styles.cardHeader}><h2>Campaign brief</h2><Handshake size={18}/></div><div className={styles.cardBody}><p className="whitespace-pre-wrap text-[13px] leading-6">{visible.brief || "Add the creative direction before proposing this brief."}</p><dl className={styles.definition}><div><dt>Deliverables</dt><dd className="whitespace-pre-wrap">{visible.deliverables || "Not specified"}</dd></div><div><dt>Due</dt><dd>{when(visible.due_at)}</dd></div><div><dt>Quoted fee</dt><dd>{formatQuote(visible.fee_minor, visible.currency)}<small className="mt-1 block text-muted">Recorded terms. Payment is not processed here.</small></dd></div><div><dt>Disclosure</dt><dd className="whitespace-pre-wrap">{visible.disclosure || "Not specified"}</dd></div></dl><div className={styles.actions}>{visible.can_propose ? <button className={styles.buttonPrimary} disabled={locked} onClick={() => beginAction("propose")}>Propose partnership <ArrowRight size={14}/></button> : null}{visible.can_accept ? <><button className={styles.button} disabled={locked} onClick={() => beginAction("decline")}>Decline brief</button><button className={styles.buttonPrimary} disabled={locked} onClick={() => beginAction("accept")}>Accept brief</button></> : null}</div></div></section>
              <section className={styles.card}><div className={styles.cardHeader}><div><h2>Deliverable & feedback</h2><p>{visible.deliverable_version ? `Current version ${visible.deliverable_version}` : "No version submitted yet"}</p></div>{visible.can_deliver ? <button className={styles.button} disabled={locked} onClick={() => { setDeliver(visible); setDelivery(""); setPostLink(""); setDeliveryError(null); mutation.clearError(); }}><Plus size={15}/>Submit version</button> : null}</div><div className={styles.cardBody}>{visible.deliverable_version > 0 && visible.source_unchanged === false ? <p className={`${styles.notice} ${styles.error}`} role="alert">The linked source changed or is no longer available. Submit a new version for review before approving or granting permission.</p> : null}{currentDeliverable ? <><p className="whitespace-pre-wrap text-[13px] leading-6">{currentDeliverable.content}</p>{currentDeliverable.post_id ? <Link className={`${styles.button} mt-4`} href={`/post/${currentDeliverable.post_id}`}><Link2 size={14}/>Review creator’s post <ArrowRight size={14}/></Link> : null}<p className="mt-3 text-xs text-muted">Submitted {when(currentDeliverable.submitted_at)}</p></> : <div className={styles.empty}><FileText size={26}/><p>The creator can submit text, a caption and an optional link to their public Platinum Circles post after accepting the brief.</p></div>}{visible.review_note ? <div className={styles.notice}><strong className="block">Latest feedback</strong><p className="whitespace-pre-wrap">{visible.review_note}</p></div> : null}<div className={styles.actions}>{visible.can_review ? <><button className={styles.button} disabled={locked} onClick={() => beginAction("request_changes")}>Request changes</button><button className={styles.buttonPrimary} disabled={locked || visible.source_unchanged === false} onClick={() => beginAction("approve")}><CheckCircle2 size={15}/>Approve deliverable</button></> : null}</div>{visible.versions.filter(version => version.version !== visible.deliverable_version).length ? <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold">Earlier versions ({visible.versions.length - 1})</summary><div className="mt-4 space-y-5">{visible.versions.filter(version => version.version !== visible.deliverable_version).map(version => <section className="border-t border-ink/10 pt-4" key={version.version}><h3 className="text-xs font-semibold">Version {version.version} · {when(version.submitted_at)}</h3><p className="mt-3 whitespace-pre-wrap text-[13px] leading-6">{version.content}</p>{version.post_id ? <Link className="mt-3 inline-block text-xs underline" href={`/post/${version.post_id}`}>Open submitted post</Link> : null}</section>)}</div></details> : null}</div></section>
            </div>
            <aside className={styles.card}><div className={styles.cardHeader}><h2>Permissions & review</h2><ShieldCheck size={19}/></div><div className={styles.cardBody}>
              <div className={styles.rightsSummary}><ShieldCheck size={23} className="shrink-0 text-accent"/><div><strong>{visible.source_unchanged === false && visible.deliverable_version > 0 ? "Source needs fresh review" : visible.state === "approved" ? "Deliverable approved" : "Creator permission is separate"}</strong><p>Only the named creator can grant permission for the approved version.</p></div></div>
              <div className="mt-5">{(["publishing", "paid_promotion"] as Permission[]).map(kind => {
                const granted = kind === "publishing" ? visible.publishing_granted : visible.paid_promotion_granted;
                const recorded = kind === "publishing" ? visible.publishing_permission_recorded ?? granted : visible.paid_promotion_permission_recorded ?? granted;
                const expiry = kind === "publishing" ? visible.publishing_expires_at : visible.paid_promotion_expires_at;
                const expired = !!expiry && Date.parse(expiry) <= currentTime;
                const active = granted && !expired && visible.state === "approved";
                return <section className={styles.permissionCard} key={kind}>
                  <div className="flex items-start justify-between gap-2"><strong className="flex items-center gap-2">{kind === "publishing" ? <FileText size={16}/> : <Megaphone size={16}/>} {kind === "publishing" ? "Publishing permission" : "Paid-promotion permission"}</strong><span className={styles.status} data-state={active ? "granted" : "pending"}>{active ? "Granted" : expired ? "Expired" : "Not active"}</span></div>
                  <p>{kind === "publishing" ? "Permission for this business to publish the approved deliverable." : "Separate permission for this business to use the approved deliverable in paid ads."}</p>
                  {expiry ? <p>Expires {when(expiry)}</p> : null}
                  {visible.is_creator && (visible.can_grant_permission || recorded) ? <button className={`${styles.button} mt-3`} disabled={locked} onClick={() => beginPermission(kind, !recorded)}>{recorded ? "Revoke permission" : "Grant permission"}</button> : null}
                </section>;
              })}</div>
              <p className="text-[11px] leading-5 text-muted">These records document permission for this version. Granting permission does not publish content, create an ad, grant platform advertising approval, or make a payment.</p>
              <div className={`${styles.actions} mt-5`}>{visible.can_close ? <button className={styles.button} disabled={locked} onClick={() => beginAction("close")}>Close partnership</button> : null}{visible.can_cancel ? <button className={`${styles.button} ${styles.buttonDanger}`} disabled={locked} onClick={() => beginAction("cancel")}>Cancel partnership</button> : null}{visible.can_withdraw ? <button className={`${styles.button} ${styles.buttonDanger}`} disabled={locked} onClick={() => beginAction("withdraw")}>Withdraw from partnership</button> : null}</div>
            </div></aside>
          </div>
          <section className={`${styles.card} ${styles.sectionGap}`}><div className={styles.cardHeader}><h2>Partnership activity</h2><History size={18}/></div><ol className={`${styles.activity} ${styles.cardBody}`}>{visible.events.map(event => <li key={event.id}><strong>{readable(event.action)}</strong><time dateTime={event.at}>{when(event.at)}</time>{event.note ? <p>{event.note}</p> : null}</li>)}</ol></section>
        </> : !selected && !detailLoading ? <div className={styles.empty}>Select a partnership to review its brief, deliverables and permissions.</div> : null}
      </div>
    </div>}

    <StudioDialog open={formOpen} title={editing ? "Edit partnership brief" : "New partnership brief"} description="A saved draft stays with your business until an owner or administrator proposes it." onClose={closeBrief} busy={mutation.busy} wide>
      <WorkflowRecovery {...mutation}/><form onSubmit={event => { event.preventDefault(); saveBrief(); }}><fieldset disabled={locked} className={styles.dialogBody}>
        {formError ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{formError}</p> : null}
        <div className={styles.fieldGrid}><label className={styles.field}>Partnership title<input value={form.title} maxLength={160} required onChange={event => setForm({ ...form, title: event.target.value })}/></label><label className={styles.field}>Creator username<input value={form.creator_username} maxLength={40} required autoCapitalize="none" placeholder="@username" onChange={event => setForm({ ...form, creator_username: event.target.value })}/><small>Use the exact Platinum Circles username. The creator must be available to this business.</small></label></div>
        <label className={styles.field}>Creative brief<textarea value={form.brief} maxLength={5000} onChange={event => setForm({ ...form, brief: event.target.value })} placeholder="Purpose, audience, creative direction and important context"/></label>
        <label className={styles.field}>Deliverables<textarea value={form.deliverables} maxLength={5000} onChange={event => setForm({ ...form, deliverables: event.target.value })} placeholder="What the creator will submit, formats and revision expectations"/></label>
        <div className={styles.fieldGrid}><label className={styles.field}>Due date (optional)<input type="datetime-local" value={form.due_at} onChange={event => setForm({ ...form, due_at: event.target.value })}/><small>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</small></label><label className={styles.field}>Currency<select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}>{currencies.includes(form.currency) ? null : <option value={form.currency}>{form.currency}</option>}{currencies.map(currency => <option value={currency} key={currency}>{currency}</option>)}</select></label><label className={styles.field}>Quoted fee (optional)<input inputMode="decimal" value={form.fee} maxLength={16} onChange={event => setForm({ ...form, fee: event.target.value })} placeholder={`Amount in ${form.currency}`}/><small>Records your proposed terms. No payment is made from this form.</small></label></div>
        <label className={styles.field}>Disclosure requirements<textarea value={form.disclosure} maxLength={2000} onChange={event => setForm({ ...form, disclosure: event.target.value })} placeholder="How the creator should clearly identify the paid partnership"/></label>
      </fieldset><footer className={styles.dialogFooter}><button type="button" className={styles.button} disabled={mutation.busy} onClick={closeBrief}>Cancel</button><button className={styles.buttonPrimary} disabled={locked}>{mutation.busy ? "Saving…" : "Save brief draft"}</button></footer></form>
    </StudioDialog>
    <StudioDialog open={discardOpen} title="Discard your changes?" description="Your unsaved edits to this brief will be lost." onClose={() => setDiscardOpen(false)}><footer className={styles.dialogFooter}><button className={styles.button} onClick={() => setDiscardOpen(false)}>Keep editing</button><button className={`${styles.button} ${styles.buttonDanger}`} onClick={() => { setDiscardOpen(false); setFormOpen(false); }}>Discard changes</button></footer></StudioDialog>

    <StudioDialog open={!!action} title={labels[action?.kind || ""] || "Review partnership"} onClose={() => setAction(null)} busy={mutation.busy}><WorkflowRecovery {...mutation}/>{action ? <><div className={styles.dialogBody}><h3 className="font-semibold">{action.row.title}</h3><p className="mt-3 text-sm leading-6 text-muted">{actionDescription}</p><label className={`${styles.field} mt-4`}>{action.kind === "request_changes" ? "Required feedback" : "Note (optional)"}<textarea disabled={locked} maxLength={2000} value={note} onChange={event => setNote(event.target.value)}/></label></div><footer className={styles.dialogFooter}><button className={styles.button} disabled={mutation.busy} onClick={() => setAction(null)}>Back</button><button className={styles.buttonPrimary} disabled={locked || action.kind === "request_changes" && !note.trim()} onClick={() => void mutation.run("studio_partnership_transition", { p_id: action.row.id, p_version: action.row.version, p_action: action.kind, p_note: note.trim() })}>{mutation.busy ? "Confirming…" : labels[action.kind]}</button></footer></> : null}</StudioDialog>

    <StudioDialog open={!!deliver} title="Submit a deliverable version" description="The business reviews each new version. Earlier publishing and paid-use permissions are reset." onClose={() => setDeliver(null)} busy={mutation.busy}><WorkflowRecovery {...mutation}/><form onSubmit={event => { event.preventDefault(); saveDelivery(); }}><fieldset disabled={locked} className={styles.dialogBody}>{deliveryError ? <p className={`${styles.notice} ${styles.error}`} role="alert">{deliveryError}</p> : null}<label className={styles.field}>Deliverable text or caption<textarea required maxLength={10000} value={delivery} onChange={event => setDelivery(event.target.value)} placeholder="Include the completed caption or text and relevant submission notes."/></label><label className={styles.field}>Your public post link (optional)<input value={postLink} onChange={event => setPostLink(event.target.value)} placeholder="Paste the link to your Platinum Circles post"/><small>Only a public post owned by your account can be attached. Private file review is not available here.</small></label></fieldset><footer className={styles.dialogFooter}><button type="button" className={styles.button} disabled={mutation.busy} onClick={() => setDeliver(null)}>Cancel</button><button className={styles.buttonPrimary} disabled={locked || !delivery.trim()}>{mutation.busy ? "Submitting…" : "Submit for review"}</button></footer></form></StudioDialog>

    <StudioDialog open={!!permission} title={`${permission?.granted ? "Grant" : "Revoke"} ${permission?.kind === "publishing" ? "publishing" : "paid-promotion"} permission`} onClose={() => setPermission(null)} busy={mutation.busy}><WorkflowRecovery {...mutation}/>{permission ? <form onSubmit={event => { event.preventDefault(); savePermission(); }}><fieldset disabled={locked} className={styles.dialogBody}><h3 className="font-semibold">{permission.row.title} · Version {permission.row.deliverable_version}</h3><p className="mt-3 text-sm leading-6 text-muted">{permission.granted ? `Allow ${permission.row.owner_name} to ${permission.kind === "publishing" ? "publish" : "use in paid promotion"} the approved deliverable until the expiry you choose.` : "Revoke this permission record for the current deliverable. Previously published content or external use is not automatically recalled."}</p>{permissionError ? <p className={`${styles.notice} ${styles.error}`} role="alert">{permissionError}</p> : null}{permission.granted ? <><label className={`${styles.field} mt-4`}>Permission expires<input required type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)}/><small>Choose a future time within one year. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</small></label><label className={styles.checkField}><input type="checkbox" checked={permissionAccepted} onChange={event => setPermissionAccepted(event.target.checked)}/>I grant this specific permission for the approved version until the expiry above.</label></> : null}</fieldset><footer className={styles.dialogFooter}><button type="button" className={styles.button} disabled={mutation.busy} onClick={() => setPermission(null)}>Back</button><button className={styles.buttonPrimary} disabled={locked || permission.granted && (!permissionAccepted || !expires)}>{mutation.busy ? "Confirming…" : permission.granted ? "Grant permission" : "Revoke permission"}</button></footer></form> : null}</StudioDialog>
  </div>;
}
