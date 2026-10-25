import { cookies } from 'next/headers';
import { getAdmin } from '@/lib/adminAuth';
import { canAccessOperations } from '@/lib/adminAssurance';
import { sanitizeDiagnostic } from '../../../../shared/clientDiagnostics';

export async function POST(request: Request) {
  // Same-origin JSON only. No anonymous service-role insertion endpoint.
  if (request.headers.get('origin') !== new URL(request.url).origin
    || !request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 403 });
  try {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > 2048) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const decoder = new TextDecoder();
    let body = '', bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); return new Response(null, { status: 413 }); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Response(null, { status: 400 });
    const admin = await getAdmin();
    if (!admin || !await canAccessOperations(admin)) return new Response(null, { status: 401 });
    const payload = sanitizeDiagnostic({ name: value.category }, { ...value, platform: 'admin' });
    const token = (await cookies()).get('pc_admin_token')?.value;
    // Forward the verified user's token: the database binds identity and rate limits itself.
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/report_client_error`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_report: payload }), cache: 'no-store', signal: AbortSignal.timeout(5_000),
    });
    return new Response(null, { status: response.ok ? 204 : 503 });
  } catch { return new Response(null, { status: 503 }); }
}
