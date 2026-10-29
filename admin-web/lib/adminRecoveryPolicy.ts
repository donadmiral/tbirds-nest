type Environment = Record<string, string | undefined>;

export function authEnvironment(url: string | undefined) {
  let projectHost = '';
  try { projectHost = new URL(url || '').hostname; } catch { /* Configuration is shown as unverified. */ }
  if (projectHost === 'uaulhuelcfkjwojtymmw.supabase.co') return {
    label: 'QA test environment', projectHost,
    detail: 'Use your Platinum QA staff account. Test accounts and passwords are separate from the live app.',
  };
  if (projectHost === 'prlkikhckbifseosbukl.supabase.co') return {
    label: 'Production', projectHost, detail: 'Use your live Platinum staff account.',
  };
  return { label: 'Unverified environment', projectHost, detail: 'Check this environment with your administrator before signing in.' };
}

/** Exact trusted origins only: neither form input nor Host can choose an email destination. */
export function trustedAuthOrigin(candidate: string | undefined | null, env: Environment): string | null {
  const normalize = (value: string | undefined | null) => {
    if (!value || /[\\*\s]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (local ? env.NODE_ENV !== 'development' : url.protocol !== 'https:') return null;
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
      return url.origin;
    } catch { return null; }
  };
  const origin = normalize(candidate);
  if (!origin) return null;
  const explicit = (env.ADMIN_AUTH_ORIGINS || '').split(',').map(value => normalize(value.trim())).filter(Boolean);
  const vercel = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean).map(host => normalize('https://' + host));
  const allowed = new Set([...explicit, ...vercel]);
  if (env.VERCEL_ENV === 'production') allowed.add('https://admin.platinumcircles.app');
  if (env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return origin;
  return allowed.has(origin) ? origin : null;
}

export const signInErrors: Record<string, string> = {
  credentials: 'We could not sign you in to this environment. Check your staff email and password, or use Forgot password for this environment.',
  access: 'This account does not have active staff access in this environment. Contact your administrator.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
};
