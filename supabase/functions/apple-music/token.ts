export type MusicCredentials = { teamId: string; keyId: string; privateKey: string };

function encode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** ES256 signing remains on the server. A browser token is valid for one origin. */
export async function signMusicDeveloperToken(credentials: MusicCredentials, origin?: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const exp = iat + 600;
  const text = new TextEncoder();
  const header = encode(text.encode(JSON.stringify({ alg: 'ES256', kid: credentials.keyId })));
  const claims = encode(text.encode(JSON.stringify({ iss: credentials.teamId, iat, exp, ...(origin ? { origin: [origin] } : {}) })));
  const pem = credentials.privateKey.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const body = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(body));
  return { token: `${body}.${encode(new Uint8Array(signature))}`, expiresAt: exp * 1000 };
}
