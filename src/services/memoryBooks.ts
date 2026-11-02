import { supabase } from './supabase';
import { readMemoryShelfFirst, readMemoryShelfNext, readNextMemoryBook } from '../../shared/pagedReaders';
import type { MemoryBookshelf, MemoryBookSummary } from '../../shared/memoryBookModels';

type Options = { viewer?: string; signal?: AbortSignal; current?: () => boolean; partial?: boolean; minimumBooks?: number };
async function readerScope(options: Options) {
  const { data, error } = await supabase.auth.getSession(); const viewer = data.session?.user.id;
  if (error || !viewer || (options.viewer && viewer !== options.viewer)) throw error ?? new Error('The account changed.');
  return { viewer, token: data.session?.access_token, signal: options.signal, current: options.current };
}
export async function getMemoryBooks(owner: string, options: Options = {}): Promise<MemoryBookshelf> {
  const scope = await readerScope(options);
  let shelf = await readMemoryShelfFirst<MemoryBookSummary>(supabase, owner, scope);
  while (shelf._pagination?.cursor && (!options.partial || shelf.books.length < (options.minimumBooks ?? 12)
    || (!shelf.is_owner && !shelf.books.some(book => book.count > 0)))) shelf = await readMemoryShelfNext(supabase, shelf, scope);
  return shelf;
}
export async function getMemoryBooksNext(previous: MemoryBookshelf, options: Options = {}): Promise<MemoryBookshelf> {
  return readMemoryShelfNext(supabase, previous, await readerScope(options));
}
export async function getNextMemoryBook(owner: string, album: string, includeEmpty: boolean, options: Options = {}): Promise<MemoryBookSummary | null> {
  const result = await readNextMemoryBook<MemoryBookSummary>(supabase, album, includeEmpty, await readerScope(options));
  if (result.supported) return result.book;
  const shelf = await getMemoryBooks(owner, options), books = shelf.books.filter(book => includeEmpty || book.count > 0);
  const at = books.findIndex(book => book.id === album); return at >= 0 ? books[at + 1] ?? null : null;
}
