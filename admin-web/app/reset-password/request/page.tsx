import Link from 'next/link';
import AuthPanel from '@/components/AuthPanel';
import RecoveryForms from '../RecoveryForms';
export const dynamic = 'force-dynamic';
export default function RequestResetPage() {
  return <AuthPanel><h1 className="mb-3 text-xl font-bold">Reset your staff password</h1>
    <p className="mb-5 text-sm">Enter the email used for this Platinum staff account. Your Supabase dashboard or IntoBank sign-in may be a different account. Open the reset email in this same browser within ten minutes.</p>
    <RecoveryForms mode="request" /><Link href="/" className="mt-5 inline-block text-sm font-bold underline">Back to sign in</Link>
  </AuthPanel>;
}
