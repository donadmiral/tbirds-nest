export type MentionPerson = { id: string; username: string };

/** Only whole handles still present in the authored text count as mentions. */
export function storyHandles(text: unknown): string[] {
  const value = typeof text === 'string' ? text : '';
  return [...new Set(Array.from(value.matchAll(/(?:^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{2,30})(?![A-Za-z0-9_.])/g), match => match[1].toLowerCase()))];
}

export function currentTextMentions(sticker: { text?: unknown; mentions?: unknown }): MentionPerson[] {
  const handles = new Set(storyHandles(sticker.text));
  const people = Array.isArray(sticker.mentions) ? sticker.mentions : [];
  const seen = new Set<string>();
  return people.filter((person): person is MentionPerson => {
    if (!person || typeof person.id !== 'string' || typeof person.username !== 'string'
      || !handles.has(person.username.toLowerCase()) || seen.has(person.id)) return false;
    seen.add(person.id); return true;
  });
}

export function storyMentionIds(stickers: { kind?: string; mentionUserId?: string; text?: unknown; mentions?: unknown }[]): string[] {
  return [...new Set(stickers.flatMap(sticker => sticker.kind === 'mention' && sticker.mentionUserId
    ? [sticker.mentionUserId] : currentTextMentions(sticker).map(person => person.id)))];
}
