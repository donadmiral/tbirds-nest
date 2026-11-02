import { boundedFetch } from './boundedFetch.ts';

// Opaque secret keys authenticate the backend through apikey. Legacy service
// JWTs retain their bearer header; an independently supplied user JWT is preserved.
export function serviceRoleFetch(fetcher: typeof fetch, key: string, parent?: AbortSignal): typeof fetch {
  const bounded = boundedFetch(fetcher, parent);
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (key.startsWith('sb_secret_')) {
      headers.set('apikey', key);
      if (headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization');
    }
    return bounded(input, { ...init, headers });
  };
}
