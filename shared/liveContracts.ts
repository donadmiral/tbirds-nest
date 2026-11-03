/** Live RPC contract v1. Private media references are stable; bearer URLs are not stored. */
export type { ClipSpec, ClipSubtitle, LiveClip } from './liveClips';
export type LivePageCursor = { created_at: string; id: string; score?: number };
export type LiveClipSettings = { viewer_clipping: boolean; review_required: boolean; watermark_required: boolean; brand_text: string; approved_user_ids: string[] };
export type LiveClipContext = {
  session_id: string; can_clip: boolean; can_manage: boolean;
  available_start_ms: number; available_end_ms: number; max_duration_ms: number;
  viewer_clipping: boolean; recording_available: boolean; settings: LiveClipSettings;
};
export type LiveClipCommandAction = 'create' | 'edit' | 'retry' | 'delete' | 'publish' | 'schedule' | 'share' | 'retry_post' | 'settings' | 'review' | 'admin_review' | 'copyright';
export type LiveClipCommandArgs = { p_session_id: string; p_clip_id: string | null; p_action: LiveClipCommandAction; p_payload: Record<string, unknown>; p_request_id: string };
export type LiveClipCommandResult = { ok: true; clip_id?: string; post_id?: string; state?: string };
export type LiveClipFormat = 'horizontal' | 'vertical';
export type LiveClipAsset = { name: 'horizontal.mp4' | 'vertical.mp4' | 'thumbnail.jpg' | 'captions.vtt'; bytes: number; sha256: string; content_type: string; width?: number; height?: number; duration_ms?: number; format?: LiveClipFormat };
export type LiveClipJob = {
  id: string; lease_id: string; clip_id: string; session_id: string; owner_id: string;
  source_path: string; start_ms: number; end_ms: number; cover_ms: number;
  formats: LiveClipFormat[]; watermark: boolean; brand_text: string; burn_captions: boolean;
  subtitles: { start_ms: number; end_ms: number; text: string }[]; output_prefix: string;
};
export type LiveClipManifest = { assets: LiveClipAsset[]; duration_ms: number; width: number; height: number };
export type LiveClipDestination = 'feed' | 'story' | 'channel' | 'community' | 'highlight' | 'x' | 'facebook' | 'instagram' | 'youtube' | 'tiktok';
export type LiveClipPublication = { destination: LiveClipDestination; target_id?: string; format: LiveClipFormat; scheduled_at?: string };
export type LiveInteractionAction = 'poll_create' | 'poll_vote' | 'poll_close' | 'question_ask' | 'question_vote' | 'question_answer' | 'question_close' | 'chapter_add' | 'chapter_remove';
/**
 * Public authenticated RPCs:
 * live_clip_context(p_session_id) -> LiveClipContext
 * live_clip_settings(p_session_id) -> LiveClipSettings & {can_manage:boolean}
 * live_clip_library(p_session_id nullable,p_cursor nullable,p_limit <=24,p_sort newest|top|shared) -> {items,next_cursor}
 * live_clip_get(p_clip_id) -> {clip,permissions,publication_history}
 * live_clip_history(p_clip_id,p_cursor nullable) -> {items,next_cursor}
 * live_clip_command(LiveClipCommandArgs) -> LiveClipCommandResult
 * live_admin_clips(p_session_id nullable,p_state nullable,p_cursor nullable,p_limit <=24) -> {items,next_cursor}
 * live_admin_clip(p_clip_id,p_cursor nullable) -> {clip,permissions,audit,posts,connections,analytics}
 * live_interactions(p_session_id) -> {polls,questions,chapters}
 * live_interaction_command(p_session_id,p_action,p_payload,p_request_id) -> {ok:true,...}
 * live_analytics(p_session_id) -> measured creator/staff metrics; unknown audience totals are null
 * Broadcast interaction replaces the bounded public snapshot; interaction_counts
 * merges {polls:[{id,total_votes,options:[{id,votes}]}],questions:[{id,votes}]}.
 * Both events omit my_option_id/upvoted; clients retain personalized state.
 *
 * Service-only RPCs:
 * live_claim_clip_jobs(p_limit <=2) -> {items:LiveClipJob[]}
 * live_check_clip_job(p_id,p_lease_id) -> {ok:boolean,source_path:string,job:LiveClipJob}
 * live_finish_clip_job(p_id,p_lease_id,p_ok,p_manifest,p_error) -> {ok:boolean,state:string}
 * live_claim_clip_cleanup(p_limit <=20) -> {items:[{id,lease_id,bucket,object_path}]}
 * live_finish_clip_cleanup(p_id,p_lease_id,p_ok,p_error) -> {ok:boolean}
 * live_clip_reference_access(p_bucket,p_path,p_kind,p_content_id,p_actor_id) -> {allowed:boolean}
 * live_process_clip_publications(p_limit <=20) -> {ok,published,failed}
 * live_clip_configure(p_origin,p_enabled,p_max_active=2) -> {ok,origin,enabled,max_active}
 * Authenticated live_clip_asset_access(p_clip_id,p_format) -> {bucket,object_path,filename}
 *
 * Canonical URLs identify private live-clips objects. They are resolved by the
 * ordinary content media authorization path, including publication provenance
 * and destination access. A revoked source/clip also revokes its publications.
 */
export const LIVE_CLIP_CONTRACT_VERSION = 1 as const;
