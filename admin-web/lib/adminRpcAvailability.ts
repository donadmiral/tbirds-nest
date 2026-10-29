/** Only classify an explicitly missing RPC, never a network or permission failure. */
export function isMissingAdminRpc(error: { code?: string; message?: string } | null, name: string): boolean {
  if (!error || !['PGRST202', '42883'].includes(error.code ?? '')) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\s*\\(`).test(error.message ?? '');
}
