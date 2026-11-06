import type { HistoryPage, HistorySnapshot } from './sessionHistory';

export const FEED_HISTORY_PAGE_ROWS = 6;

/** Use the same page and child identities before the authenticated history
 * reader is ready. Promoted/synthetic rows stay with the preceding real post,
 * without consuming one of the six real-post slots in a history page. */
export function feedHistoryPages<T extends { id: string }>(
  posts: T[], displayPosts: T[], history: Pick<HistorySnapshot<T>, 'pages'> | null,
): HistoryPage<T>[] {
  let pages = history?.pages;
  if (!pages) {
    const unique = [...new Map(posts.map(post => [post.id, post])).values()];
    pages = [];
    for (let first = 0; first < unique.length; first += FEED_HISTORY_PAGE_ROWS) {
      pages.push({ index: pages.length, first, rows: unique.slice(first, first + FEED_HISTORY_PAGE_ROWS), height: 0 });
    }
  }
  const groups = pages.map(page => ({ ...page, rows: [] as T[] }));
  const byPost = new Map(pages.flatMap(page => page.rows.map(post => [post.id, page.index] as const)));
  const byPage = new Map(groups.map(page => [page.index, page]));
  let last = groups[0]?.index;
  for (const post of displayPosts) {
    const page = byPost.get(post.id) ?? last;
    if (page !== undefined) byPage.get(page)?.rows.push(post);
    last = page;
  }
  return groups;
}
