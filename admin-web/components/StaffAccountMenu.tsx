'use client';

import Link from 'next/link';
import ActionPopover from '@/components/ActionPopover';
import AdminIcon from '@/components/AdminIcon';

export default function StaffAccountMenu({ email, role, signOut }: {
  email: string; role: string; signOut: (data: FormData) => void | Promise<void>;
}) {
  const name = email.split('@')[0] || 'Staff';
  return <div className="pc-account-control"><ActionPopover label="Your staff account" trigger={<><span className="pc-account-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="pc-account-name">{name}</span><AdminIcon name="chevronDown" size={15} /></>}>
    {close => <>
      <div className="pc-account-summary"><strong>{email}</strong><span>{role.replaceAll('_', ' ')}</span></div>
      <Link href="/security?setup=1" className="pc-popover-action" onClick={close}><AdminIcon name="security" size={18} />Account security</Link>
      <Link href="/present" className="pc-popover-action" onClick={close}><AdminIcon name="presentation" size={18} />Presentation builder</Link>
      <div className="pc-popover-divider" />
      <form action={signOut}><button type="submit" className="pc-popover-action"><AdminIcon name="logout" size={18} />Sign out of operations</button></form>
    </>}
  </ActionPopover></div>;
}
