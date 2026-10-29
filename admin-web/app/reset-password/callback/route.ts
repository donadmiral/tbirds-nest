import { NextRequest, NextResponse } from 'next/server';
import { beginRecovery, clearRecovery, recoveryPkceClient } from '@/lib/adminRecovery';
import { trustedAuthOrigin } from '@/lib/adminRecoveryPolicy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const origin = trustedAuthOrigin(request.nextUrl.origin, process.env);
  const responseHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!origin) return new NextResponse('This recovery address is not configured.', { status: 400, headers: responseHeaders });
  let accepted = false;
  try {
    await clearRecovery();
    const code = request.nextUrl.searchParams.get('code');
    const flowId = request.nextUrl.searchParams.get('sb_flow_id');
    if (code && code.length <= 2048 && !request.nextUrl.searchParams.has('error')) {
      const client = await recoveryPkceClient();
      const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      // beginRecovery verifies the server-signed recovery AMR; URL type hints are not trusted.
      if (!error && data.session) accepted = await beginRecovery(data.session);
      if (data.session && !accepted) await client.auth.signOut({ scope: 'local' });
    }
  } catch { /* No provider error, code, or credential goes into the URL. */ }
  const response = NextResponse.redirect(new URL(accepted ? '/reset-password' : '/reset-password?error=link', origin));
  for (const [key, value] of Object.entries(responseHeaders)) response.headers.set(key, value);
  return response;
}
