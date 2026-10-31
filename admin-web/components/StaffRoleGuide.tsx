'use client';

import { useEffect, useRef, useState } from 'react';
import AdminIcon from '@/components/AdminIcon';
import { STAFF_ROLES, allowedDesks, canPerform, type Permission } from '@/lib/permissions';
import { GROUPS } from '@/lib/navigation';
import { trapDialogTab } from '@/lib/dialogFocus';

const capabilities: { key: Permission; label: string }[] = [
  { key: 'verification', label: 'Decide verification applications' },
  { key: 'user_moderate', label: 'Moderate member accounts' },
  { key: 'post_moderate', label: 'Moderate posts and stories' },
  { key: 'market_moderate', label: 'Moderate marketplace listings' },
  { key: 'report_post', label: 'Decide post reports' },
  { key: 'report_listing', label: 'Decide listing and seller-review reports' },
  { key: 'report_user', label: 'Decide account reports' },
  { key: 'support', label: 'Assign and answer support tickets' },
  { key: 'ads', label: 'Review advertising' },
  { key: 'system', label: 'Change platform controls' },
  { key: 'business_manage', label: 'Provision business accounts' },
  { key: 'organization_manage', label: 'Manage organizations' },
  { key: 'staff_manage', label: 'Manage staff and roles' },
  { key: 'account_delete', label: 'Review account erasure' },
  { key: 'comment_delete', label: 'Remove comments' },
];
const roleLabel = (role: string) => role.replaceAll('_', ' ').replace(/\b\w/g, value => value.toUpperCase());

export default function StaffRoleGuide() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('auditor_readonly');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLSelectElement>(null);
  const desks = allowedDesks(role);
  const allowed = capabilities.filter(capability => canPerform(role, capability.key));
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const node = dialog.current;
    const triggerNode = trigger.current;
    const overflow = document.body.style.overflow;
    node?.showModal();
    document.body.style.overflow = 'hidden';
    field.current?.focus();
    return () => { node?.close(); document.body.style.overflow = overflow; triggerNode?.focus({ preventScroll: true }); };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="pc-button" onClick={() => setOpen(true)} aria-haspopup="dialog"><AdminIcon name="security" size={18} />Review role access</button>
    <dialog ref={dialog} className="pc-tools-dialog pc-role-dialog" aria-label="Staff role access" onClose={() => setOpen(false)} onKeyDown={trapDialogTab} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <header className="pc-tools-heading"><div><span className="pc-eyebrow">Staff governance</span><h2>Review role access</h2><p>Compare the permissions before assigning a role.</p></div><button className="pc-button pc-button-square" type="button" aria-label="Close role access" onClick={() => setOpen(false)}><AdminIcon name="close" /></button></header>
      <div className="pc-role-select"><label htmlFor="pc-role-guide">Role</label><select id="pc-role-guide" ref={field} value={role} onChange={event => setRole(event.target.value)}>{[...STAFF_ROLES].map(item => <option key={item} value={item}>{roleLabel(item)}</option>)}</select></div>
      <div className="pc-tools-content pc-role-content">
        <section><h3>Available desks · {desks.size}</h3><ul className="pc-role-desks">{GROUPS.flatMap(group => group.items).filter(item => desks.has(item.href)).map(item => <li key={item.href}><AdminIcon name={item.icon} size={18} /><span>{item.label}</span></li>)}</ul></section>
        <section><h3>Operational decisions · {allowed.length}</h3>{allowed.length ? <ul className="pc-role-capabilities">{allowed.map(item => <li key={item.key}><AdminIcon name="check" size={17} />{item.label}</li>)}</ul> : <p className="pc-role-readonly"><AdminIcon name="eye" size={21} />This role has no moderation, provisioning or platform-control decisions in the operations policy.</p>}</section>
      </div>
      <footer className="pc-tools-footer"><AdminIcon name="info" size={17} /><span>This guide does not change access. Each operation also checks the current staff session and record permissions.</span></footer>
    </dialog>
  </>;
}
