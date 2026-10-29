export type VerificationTier = 'public_figure' | 'business' | 'official';
export type VerificationApplication = { status: string; tier: string; decision_reason?: string | null; created_at?: string };
export type VerificationProfile = { is_verified?: boolean | null; verified_tier?: string | null; account_type?: string | null };

export function safeEvidenceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function prepareVerificationEvidence(tier: VerificationTier, category: string | null, statement: string, links: string, office: string) {
  const urls = links.split('\n').map(link => link.trim()).filter(Boolean);
  const text = statement.trim();
  if (tier === 'public_figure' && !category) throw new Error('Choose the category that fits you.');
  if (text.length < 20 || text.length > 2000) throw new Error('Explain your identity and work in 20–2,000 characters.');
  if (!urls.length || urls.length > 8) throw new Error('Add 1–8 public links that establish your identity or organisation.');
  if (urls.some(link => !safeEvidenceUrl(link))) throw new Error('Use complete http:// or https:// links without spaces or login details.');
  if (tier === 'official' && (office.trim().length < 3 || office.trim().length > 200)) throw new Error('State your office or position in 3–200 characters.');
  return { statement: text, links: [...new Set(urls)], ...(tier === 'official' ? { office: office.trim() } : {}) };
}

export function currentVerificationStatus(application: VerificationApplication | null, profile: VerificationProfile | null): string | null {
  if (profile?.is_verified) return 'approved';
  return application?.status === 'approved' ? 'revoked' : application?.status ?? null;
}

export function verificationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '');
  const friendly: Record<string, string> = {
    VERIFICATION_ALREADY_PENDING: 'An application is already under review. Refresh to see its status.',
    VERIFICATION_ALREADY_ACTIVE: 'This account is already verified. Refresh to see its status.',
    VERIFICATION_ACCOUNT_UNAVAILABLE: 'This account cannot apply right now. Contact support.',
    VERIFICATION_ACCOUNT_TYPE_MISMATCH: 'Your account type changed. Refresh before applying.',
    VERIFICATION_STAFF_REVIEW_REQUIRED: 'Verification decisions must be made by the review team.',
    VERIFICATION_REVIEW_BASIS_REQUIRED: 'Record how identity and authority were independently checked (20–2,000 characters).',
    VERIFICATION_EVIDENCE_LINK_REQUIRED: 'Add 1–8 public evidence links.',
    VERIFICATION_EVIDENCE_URL_INVALID: 'Use complete http:// or https:// evidence links.',
    VERIFICATION_STATEMENT_REQUIRED: 'Write a statement of 20–2,000 characters.',
    VERIFICATION_OFFICE_REQUIRED: 'State the official office or position.',
  };
  return friendly[message] || message || 'Verification could not be loaded. Please try again.';
}
