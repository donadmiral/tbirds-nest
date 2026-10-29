type RetryStore = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type StudioDraftInput = {
  ownerId: string;
  id?: string | null;
  content?: string | null;
  body?: string | null;
  category?: string | null;
  community?: string | null;
  media?: unknown[];
  products?: unknown[];
  publishAt?: string | null;
};

/** Persist the identity before issuing a new save. A timeout retains it, while
 * a confirmed ID or changed payload permits a new creation. Existing drafts
 * always update their known server ID through the original compatible RPC. */
export async function saveStudioDraft(client: RpcClient, input: StudioDraftInput, storage: RetryStore, createId: () => string): Promise<string> {
  if (!input.ownerId) throw new Error('Sign in to save this draft.');
  const args = {
    p_content: input.content ?? null, p_body: input.body ?? null,
    p_category: input.category ?? null, p_community: input.community ?? null,
    p_media: input.media ?? [], p_products: input.products ?? [], p_publish_at: input.publishAt ?? null,
  };
  const storageKey = `pc:studio:draft-retry:v1:${input.ownerId}`;
  let requestKey: string | null = null;
  if (!input.id) {
    const payload = JSON.stringify(args);
    let prior: { key?: string; payload?: string } | null = null;
    try { const raw = await storage.getItem(storageKey); if (raw) prior = JSON.parse(raw); }
    catch { throw new Error('Draft recovery is unavailable. Enable device storage and try again.'); }
    requestKey = prior?.payload === payload && typeof prior.key === 'string' ? prior.key : createId();
    await storage.setItem(storageKey, JSON.stringify({ key: requestKey, payload }));
  }
  const { data, error } = input.id
    ? await client.rpc('studio_save_post', { p_id: input.id, ...args })
    : await client.rpc('studio_save_post_once', { p_expected_user: input.ownerId, p_request_key: requestKey, ...args });
  if (error) throw error;
  if (!data || typeof data !== 'string') throw new Error('The draft save was not confirmed. Try again to check the same request.');
  if (requestKey) {
    try {
      const raw = await storage.getItem(storageKey);
      if (raw && JSON.parse(raw)?.key === requestKey) await storage.removeItem(storageKey);
    } catch { /* The confirmed server ID takes precedence over local cleanup. */ }
  }
  return data;
}
