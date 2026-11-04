/** Supabase and browser APIs can reject with plain objects as well as Errors. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

/** IDs returned by the create-community and create-channel RPC contracts. */
export function createdId(value: unknown): string | null {
  const id = typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? value.id : null;
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** Distinguish confirmed authorization loss from a retryable read failure. */
export function isAccessDeniedError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; context?: { status?: unknown } };
  if ([error.status, error.statusCode, error.context?.status].some(status => status === 401 || status === 403 || status === "401" || status === "403")) return true;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (/^(42501|PGRST30[123]|AUTH_REQUIRED|ACCESS_DENIED|UNAUTHORIZED|FORBIDDEN)$/i.test(code)) return true;
  if (/^(AUTH_REQUIRED|ACCESS_DENIED|UNAUTHORIZED|FORBIDDEN)$/i.test(message.trim())) return true;
  // Some existing media readers remove the transport status. Their ambiguous
  // authorization failure must still clear private media, never imply access.
  return /permission denied|access denied|not authorized|unauthorized|forbidden|sign in again|account changed|JWT (?:expired|invalid)|Media (?:could not be loaded|access expired)/i.test(message);
}
