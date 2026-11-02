import 'server-only';
import type { serviceClient } from './supabaseAdmin';

type Profiles = {
  members: number;
  businesses: number;
  verified: number;
  business_verified: number;
  active: number;
  located: number;
  locations: { label: string; n: number }[];
};
type WeeklySeries = { series: number[]; week: number; previous_week: number };
export type DashboardOverview = {
  profiles: Profiles;
  reports: WeeklySeries;
  verifications: WeeklySeries & { total: number; reached_review: number; approved: number; rejected: number };
};
export type AnalyticsOverview = {
  profiles: Profiles;
  tiers: { key: string; n: number }[];
  cohorts: { week: string; size: number; kept: number[] }[];
};
type Client = Pick<ReturnType<typeof serviceClient>, 'rpc'>;
type Row = Record<string, unknown>;

function invalid(): never { throw new Error('Complete overview statistics could not be confirmed.'); }
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Row;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid();
  return value;
}
function series(value: unknown): WeeklySeries {
  const data = row(value);
  const values = list(data.series, 30).map(count);
  if (values.length !== 30) return invalid();
  return { series: values, week: count(data.week), previous_week: count(data.previous_week) };
}

export function loadAdminOverview(client: Client, scope: 'dashboard', now: number): Promise<DashboardOverview>;
export function loadAdminOverview(client: Client, scope: 'analytics', now: number): Promise<AnalyticsOverview>;
export async function loadAdminOverview(client: Client, scope: 'dashboard' | 'analytics', now: number): Promise<DashboardOverview | AnalyticsOverview> {
  const asOf = new Date(now).toISOString();
  const { data, error } = await client.rpc('admin_overview_summary', { p_as_of: asOf, p_scope: scope });
  if (error) throw new Error('Overview statistics could not be loaded.');
  const result = row(data);
  if (result.version !== 1 || typeof result.as_of !== 'string' || Date.parse(result.as_of) !== now) return invalid();
  const p = row(result.profiles);
  const profiles: Profiles = {
    members: count(p.members), businesses: count(p.businesses), verified: count(p.verified),
    business_verified: count(p.business_verified), active: count(p.active), located: count(p.located),
    locations: list(p.locations, 8).map(value => {
      const location = row(value);
      if (typeof location.label !== 'string' || !location.label) return invalid();
      return { label: location.label, n: count(location.n) };
    }),
  };
  if (scope === 'dashboard') {
    const applications = row(result.verifications);
    return {
      profiles, reports: series(result.reports),
      verifications: {
        ...series(applications), total: count(applications.total), reached_review: count(applications.reached_review),
        approved: count(applications.approved), rejected: count(applications.rejected),
      },
    };
  }
  return {
    profiles,
    tiers: list(result.tiers, 100).map(value => {
      const tier = row(value);
      if (typeof tier.key !== 'string' || !tier.key) return invalid();
      return { key: tier.key, n: count(tier.n) };
    }),
    cohorts: list(result.cohorts, 1000).map(value => {
      const cohort = row(value);
      if (typeof cohort.week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cohort.week) || !Number.isFinite(Date.parse(cohort.week))) return invalid();
      const kept = list(cohort.kept, 4).map(count);
      const size = count(cohort.size);
      if (kept.length !== 4 || kept.some(n => n > size)) return invalid();
      return { week: cohort.week, size, kept };
    }),
  };
}
