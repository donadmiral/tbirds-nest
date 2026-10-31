import { createClient } from "./supabase/client";
export type WorkflowCursor = { at: string; id: string };
export type WorkflowEvent = { id: string; action: string; note: string; at: string };
export type NewsroomItem = {
  id: string; owner_id: string; title: string; brief: string; assignee_id: string | null; scheduled_post_id: string | null;
  rights_owner: string; territory: string; rights_verified: boolean; rights_expires_at: string | null; embargo_at: string | null; publish_at: string | null;
  sponsor: string; paid_partnership: boolean; state: "draft"|"in_review"|"changes_requested"|"approved"|"scheduled"|"cancelled"; version: number;
  created_at: string; updated_at: string; review_note: string; submitted_at: string | null; approved_at: string | null;
  post_status: string | null; published_post_id: string | null; post_error: string | null;
  can_edit: boolean; can_submit: boolean; can_review: boolean; can_schedule: boolean; can_cancel: boolean; can_withdraw: boolean; can_change_post: boolean;
  events: WorkflowEvent[];
  post?: {id: string; content: string | null; body: string | null; media: {url: string; media_type: string}[]; products: {title: string}[]; status: string; publish_at: string | null} | null;
};
export type PartnershipItem = {
  id: string; owner_id: string; owner_name: string; creator_id: string; creator_name: string; creator_username: string;
  title: string; brief: string; deliverables: string; disclosure: string; due_at: string | null; fee_minor: string | number | null; currency: string;
  state: "draft"|"proposed"|"accepted"|"submitted"|"changes_requested"|"approved"|"declined"|"cancelled"|"closed"; version: number;
  deliverable_version: number; source_unchanged: boolean; review_note: string; created_at: string; updated_at: string; is_creator: boolean;
  publishing_granted: boolean; publishing_permission_recorded: boolean; publishing_expires_at: string | null; paid_promotion_granted: boolean; paid_promotion_permission_recorded: boolean; paid_promotion_expires_at: string | null;
  can_edit: boolean; can_propose: boolean; can_review: boolean; can_deliver: boolean; can_accept: boolean; can_cancel: boolean; can_withdraw: boolean; can_close: boolean; can_grant_permission: boolean;
  versions: { version: number; content: string; post_id: string | null; submitted_at: string }[]; events: WorkflowEvent[];
};
export type WorkflowPage<T> = { items: T[]; has_more: boolean; next_cursor: WorkflowCursor | null; role: string | null; member_id: string | null; members?: {id: string; display_name: string; role: string}[] };
export const WORKFLOW_OPERATIONS = ["studio_newsroom_save","studio_newsroom_transition","studio_partnership_save","studio_partnership_transition","studio_partnership_deliver","studio_partnership_permission"] as const;
export type WorkflowOperation = typeof WORKFLOW_OPERATIONS[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class WorkflowFailure extends Error { constructor(message: string, readonly confirmedRejected: boolean) { super(message); } }
const MESSAGES: Record<string,string> = {
  WORKFLOW_VERSION_CHANGED:"This item changed while it was open. Refresh and review the latest version before trying again.",
  WORKFLOW_INDEPENDENT_REVIEW_REQUIRED:"Another owner or administrator must review this submission. You cannot approve your own submission.",
  WORKFLOW_RIGHTS_REQUIRED:"Add the rights owner and territory, and confirm you have checked the content rights.",
  WORKFLOW_RIGHTS_EXPIRED:"The recorded content rights have expired. Update the assignment before submitting it.",
  WORKFLOW_INVALID_SCHEDULE:"Choose a future publication time after the embargo and before the content rights expire.",
  WORKFLOW_DRAFT_REQUIRED:"Link an unscheduled post draft before submitting this assignment.",
  WORKFLOW_DRAFT_UNAVAILABLE:"That draft is no longer available for this assignment. Choose a current unscheduled draft.",
  WORKFLOW_CREATIVE_CHANGED:"The linked post changed after submission. Withdraw it and request a fresh review.",
  WORKFLOW_DISCLOSURE_REQUIRED:"Include the paid-partnership disclosure in the linked post before submitting it.",
  WORKFLOW_REVIEW_NOTE_REQUIRED:"Explain the changes you are requesting before continuing.",
  WORKFLOW_APPROVAL_REQUIRED:"The assignment needs team approval before it can be scheduled.",
  WORKFLOW_CREATOR_UNAVAILABLE:"That creator is not available for this brief. Check the username and account access.",
  WORKFLOW_BRIEF_INCOMPLETE:"Complete the brief, deliverables and disclosure before proposing this partnership.",
  WORKFLOW_DUE_DATE_PASSED:"The recorded due date has passed. Update the brief before proposing it.",
  WORKFLOW_VERSION_LIMIT_REACHED:"This partnership has reached its deliverable version limit. Arrange a new brief for further work.",
  WORKFLOW_DELIVERABLE_REQUIRED:"Add the deliverable text or caption before submitting this version.",
  WORKFLOW_DELIVERABLE_CHANGED:"The linked source changed or is no longer available. The creator must submit a new version for review.",
  WORKFLOW_PUBLIC_OWN_POST_REQUIRED:"The linked post must be your own public Platinum Circles post.",
  WORKFLOW_PERMISSION_EXPIRY_REQUIRED:"Set a permission expiry in the future, within one year.",
  WORKFLOW_APPROVED_DELIVERABLE_REQUIRED:"The current deliverable must be approved before permission can be granted.",
  WORKFLOW_WITHDRAW_BEFORE_EDIT:"Withdraw this submission in Newsroom before editing its linked post.",
  WORKFLOW_CANCEL_IN_NEWSROOM:"Cancel this schedule in Newsroom before changing the linked post.",
  WORKFLOW_CREATOR_PERMISSION_REQUIRED:"Only the named creator can take this action.",
  WORKFLOW_PERMISSION_DENIED:"Your current role cannot perform this action.",
  WORKFLOW_MEMBER_ACCESS_REQUIRED:"Your personal business access must be verified before using this tool.",
  WORKFLOW_ACTIVE_SESSION_REQUIRED:"Your session expired. Sign in again to continue.",
  WORKFLOW_REQUEST_KEY_REUSED:"This retry no longer matches the original request. Refresh the workspace before continuing.",
  WORKFLOW_INVALID_TRANSITION:"This action is no longer available in the current state. Refresh and review the item.",
};
export function workflowFailure(error: unknown): WorkflowFailure {
  if(error instanceof WorkflowFailure)return error;
  const detail=error&&typeof error==="object"?error as {message?:string;code?:string}:{};
  const key=detail.message?.match(/WORKFLOW_[A-Z_]+/)?.[0];
  if(detail.code==="PGRST202")return new WorkflowFailure("This workspace tool is not available on this deployment yet. Try again after the service is updated.",true);
  if(key)return new WorkflowFailure(MESSAGES[key]||"This change was not accepted. Check the item and refresh its current state before trying again.",true);
  if(detail.code?.startsWith("22")||detail.code==="23505"||detail.code==="42501")return new WorkflowFailure("This change was not accepted. Check your access and the supplied details.",true);
  return new WorkflowFailure("This change was not confirmed. Retry the same request to check its outcome safely.",false);
}
export async function workflowRead<T>(name: "studio_newsroom_list"|"studio_partnerships_list", cursor?:WorkflowCursor|null):Promise<WorkflowPage<T>> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const result=await Promise.race([createClient().rpc(name,{p_limit:50,p_before_at:cursor?.at??null,p_before_id:cursor?.id??null}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Your workspace took too long to load. Please refresh.")),20000);})]).finally(()=>{if(timer)clearTimeout(timer);});
  const {data,error}=result;
  if(error){const failure=workflowFailure(error);throw failure.confirmedRejected?failure:new Error("Your workspace could not be loaded. Please try again.");}
  const page=data as WorkflowPage<T>;
  if(!page||!Array.isArray(page.items)||typeof page.has_more!=="boolean"||page.items.length>100||page.has_more&&!page.next_cursor)throw new Error("The workspace response could not be verified. Please refresh.");
  return page;
}
export function toLocalTime(value:string|null):string { if(!value)return "";const date=new Date(value);return Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):""; }
export function toIsoTime(value:string):string|null { if(!value.trim())return null;const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error("Choose a valid date and time.");return date.toISOString(); }
export function parsePostReference(value:string):string|null {if(!value.trim())return null;if(UUID.test(value.trim()))return value.trim();try{const url=new URL(value,typeof window==="undefined"?"https://platinumcircles.com":window.location.origin);if(typeof window!=="undefined"&&url.origin!==window.location.origin)throw new Error();const match=/^\/post\/([0-9a-f-]+)\/?$/i.exec(url.pathname);if(match&&UUID.test(match[1]))return match[1];}catch{}throw new Error("Enter the link to your public Platinum Circles post.");}

// Partnership fees record quoted terms. They never create a payment or payout.
export function quoteDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a valid currency.");
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function quoteToMinor(value: string, currency: string): string | null {
  if (!value.trim()) return null;
  const digits = quoteDigits(currency);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits) throw new Error(`Enter a ${currency} amount with at most ${digits} decimal places.`);
  const minor = (match[1] + (match[2] || "").padEnd(digits, "0")).replace(/^0+(?=\d)/, "");
  if (minor.length > 12 || (minor.length === 12 && minor > "100000000000")) throw new Error("The quoted fee is above the supported limit.");
  return minor;
}
export function quoteInput(value: string | number | null, currency: string): string {
  if (value === null) return "";
  const minor = String(value);
  if (!/^\d+$/.test(minor)) return "";
  const digits = quoteDigits(currency);
  if (!digits) return minor;
  const padded = minor.padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
export function formatQuote(value: string | number | null, currency: string): string {
  if (value === null) return "Not specified";
  const amount = quoteInput(value, currency);
  if (!amount) return "Could not verify amount";
  const [whole, fraction] = amount.split(".");
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
}

export async function workflowReadItem<T>(name: "studio_newsroom_get"|"studio_partnership_get", id: string):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const result=await Promise.race([createClient().rpc(name,{p_id:id}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("This item took too long to open. Please try again.")),20000);})]).finally(()=>{if(timer)clearTimeout(timer);});
  if(result.error){const failure=workflowFailure(result.error);throw failure.confirmedRejected?failure:new Error("This item could not be loaded. Please try again.");}
  if(!result.data||result.data.id!==id||!Number.isInteger(result.data.version))throw new Error("This item could not be verified. Please refresh.");
  return result.data as T;
}
