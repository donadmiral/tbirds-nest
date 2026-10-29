import Link from 'next/link';
import AuthPanel from '@/components/AuthPanel';
import { recoveryView } from '@/lib/adminRecovery';
import RecoveryForms from './RecoveryForms';
export const dynamic = 'force-dynamic';
export default async function ResetPasswordPage() {
  const state = await recoveryView();
  return <AuthPanel><h1 className="mb-3 text-xl font-bold">{state?.needsMfa ? 'Verify your authenticator' : 'Choose a new password'}</h1>
    {!state ? <><p role="alert" className="text-sm">This reset link is missing, expired, or could not be verified. Open the newest email in the same browser that requested it.</p><Link href="/reset-password/request" className="mt-5 inline-block font-bold underline">Request a new reset link</Link></>
      : state.unsupportedMfa ? <p role="alert" className="text-sm">This account uses a security factor that this admin recovery screen cannot verify. Contact your administrator for account recovery; your existing security factor will not be removed here.</p>
      : <><p className="mb-5 text-sm">{state.needsMfa ? 'Your existing authenticator protects this password change. Recovery does not remove two-factor authentication.' : 'This changes only the staff password in the environment shown above. You will sign in again after saving.'}</p><RecoveryForms mode={state.needsMfa ? 'mfa' : 'password'} factors={state.factors} /></>}
    <Link href="/" className="mt-5 block text-sm font-bold underline">Back to sign in</Link>
  </AuthPanel>;
}
