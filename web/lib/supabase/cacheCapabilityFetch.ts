const CAPABILITY = 'platinum-cache/1';

/** Append after the SSR SDK supplies its own X-Client-Info version header. */
export function cacheCapabilityFetch(transport: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const existing = headers.get('x-client-info')?.trim() ?? '';
    if (!existing.split(/\s+/).includes(CAPABILITY)) {
      headers.set('x-client-info', existing ? `${existing} ${CAPABILITY}` : CAPABILITY);
    }
    return transport(input, { ...init, headers });
  };
}
