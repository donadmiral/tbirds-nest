import { redirect } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import PresentBuilder from '@/components/PresentBuilder';

/**
 * The builder is a desk tool, not a desk. It carries no rail and no topbar so
 * the slides own the screen, and it still refuses anyone without a seat.
 */
export default async function PresentPage() {
  const admin = await requireDesk('/dashboard');
  return <PresentBuilder by={admin.email} role={admin.role} env="Production" />;
}
