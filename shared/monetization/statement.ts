import { BALANCE_BUCKETS, validMinor, type BalanceBucket } from './domain';
export type StatementCursor = {created_at:string;id:string};
export type StatementEntry = StatementCursor & {currency:string;amount_minor:string;from:string;to:BalanceBucket};
export type CreatorStatement = {user_id:string;environment:'test'|'live';entries:StatementEntry[];next_cursor:StatementCursor|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cursor=(c:StatementCursor) => c && uuid.test(c.id) && typeof c.created_at==='string' && Number.isFinite(Date.parse(c.created_at));
export function parseCreatorStatement(value:unknown,owner:string):CreatorStatement {
  const s=value as CreatorStatement;
  if(!s || s.user_id!==owner || !['test','live'].includes(s.environment) || !Array.isArray(s.entries) || s.entries.length>100 ||
    !s.entries.every(e=>cursor(e) && /^[A-Z]{3}$/.test(e.currency) && validMinor(e.amount_minor,true) && ['funding',...BALANCE_BUCKETS].includes(e.from as BalanceBucket) && BALANCE_BUCKETS.includes(e.to)) ||
    new Set(s.entries.map(e=>e.id)).size!==s.entries.length || (s.next_cursor!==null && (!cursor(s.next_cursor) || s.entries.length===0 || s.next_cursor.id!==s.entries.at(-1)?.id || s.next_cursor.created_at!==s.entries.at(-1)?.created_at))) throw new Error('Your statement could not be confirmed. Please refresh.');
  return s;
}
