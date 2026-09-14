/** Shared policy only. Authentication and enforcement live in adminAuth.ts. */
const LEAD = ['super_admin', 'platform_admin'];
export const STAFF_ROLES = new Set([...LEAD, 'trust_safety', 'support_agent', 'ops_engineer', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer', 'finance_admin', 'analyst', 'auditor_readonly']);
export const VERIFICATION_ROLES = new Set([...LEAD, 'verification_reviewer']);
export const ADS_ROLES = new Set([...LEAD, 'market_reviewer', 'finance_admin']);
const ALL_DESKS = ['/dashboard', '/analytics', '/calls', '/queue', '/reports', '/users', '/support', '/market', '/jobs', '/businesses', '/organizations', '/ads', '/content', '/stories', '/payments', '/audit', '/staff', '/system'];
const ROLE_DESKS: Record<string, readonly string[]> = {
  super_admin: ALL_DESKS,
  platform_admin: ALL_DESKS.filter(d => d !== '/staff'),
  trust_safety: ['/dashboard', '/reports', '/users', '/support', '/content', '/stories', '/audit'],
  support_agent: ['/dashboard', '/support', '/users', '/audit'],
  ops_engineer: ['/dashboard', '/system', '/analytics', '/calls', '/audit'],
  market_reviewer: ['/dashboard', '/market', '/businesses', '/ads', '/payments', '/reports', '/audit'],
  jobs_reviewer: ['/dashboard', '/jobs', '/audit'],
  verification_reviewer: ['/dashboard', '/queue', '/users', '/audit'],
  finance_admin: ['/dashboard', '/payments', '/ads', '/audit'],
  analyst: ['/dashboard', '/analytics', '/audit'],
  auditor_readonly: ['/dashboard', '/analytics', '/audit'],
};
export function allowedDesks(role: string): Set<string> {
  return new Set(Object.hasOwn(ROLE_DESKS, role) ? ROLE_DESKS[role] : []);
}
export function canOpen(role: string, desk: string): boolean {
  return allowedDesks(role).has(desk);
}
export function hasFullOverview(role: string): boolean { return LEAD.includes(role); }
const ACTION_ROLES = {
  verification: [...VERIFICATION_ROLES],
  user_moderate: [...LEAD, 'trust_safety'],
  post_moderate: [...LEAD, 'trust_safety'],
  market_moderate: [...LEAD, 'market_reviewer'],
  report_post: [...LEAD, 'trust_safety'],
  report_listing: [...LEAD, 'trust_safety', 'market_reviewer'],
  report_user: [...LEAD, 'trust_safety'],
  support: [...LEAD, 'trust_safety', 'support_agent'],
  ads: [...ADS_ROLES],
  system: [...LEAD, 'ops_engineer'],
  business_manage: ['super_admin'],
  organization_manage: ['super_admin'],
  staff_manage: ['super_admin'],
  account_delete: ['super_admin'],
  comment_delete: ['super_admin'],
} satisfies Record<string, readonly string[]>;
export type Permission = keyof typeof ACTION_ROLES;
export function canPerform(role: string, permission: Permission): boolean {
  return Object.hasOwn(ACTION_ROLES, permission) && (ACTION_ROLES[permission] as readonly string[]).includes(role);
}
