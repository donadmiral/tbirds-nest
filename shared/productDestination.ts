/** Only explicit application routes are accepted as relative carousel targets. */
export function productDestination(listingId?: string | null, link?: string | null): { href: string; kind: 'market' | 'job' | 'external'; id?: string } | null {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (listingId && new RegExp('^' + uuid + '$', 'i').test(listingId)) return { href: '/market/' + listingId, kind: 'market', id: listingId };
  const internal = link?.match(new RegExp('^/(market|jobs)/(' + uuid + ')$', 'i'));
  if (internal) return { href: link!, kind: internal[1].toLowerCase() === 'jobs' ? 'job' : 'market', id: internal[2] };
  if (!link) return null;
  try { const url = new URL(link); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return { href: url.href, kind: 'external' }; } catch { /* no valid target */ }
  return null;
}
