import { getAdmin } from '@/lib/adminAuth';
import { canAccessOperations } from '@/lib/adminAssurance';
import { canOpen } from '@/lib/permissions';
import { serviceClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/** Staff-only, read-only operational metrics. Never a public health/data API. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  try {
    const admin = await getAdmin();
    if (!admin || !await canAccessOperations(admin)) return new Response(null, { status: 401, headers });
    if (!canOpen(admin.role, '/system')) return new Response(null, { status: 403, headers });
    const raw = new URL(request.url).searchParams.get('minutes') ?? '60';
    if (!/^\d{1,4}$/.test(raw) || Number(raw) > 1440) return new Response(null, { status: 400, headers });
    const { data, error } = await serviceClient().rpc('capacity_status_v1', { p_history_minutes: Number(raw) });
    if (error || data?.version !== 1) return new Response(JSON.stringify({ error: 'Capacity metrics unavailable' }), { status: 503, headers });
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Capacity metrics unavailable' }), { status: 503, headers });
  }
}
