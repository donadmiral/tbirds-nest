/**
 * Number formatting shared by server desks and client visuals.
 * Plain module, no 'use client', so either side may call it.
 */
export function fmt(n: number): string {
  if (!isFinite(n)) return '0';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}
