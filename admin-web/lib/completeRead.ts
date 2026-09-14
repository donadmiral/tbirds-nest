import 'server-only';
/** Refuse aggregates or complete directories if the API returned only a prefix. */
export function completeRead(result: {data: unknown[] | null; count: number | null}, label: string) {
 if (!result.data || result.count === null || result.data.length !== result.count) {
  throw new Error(label + ' is incomplete. Server aggregation or pagination is required.');
 }
}
