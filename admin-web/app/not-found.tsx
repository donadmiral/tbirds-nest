import Link from 'next/link';
import AdminIcon from '@/components/AdminIcon';

export default function NotFound() {
  return <main className="pc-page-recovery"><section className="pc-recovery-card"><AdminIcon name="search" size={32} /><h1>This page is unavailable</h1><p>The address may have changed, or the page is not available to your staff role. Your workspace shows the desks you can open.</p><div className="pc-recovery-actions"><Link className="pc-button pc-button-primary" href="/dashboard"><AdminIcon name="arrowLeft" size={18} />Back to operations</Link></div></section></main>;
}
