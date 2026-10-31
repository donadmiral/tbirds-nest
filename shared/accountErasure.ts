export type ErasureReceipt = { requestId: string; token: string; userId: string; createdAt: string };
export type ErasureState = 'queued' | 'erasing' | 'retry' | 'identity_pending' | 'retention_review' | 'completed';
export type ErasureStatus = {
  requestId: string; state: ErasureState; reason: string | null;
  requestedAt: string; updatedAt: string; completedAt: string | null;
  filesTotal: number; filesErased: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set(['queued', 'erasing', 'retry', 'identity_pending', 'retention_review', 'completed']);
export function parseErasureReceipt(value: string | null): ErasureReceipt | null {
  if (!value) return null;
  try {
    const receipt = JSON.parse(value) as ErasureReceipt;
    return UUID.test(receipt?.requestId) && UUID.test(receipt?.userId)
      && /^[0-9a-f]{64}$/.test(receipt?.token) && Number.isFinite(Date.parse(receipt?.createdAt)) ? receipt : null;
  } catch { return null; }
}
export function parseErasureStatus(value: unknown, requestId: string): ErasureStatus | null {
  if (value === null) return null;
  const status = value as ErasureStatus;
  if (!status || status.requestId !== requestId || !states.has(status.state)
    || !Number.isInteger(status.filesTotal) || status.filesTotal < 0
    || !Number.isInteger(status.filesErased) || status.filesErased < 0 || status.filesErased > status.filesTotal
    || !Number.isFinite(Date.parse(status.requestedAt)) || !Number.isFinite(Date.parse(status.updatedAt))
    || (status.state === 'completed') !== (typeof status.completedAt === 'string' && Number.isFinite(Date.parse(status.completedAt)))) {
    throw new Error('Deletion status could not be verified. Please refresh the status.');
  }
  return status;
}
export function erasureMessage(status: ErasureStatus): { title: string; detail: string } {
  if (status.state === 'completed') return {
    title: 'Account deletion completed',
    detail: 'Your account, app records and the stored files covered by this request have been erased. Copies already downloaded by other people or their devices cannot be recalled.',
  };
  if (status.state === 'retention_review') return {
    title: 'Deletion needs review',
    detail: status.reason === 'financial_records'
      ? 'Your account is disabled. Payment or transaction records need a retention review before deletion can finish. This request has not been marked complete.'
      : status.reason === 'managed_account'
        ? 'Your account is disabled. Staff, business or organization responsibilities need review before deletion can finish. This request has not been marked complete.'
        : 'Your account is disabled. Some files or records need a support review before deletion can finish. This request has not been marked complete.',
  };
  if (status.state === 'retry') return {
    title: 'Deletion is retrying',
    detail: 'Your account is disabled. A service was unavailable, so deletion will resume automatically. Files and account deletion are still being checked.',
  };
  if (status.state === 'identity_pending') return {
    title: 'Finishing account deletion',
    detail: 'The stored files and app records have been processed. Your sign-in account is being removed and verified.',
  };
  return {
    title: status.state === 'queued' ? 'Deletion requested' : 'Deleting stored files',
    detail: 'Your account is disabled. Stored files are removed first, then your account records. You can check this request from the sign-in screen on this device.',
  };
}
function errorMessage(value: unknown): string {
  const message = typeof value === 'object' && value ? String((value as { message?: unknown }).message || '') : '';
  if (/TEMPORARILY_UNAVAILABLE|PGRST202/.test(message)) return 'Account deletion is temporarily unavailable. Your request has not been confirmed. Please try again later.';
  if (/SESSION_REQUIRED|AUTH_REQUIRED/.test(message)) return 'Sign in again before requesting account deletion.';
  if (/ALREADY_REQUESTED/.test(message)) return 'A deletion request already exists. Check its saved status or contact support with your request number.';
  return 'The deletion request could not be confirmed. Check its status before trying again.';
}
async function rpc(base: string, key: string, authorization: string, name: string, receipt: ErasureReceipt, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(`${base.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_request_id: receipt.requestId, p_receipt_token: receipt.token }),
      signal: controller.signal, cache: 'no-store',
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body));
    return parseErasureStatus(body, receipt.requestId);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The connection timed out. Your request may have been accepted; check its saved status.');
    throw error;
  } finally { clearTimeout(timer); }
}
export function readAccountErasure(base: string, key: string, receipt: ErasureReceipt, fetcher: typeof fetch = fetch) {
  // A separate anonymous request keeps the receipt usable after logout, expired
  // tokens and final Auth deletion. The receipt grants only this minimal status.
  return rpc(base, key, key, 'account_erasure_status', receipt, fetcher);
}
export async function sendAccountErasure(base: string, key: string, capturedJwt: string, receipt: ErasureReceipt, fetcher: typeof fetch = fetch) {
  try {
    const status = await rpc(base, key, capturedJwt, 'request_account_erasure', receipt, fetcher);
    if (!status) throw new Error('Deletion was not confirmed. Check your request status.');
    return status;
  } catch (error) {
    // A lost response must not cause a fresh request or an incorrect failure
    // claim. The caller persisted this exact receipt before making the write.
    try { const status = await readAccountErasure(base, key, receipt, fetcher); if (status) return status; } catch { /* Keep the recoverable receipt. */ }
    throw error;
  }
}
