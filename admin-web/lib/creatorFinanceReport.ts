import {
  ENROLLMENT_LABELS,
  PAYOUT_LABELS,
  validMinor,
  type EnrollmentStatus,
  type PayoutStatus,
} from '../../shared/monetization/domain';

export type CreatorFinanceSearch = Record<string, string | string[] | undefined>;
export type CreatorFinanceCursor = { updated_at: string; user_id: string };
export type CreatorEnrollment = {
  user_id: string;
  status: EnrollmentStatus;
  accepted_terms_version: string | null;
  public_reason: string | null;
  updated_at: string;
};
export type CreatorPayout = {
  id: string;
  user_id: string;
  currency: string;
  amount_minor: string;
  environment: 'test' | 'live';
  status: PayoutStatus;
  provider_reference: string | null;
  last_error: string | null;
  created_at: string;
};
export type CreatorFinanceReport = {
  environment: 'test' | 'live';
  enrollment_open: boolean;
  enrollments: CreatorEnrollment[];
  payouts: CreatorPayout[];
  next_cursor: CreatorFinanceCursor | null;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length <= 10000);
const environment = (value: unknown): value is 'test' | 'live' => value === 'test' || value === 'live';
const knownEnrollment = (value: unknown): value is EnrollmentStatus => typeof value === 'string' && Object.hasOwn(ENROLLMENT_LABELS, value);
const knownPayout = (value: unknown): value is PayoutStatus => typeof value === 'string' && Object.hasOwn(PAYOUT_LABELS, value);

/** Preserve the database's microseconds. Reformatting a cursor through Date can skip records. */
export function creatorFinanceCursor(search: CreatorFinanceSearch): { valid: boolean; cursor: CreatorFinanceCursor | null } {
  if (search.before_at === undefined && search.before_id === undefined) return { valid: true, cursor: null };
  if (!timestamp(search.before_at) || !uuid(search.before_id)) return { valid: false, cursor: null };
  return { valid: true, cursor: { updated_at: search.before_at, user_id: search.before_id } };
}

export function creatorFinanceHref(cursor: CreatorFinanceCursor | null): string {
  return cursor ? '/payments/creators?' + new URLSearchParams({ before_at: cursor.updated_at, before_id: cursor.user_id }).toString() : '/payments/creators';
}

/** Reject an incomplete financial response instead of presenting missing records as zero. */
export function parseCreatorFinanceReport(value: unknown): CreatorFinanceReport {
  if (!object(value) || !environment(value.environment) || typeof value.enrollment_open !== 'boolean' ||
    !Array.isArray(value.enrollments) || value.enrollments.length > 50 ||
    !Array.isArray(value.payouts) || value.payouts.length > 50) throw new Error('INVALID_FINANCE_REPORT');
  const enrollments: CreatorEnrollment[] = value.enrollments.map((entry: unknown) => {
    if (!object(entry) || !uuid(entry.user_id) || !knownEnrollment(entry.status) ||
      !nullableText(entry.accepted_terms_version) || !nullableText(entry.public_reason) || !timestamp(entry.updated_at)) {
      throw new Error('INVALID_FINANCE_REPORT');
    }
    return { user_id: entry.user_id, status: entry.status, accepted_terms_version: entry.accepted_terms_version, public_reason: entry.public_reason, updated_at: entry.updated_at };
  });
  const payouts: CreatorPayout[] = value.payouts.map((entry: unknown) => {
    if (!object(entry) || !uuid(entry.id) || !uuid(entry.user_id) || typeof entry.currency !== 'string' || !/^[A-Z]{3}$/.test(entry.currency) ||
      !validMinor(entry.amount_minor, true) || !environment(entry.environment) || !knownPayout(entry.status) ||
      !nullableText(entry.provider_reference) || !nullableText(entry.last_error) || !timestamp(entry.created_at)) {
      throw new Error('INVALID_FINANCE_REPORT');
    }
    return { id: entry.id, user_id: entry.user_id, currency: entry.currency, amount_minor: entry.amount_minor, environment: entry.environment, status: entry.status, provider_reference: entry.provider_reference, last_error: entry.last_error, created_at: entry.created_at };
  });
  if (new Set(enrollments.map(entry => entry.user_id)).size !== enrollments.length || new Set(payouts.map(entry => entry.id)).size !== payouts.length) {
    throw new Error('INVALID_FINANCE_REPORT');
  }
  let nextCursor: CreatorFinanceCursor | null = null;
  if (value.next_cursor !== null) {
    const cursor = value.next_cursor;
    const last = enrollments.at(-1);
    if (!object(cursor) || !uuid(cursor.user_id) || !timestamp(cursor.updated_at) || !last ||
      cursor.user_id !== last.user_id || cursor.updated_at !== last.updated_at) throw new Error('INVALID_FINANCE_REPORT');
    nextCursor = { user_id: cursor.user_id, updated_at: cursor.updated_at };
  }
  return { environment: value.environment, enrollment_open: value.enrollment_open, enrollments, payouts, next_cursor: nextCursor };
}

export function creatorFinanceDate(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}

export function creatorFinanceFailure(message: unknown): { message: string; href: string; action: string } {
  if (message === 'MFA_REQUIRED') return { message: 'Verify your staff sign-in to open creator finance records.', href: '/security', action: 'Verify sign-in' };
  if (message === 'ACTIVE_FINANCE_SESSION_REQUIRED') return { message: 'Your finance session is no longer active. Sign in again to continue.', href: '/', action: 'Sign in again' };
  return { message: 'Creator finance records could not be confirmed. Reload this page to try again.', href: '/payments/creators', action: 'Retry' };
}
