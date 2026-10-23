import { type AppleMusicTrack } from './appleMusic';

type FunctionClient = { functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> } };
export type MusicSearchResult = { tracks: AppleMusicTrack[]; nextOffset: number | null };
export type MusicAvailability = { configured: boolean; playbackAvailable: boolean; soundtrackAvailable: false };

export function createAppleMusicClient(client: FunctionClient) {
  async function request<T>(body: Record<string, unknown>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        client.functions.invoke('apple-music', { body }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Apple Music took too long to respond. Try again.')), 15000); }),
      ]);
      if (response.error) {
        let message = 'Apple Music is unavailable. You can still share a song link.';
        const context = (response.error as { context?: { json?: () => Promise<{ error?: unknown }> } }).context;
        try { const detail = await context?.json?.(); if (typeof detail?.error === 'string') message = detail.error; } catch { /* Use a safe fallback. */ }
        throw new Error(message);
      }
      if (!response.data || typeof response.data !== 'object') throw new Error('Apple Music returned an incomplete response. Try again.');
      return response.data as T;
    } finally { if (timer) clearTimeout(timer); }
  }
  return {
    availability: () => request<MusicAvailability>({ action: 'status' }),
    search: (term: string, storefront: string, offset = 0) => request<MusicSearchResult>({ action: 'search', term, storefront, offset }),
    track: (id: string, storefront: string) => request<MusicSearchResult>({ action: 'track', id, storefront }),
    developerToken: () => request<{ token: string; expiresAt: number }>({ action: 'token' }),
  };
}
