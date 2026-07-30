import { redirect } from 'next/navigation';

// The sign-in form lives on the root page, shown whenever there is no
// session. Every redirect('/signin') across the desk lands here and is
// carried home.
export default function SignInBridge() {
  redirect('/');
}