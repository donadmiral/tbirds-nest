import { createClient } from '@/lib/supabase/server';
import { archiveBytes, archiveId, getArchive } from '../../../../../shared/accountArchive';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!archiveId(id)) return new Response(null, { status: 404, headers });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return new Response(null, { status: 401, headers });
  const rpc = (name: string, args?: Record<string, unknown>) => client.rpc(name, args).abortSignal(request.signal);
  const manifest = await getArchive(rpc, user.id, id).catch(() => null);
  if (!manifest) return new Response(null, { status: 404, headers });
  if (manifest.status !== 'ready') return new Response(null, { status: 409, headers });
  const chunks = archiveBytes(rpc, manifest, () => request.signal.throwIfAborted());
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await chunks.next();
      if (result.done) controller.close();
      else controller.enqueue(result.value);
    },
    async cancel() { await chunks.return(); },
  });
  return new Response(body, { headers: {
    ...headers, 'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="platinum-circles-account.jsonl"',
    'Content-Length': String(manifest.byte_count),
  } });
}
