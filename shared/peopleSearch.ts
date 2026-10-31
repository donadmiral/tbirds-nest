import { readWithDeadline } from './readDeadline';

export type MessagePerson = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };

// Quoted PostgREST literals keep punctuation in a person's name from becoming
// a second filter, and escaped wildcards are matched literally.
export function peopleSearchFilter(input: string): string {
  const literal = input.trim().replace(/^@/, '').replace(/[\\%_]/g, '\\$&');
  const pattern = JSON.stringify('%' + literal + '%');
  return `full_name.ilike.${pattern},username.ilike.${pattern}`;
}

export async function searchMessagePeople(client: { from(name: string): any }, userId: string, input: string): Promise<MessagePerson[]> {
  const term = input.trim().replace(/^@/, '');
  if (!userId || !term) return [];
  const { data, error } = await readWithDeadline<{ data: MessagePerson[] | null; error: unknown }>(client.from('profiles').select('id,full_name,username,avatar_url')
    .neq('id', userId).or(peopleSearchFilter(term.slice(0, 80))).order('full_name').limit(30));
  if (error || !Array.isArray(data)) throw new Error('People could not be loaded. Try again.');
  return data;
}
