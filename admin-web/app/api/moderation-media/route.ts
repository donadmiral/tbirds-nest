import { moderationMediaResponse } from '@/lib/moderationMediaResponse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) { return moderationMediaResponse(request); }
export const HEAD = GET;
