const reactions = { heart: '♥', applause: '👏', fire: '🔥' } as const;
type Reaction = keyof typeof reactions;

export function liveReactionSummary(payload: Record<string, unknown>): string {
  const kind = payload.reaction;
  if (kind !== 'heart' && kind !== 'applause' && kind !== 'fire') return '';
  if (!payload.counts || typeof payload.counts !== 'object' || Array.isArray(payload.counts)) return reactions[kind];
  const counts = payload.counts as Record<string, unknown>;
  return (Object.keys(reactions) as Reaction[]).flatMap(key => {
    const n = counts[key];
    return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? [reactions[key] + ' ' + n] : [];
  }).join('  ') || reactions[kind];
}
