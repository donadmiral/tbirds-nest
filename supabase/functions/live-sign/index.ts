import { createLiveSigner } from './handler.ts';
const env = (name: string) => Deno.env.get(name) || '';
Deno.serve(createLiveSigner({ secret: env('LIVE_PLAYBACK_SIGNER_SECRET'), signingKey: env('LIVE_CDN_SIGNING_KEY'),
  keyId: env('LIVE_CDN_KEY_ID'), cdnOrigin: env('LIVE_HLS_CDN_ORIGIN') }));
