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
