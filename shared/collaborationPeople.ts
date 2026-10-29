/** Stable account identity matters more than a display name shared by two people. */
export function uniqueCollaborators<T extends { id: string }>(people: T[], authorId: string | null | undefined): T[] {
  const seen = new Set<string>(authorId ? [authorId] : []);
  return people.filter(person => {
    if (!person.id || seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
}

export function collaborationName(person: { full_name?: string | null; username?: string | null }, authorName?: string | null): string {
  const name = person.full_name?.trim() || person.username?.trim() || 'Member';
  return authorName?.trim().toLocaleLowerCase() === name.toLocaleLowerCase() && person.username
    ? `@${person.username}` : name;
}
