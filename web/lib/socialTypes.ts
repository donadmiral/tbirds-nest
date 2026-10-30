import type { FeedRow } from "./feed";

// Return columns of the paginated directory RPCs in
// 20261022211253_social_directory_history_quality.sql.
export type DirectoryPerson = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  verified_tier: string | null;
  rank: number;
};

type CommunityPerson = Pick<DirectoryPerson, "full_name" | "username" | "avatar_url"> & { user_id: string };
export type CommunityMember = CommunityPerson & { role: string; status: string };
export type CommunityRequest = CommunityPerson & { message: string | null; created_at: string };
export type CommunityInvite = CommunityPerson & { invited_by: string | null; created_at: string };
export type CommunityBan = CommunityPerson & { reason: string | null; created_at: string };
export type CommunityAnnouncement = Pick<DirectoryPerson, "full_name" | "username" | "avatar_url"> & { id: string; body: string; created_at: string; author_id: string };
export type SubCommunity = {
  id: string; name: string; description: string | null; icon_url: string | null;
  cover_color: string; join_mode: string; member_count: number; is_member: boolean;
  my_role: string | null; has_pending: boolean; has_invite: boolean;
};
export type CommunityPost = FeedRow & { is_pinned: boolean; has_poll: boolean; has_fact_check: boolean; edited_at: string | null; category: string | null };
