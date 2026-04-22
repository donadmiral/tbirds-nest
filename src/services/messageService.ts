import { supabase } from './supabase';

export async function getOrCreateConversation(user1: string, user2: string) {
  if (!user1 || !user2) return null;

  const u1 = user1 < user2 ? user1 : user2;
  const u2 = user1 < user2 ? user2 : user1;

  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_1', u1)
    .eq('user_2', u2)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('conversations')
    .insert([
      {
        user_1: u1,
        user_2: u2,
      },
    ])
    .select()
    .single();

  if (error) {
    console.log('CREATE_CONVERSATION_ERROR', error);
    return null;
  }

  return data;
}