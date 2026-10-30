import type { AdminIconName } from '@/components/AdminIcon';
import { allowedDesks, canPerform, type Permission } from './permissions';

export type NavigationItem = { href: string; label: string; icon: AdminIconName; key: string; description: string; parent?: string; desk?: string; permission?: Permission };
export type NavigationGroup = { label: string; items: NavigationItem[] };

/** Destinations are real pages. This list never grants permission to open them. */
export const GROUPS: NavigationGroup[] = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', key: 'D', icon: 'dashboard', description: 'Activity, work queues and recent platform changes.' },
    { href: '/analytics', label: 'Analytics', key: 'A', icon: 'analytics', description: 'Explore activity, engagement and reported growth.' },
    { href: '/calls', label: 'Calls', key: 'C', icon: 'phone', description: 'Inspect call records and delivery quality.' },
  ] },
  { label: 'Community', items: [
    { href: '/users', label: 'Users', key: 'U', icon: 'users', description: 'Find accounts and review their current status.' },
    { href: '/businesses', label: 'Businesses', key: 'B', icon: 'business', description: 'Review applications and manage business accounts.' },
    { href: '/organizations', label: 'Organizations', key: 'G', icon: 'organization', description: 'Review ownership, members and agency relationships.' },
  ] },
  { label: 'Commerce', items: [
    { href: '/market', label: 'Market', key: 'M', icon: 'market', description: 'Review listings and marketplace activity.' },
    { href: '/jobs', label: 'Jobs', key: 'J', icon: 'jobs', description: 'Review roles and recruiting activity.' },
    { href: '/payments', label: 'Payments', key: 'Y', icon: 'payment', description: 'Inspect payment records and reconciliation.' },
    { href: '/ads', label: 'Ads Manager', key: 'V', icon: 'ads', description: 'Review campaigns, advertising status and delivery.' },
  ] },
  { label: 'Content', items: [
    { href: '/content', label: 'Posts', key: 'P', icon: 'content', description: 'Inspect published posts, media and conversations.' },
    { href: '/stories', label: 'Stories', key: 'O', icon: 'stories', description: 'Review stories and their media in context.' },
  ] },
  { label: 'Moderation', items: [
    { href: '/reports', label: 'Reports', key: 'R', icon: 'reports', description: 'Review reports with evidence and recorded decisions.' },
    { href: '/queue', label: 'Verification', key: 'Q', icon: 'verification', description: 'Assess submitted verification applications.' },
    { href: '/support', label: 'Support', key: 'S', icon: 'support', description: 'Assign tickets, reply and follow resolution.' },
    { href: '/audit', label: 'Audit log', key: 'L', icon: 'audit', description: 'Review the recorded history of staff actions.' },
  ] },
  { label: 'System', items: [
    { href: '/staff', label: 'Staff', key: 'F', icon: 'staff', description: 'Manage staff accounts, roles and access.' },
    { href: '/system', label: 'Controls', key: 'W', icon: 'controls', description: 'Manage availability, announcements and blocked phrases.' },
  ] },
];

export const RELATED_DESTINATIONS: NavigationItem[] = [
  { href: '/users/deletions', label: 'Deletion requests', key: 'E', icon: 'deletion', description: 'Review retention holds and verified account erasure.', parent: '/users', desk: '/users', permission: 'account_delete' },
  { href: '/market/orders', label: 'Orders & disputes', key: 'T', icon: 'order', description: 'Investigate orders, fulfillment, returns and payment receipts.', parent: '/market', desk: '/market' },
  { href: '/market/reviews', label: 'Seller review reports', key: 'H', icon: 'review', description: 'Review reported seller feedback and moderation history.', parent: '/reports', desk: '/reports', permission: 'report_listing' },
  { href: '/payments/creators', label: 'Creator finance', key: 'I', icon: 'payment', description: 'Review creator enrollment and payout records when available.', parent: '/payments', desk: '/payments' },
];

export const WORKSPACE_TOOLS: NavigationItem[] = [
  { href: '/present', label: 'Presentation builder', key: 'N', icon: 'presentation', description: 'Arrange collected charts, tables and review notes.', desk: '/dashboard' },
  { href: '/security?setup=1', label: 'Account security', key: 'K', icon: 'security', description: 'Open your staff authenticator setup.', desk: '/dashboard' },
];

type QuickAction = { href: string; desk: string; label: string; icon: AdminIconName; permission?: Permission };
export const ACTIONS: QuickAction[] = [
  { href: '/queue', desk: '/queue', label: 'Review verification queue', icon: 'verification', permission: 'verification' },
  { href: '/reports', desk: '/reports', label: 'Review open reports', icon: 'reports' },
  { href: '/support', desk: '/support', label: 'Answer support tickets', icon: 'support', permission: 'support' },
  { href: '/users', desk: '/users', label: 'Find a member', icon: 'users' },
  { href: '/system#announcements', desk: '/system', label: 'Publish an announcement', icon: 'ads', permission: 'system' },
  { href: '/staff#staff-invite', desk: '/staff', label: 'Add a staff member', icon: 'staff', permission: 'staff_manage' },
];

export function navigationForRole(role: string): NavigationGroup[] {
  const allowed = allowedDesks(role);
  return GROUPS.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.href)).flatMap(item => [item, ...RELATED_DESTINATIONS.filter(child => child.parent === item.href && allowed.has(child.desk!) && (!child.permission || canPerform(role, child.permission)))]) })).filter(group => group.items.length > 0);
}

export function toolsForRole(role: string): NavigationItem[] {
  const allowed = allowedDesks(role);
  return WORKSPACE_TOOLS.filter(item => allowed.has(item.desk!));
}

export function actionsForRole(role: string): QuickAction[] {
  const allowed = allowedDesks(role);
  return ACTIONS.filter(action => allowed.has(action.desk) && (!action.permission || canPerform(role, action.permission)));
}

export function routePath(href: string): string { return href.split(/[?#]/, 1)[0]; }

/** The longest permitted route wins, so nested desks select their own destination. */
export function matchingDestination(pathname: string, items: { href: string }[]): string | undefined {
  return items.filter(item => pathname === routePath(item.href) || pathname.startsWith(routePath(item.href) + '/')).sort((a, b) => routePath(b.href).length - routePath(a.href).length)[0]?.href;
}
