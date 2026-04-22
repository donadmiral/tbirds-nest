import { supabase } from './supabase';

export const messagesService = {
  async getConversations(userId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .or(`user_1.eq.${userId},user_2.eq.${userId}`)
      .order('last_message_time', { ascending: false });

    if (error) {
      console.log('GET_CONVERSATIONS_ERROR', error);
      return [];
    }

    return data || [];
  },

  async findOrCreateConversation(user1: string, user2: string) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .or(`and(user_1.eq.${user1},user_2.eq.${user2}),and(user_1.eq.${user2},user_2.eq.${user1})`)
      .maybeSingle();

    if (data) return data.id;

    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert([
        {
          user_1: user1,
          user_2: user2,
          last_message: '',
          last_message_time: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.log('CREATE_CONVERSATION_ERROR', error);
      return null;
    }

    return newConv.id;
  },

  async getMessages(conversationId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.log('LOAD_MESSAGES_ERROR', error);
      return [];
    }

    return data || [];
  },

  async sendMessage(
    conversationId: string,
    senderId: string,
    receiverId: string,
    content: string
  ) {
    const { error } = await supabase.from('messages').insert([
      {
        conversation_id: conversationId,
        sender_id: senderId,
        receiver_id: receiverId,
        content,
      },
    ]);

    if (error) {
      console.log('SEND_MESSAGE_ERROR', error);
      return;
    }

    await supabase
      .from('conversations')
      .update({
        last_message: content,
        last_message_time: new Date().toISOString(),
      })
      .eq('id', conversationId);
  },

  async getUsersForMessaging(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .neq('id', userId)
      .limit(20);

    if (error) {
      console.log('GET_USERS_ERROR', error);
      return [];
    }

    return data || [];
  },

  async getUnreadConversationIds(userId: string, conversationIds: string[]) {
    if (!conversationIds.length) return [];

    const { data } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', conversationIds)
      .eq('receiver_id', userId)
      .is('read_at', null);

    const ids = new Set((data || []).map((m) => m.conversation_id));
    return Array.from(ids);
  },
};
