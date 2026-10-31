'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminIcon from '@/components/AdminIcon';
import { matchingDestination, routePath, type NavigationItem } from '@/lib/navigation';

export function WorkspaceBreadcrumbs({ items, active, label }: { items: NavigationItem[]; active: string; label: string }) {
  const pathname = usePathname();
  const selected = items.find(item => item.href === matchingDestination(pathname, items));
  const parent = items.find(item => item.href === (selected?.parent || active));
  const trail: { label: string; href?: string }[] = [{ label: 'Operations', href: '/dashboard' }];
  if (parent && parent.href !== '/dashboard') trail.push({ label: parent.label, href: parent.href });
  if (selected?.parent) trail.push({ label: selected.label, href: selected.href });
  if (label && trail.at(-1)?.label !== label) trail.push({ label });
  else if (trail.length > 1) delete trail[trail.length - 1].href;
  return <nav className="pc-breadcrumb" aria-label="Breadcrumb"><ol>{trail.map((item, index) => <li key={`${index}:${item.label}`}>{index > 0 ? <AdminIcon name="chevronRight" size={13} /> : null}{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>;
}

export function WorkspaceContext({ items, active }: { items: NavigationItem[]; active: string }) {
  const pathname = usePathname();
  const selected = items.find(item => item.href === matchingDestination(pathname, items));
  const parent = items.find(item => item.href === (selected?.parent || active));
  const related = items.filter(item => item.href === parent?.href || item.parent === parent?.href);
  const nested = pathname !== active && pathname !== routePath(selected?.href || active);
  const returnTo = nested ? selected || parent : selected?.parent ? parent : undefined;
  if (related.length < 2 && !returnTo) return null;
  return <div className="pc-workspace-context">
    {returnTo ? <Link className="pc-context-back" href={returnTo.href}><AdminIcon name="arrowLeft" size={17} /><span>Back to {returnTo.label}</span></Link> : null}
    {related.length > 1 ? <nav aria-label={`${parent?.label || 'Desk'} sections`} className="pc-context-tabs">{related.map(item => <Link key={item.href} href={item.href} aria-current={(selected?.href || active) === item.href ? 'page' : undefined}><AdminIcon name={item.icon} size={16} />{item.label}</Link>)}</nav> : null}
  </div>;
}
