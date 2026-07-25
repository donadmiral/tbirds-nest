import { supabase } from './supabase';
import type { Profile } from '../types';

export type ConnectionStatus =
  | 'none'
  | 'pending_sent'
  | 'pending_received'
  | 'connected'
  | 'declined';

export type ConnectionDetails = {
  status: ConnectionStatus;
  requestId: string | null;
};

export type ConnectionRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: string;
  created_at: string;
  other_profile: Profile | null;
};

/**
 * Network service. All social graph access goes through this file.
 *
 * Schema truth:
 *   connections.requester_id / connections.recipient_id
 *   follows.follower_id / follows.following_id
 *
 * The follows table stores one-way follows, exposed through followService.
 */
export const networkService = {
  async getUsers(currentUserId: string): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', currentUserId)
      .order('full_name');
    if (error) throw error;
    return data ?? [];
  },

  async getConnectionDetails(
    currentUserId: string,
    otherUserId: string
  ): Promise<ConnectionDetails> {
    const { data, error } = await supabase
      .from('connections')
      .select('id, requester_id, recipient_id, status')
      .or(
        `and(requester_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`
      )
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: 'none', requestId: null };
    if (data.status === 'accepted')
      return { status: 'connected', requestId: data.id };
    if (data.status === 'pending') {
      return {
        status:
          data.requester_id === currentUserId
            ? 'pending_sent'
            : 'pending_received',
        requestId: data.id,
      };
    }
    if (data.status === 'declined')
      return { status: 'declined', requestId: data.id };
    return { status: 'none', requestId: null };
  },

  async sendConnectionRequest(requesterId: string, recipientId: string) {
    const existing = await this.getConnectionDetails(requesterId, recipientId);
    if (existing.status !== 'none') return existing;

    const { data, error } = await supabase
      .from('connections')
      .insert({
        requester_id: requesterId,
        recipient_id: recipientId,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw error;

    // notification is created by a database trigger
    return {
      status: 'pending_sent' as ConnectionStatus,
      requestId: data?.id ?? null,
    };
  },

  async acceptConnection(
    requestId: string,
    accepterUserId: string,
    requesterUserId: string
  ) {
    const { error } = await supabase
      .from('connections')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', requestId);
    if (error) throw error;
    // notification is created by a database trigger
    return { status: 'connected' as ConnectionStatus, requestId };
  },

  async rejectConnection(requestId: string) {
    const { error } = await supabase
      .from('connections')
      .delete()
      .eq('id', requestId);
    if (error) throw error;
    return { status: 'none' as ConnectionStatus, requestId: null };
  },

  async removeConnection(requestId: string) {
    const { error } = await supabase
      .from('connections')
      .delete()
      .eq('id', requestId);
    if (error) throw error;
    return { status: 'none' as ConnectionStatus, requestId: null };
  },

  async getConnectionCount(userId: string) {
    const { count, error } = await supabase
      .from('connections')
      .select('id', { count: 'exact', head: true })
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq('status', 'accepted');
    if (error) throw error;
    return count ?? 0;
  },

  async getConnections(userId: string): Promise<ConnectionRow[]> {
    const { data, error } = await supabase
      .from('connections')
      .select('id, requester_id, recipient_id, status, created_at')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq('status', 'accepted')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return enrichWithOtherProfile(data || [], userId);
  },

  async getPendingRequests(userId: string): Promise<ConnectionRow[]> {
    const { data, error } = await supabase
      .from('connections')
      .select('id, requester_id, recipient_id, status, created_at')
      .eq('recipient_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return enrichWithOtherProfile(data || [], userId);
  },

  async getOutgoingRequests(userId: string): Promise<ConnectionRow[]> {
    const { data, error } = await supabase
      .from('connections')
      .select('id, requester_id, recipient_id, status, created_at')
      .eq('requester_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return enrichWithOtherProfile(data || [], userId);
  },
};

/**
 * Follow service. Writes to the follows table.
 * Column names: follows.follower_id, follows.following_id.
 */
export const followService = {
  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },

  async follow(followerId: string, followingId: string) {
    const { error } = await supabase
      .from('follows')
      .insert({ follower_id: followerId, following_id: followingId });
    if (error) throw error;
    // notification is created by a database trigger
    return true;
  },

  async unfollow(followerId: string, followingId: string) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    if (error) throw error;
    return false;
  },

  async getCounts(userId: string) {
    const [followers, following] = await Promise.all([
      supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', userId),
      supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', userId),
    ]);
    return {
      followers: followers.count ?? 0,
      following: following.count ?? 0,
    };
  },
};



// ── Helpers ─────────────────────────────────────────────────

async function enrichWithOtherProfile(
  rows: Array<{
    id: string;
    requester_id: string;
    recipient_id: string;
    status: string;
    created_at: string;
  }>,
  currentUserId: string
): Promise<ConnectionRow[]> {
  if (!rows.length) return [];
  const otherIds = Array.from(
    new Set(
      rows.map((r) =>
        r.requester_id === currentUserId ? r.recipient_id : r.requester_id
      )
    )
  );
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', otherIds);
  const pMap: Record<string, Profile> = {};
  (profiles || []).forEach((p: any) => {
    pMap[p.id] = p as Profile;
  });
  return rows.map((r) => {
    const otherId =
      r.requester_id === currentUserId ? r.recipient_id : r.requester_id;
    return { ...r, other_profile: pMap[otherId] ?? null };
  });
}

// notifyConnectionRequest removed 2026-07-25.
//
// It wrote to_user_id / from_user_id / title / body / ref_id / ref_type,
// none of which are columns on notifications. Every call had been failing
// silently inside a catch that only logged. trg_notify_follow and
// trg_notify_connection already create these correctly in the database.


// notifyConnectionAccepted removed 2026-07-25.
//
// It wrote to_user_id / from_user_id / title / body / ref_id / ref_type,
// none of which are columns on notifications. Every call had been failing
// silently inside a catch that only logged. trg_notify_follow and
// trg_notify_connection already create these correctly in the database.


// notifyFollow removed 2026-07-25. It wrote to_user_id / from_user_id /
// title / body / ref_id / ref_type, none of which are columns on
// notifications, so every call failed silently inside a logging catch.
// Its type was also the retired orbit naming. trg_notify_follow covers it.
