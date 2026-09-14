import type { ReactNode } from 'react';
import { canPerform, type Permission } from '@/lib/permissions';
/** Visual consistency only. Every server action also enforces this policy. */
export default function PermissionGate({ role, permission, children }: { role: string; permission: Permission; children: ReactNode }) {
  return canPerform(role, permission) ? children : null;
}
