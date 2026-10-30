export type ProfileLink = { title: string; url: string };
export type ProfileDraft = {
  full_name: string; bio: string; headline: string; workplace: string; location: string;
  profile_visibility: 'public' | 'private'; avatar_url: string | null; banner_url: string | null; links: ProfileLink[];
};

export const EMPTY_PROFILE: ProfileDraft = { full_name: '', bio: '', headline: '', workplace: '', location: '', profile_visibility: 'public', avatar_url: null, banner_url: null, links: [] };

export function normalizeProfileUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Existing malformed links are never rendered as active destinations. */
export function safeProfileLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap(link => {
    if (!link || typeof link !== 'object' || typeof link.url !== 'string') return [];
    const url = normalizeProfileUrl(link.url);
    return url ? [{ title: typeof link.title === 'string' ? link.title.slice(0, 80) : '', url }] : [];
  });
}

export function readProfileDraft(value: Record<string, unknown>): ProfileDraft {
  const text = (key: string) => typeof value[key] === 'string' ? value[key] as string : '';
  return { full_name: text('full_name'), bio: text('bio'), headline: text('headline'), workplace: text('workplace'), location: text('location'),
    profile_visibility: value.profile_visibility === 'private' ? 'private' : 'public',
    avatar_url: text('avatar_url') || null, banner_url: text('banner_url') || null, links: safeProfileLinks(value.links) };
}

export function validatedProfile(draft: ProfileDraft): ProfileDraft {
  const limits = { full_name: 100, bio: 500, headline: 120, workplace: 120, location: 120 } as const;
  if (!draft.full_name.trim()) throw new Error('Enter your name before saving.');
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (draft[key].trim().length > limits[key]) throw new Error(`${key.replace('_', ' ')} must be ${limits[key]} characters or fewer.`);
  }
  if (draft.links.length > 5) throw new Error('Keep up to five profile links.');
  const links: ProfileLink[] = [];
  for (const [index, link] of draft.links.entries()) {
    if (!link.url.trim() && !link.title.trim()) continue;
    const url = normalizeProfileUrl(link.url);
    if (!url) throw new Error(`Enter a valid http or https address for link ${index + 1}.`);
    if (link.title.trim().length > 80) throw new Error(`The title for link ${index + 1} must be 80 characters or fewer.`);
    links.push({ title: link.title.trim(), url });
  }
  return { ...draft, full_name: draft.full_name.trim(), bio: draft.bio.trim(), headline: draft.headline.trim(), workplace: draft.workplace.trim(), location: draft.location.trim(), links,
    profile_visibility: draft.profile_visibility === 'private' ? 'private' : 'public' };
}
