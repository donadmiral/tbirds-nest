import type { Metadata } from 'next';
import { AccountErasure } from '@/components/AccountErasure';
export const metadata: Metadata = { title: 'Account deletion status', robots: { index: false, follow: false } };
export default function AccountDeletionPage() { return <main className="min-h-screen bg-surface py-10"><AccountErasure /></main>; }
