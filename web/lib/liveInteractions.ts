import { isLiveUuid } from '../../shared/liveDirectory';
import { liveRpc, record, type LiveClient } from './liveApi';

export type LivePoll = { id: string; question: string; state: 'open' | 'closed'; options: { id: string; label: string; votes: number }[]; total_votes: number; my_option_id: string | null };
export type LiveQuestion = { id: string; body: string; author: { id: string; full_name: string; username: string }; votes: number; upvoted: boolean; answer: string; state: string };
export type LiveChapter = { id: string; title: string; position_ms: number };
export type LiveInteractionsSnapshot = { polls: LivePoll[]; questions: LiveQuestion[]; chapters: LiveChapter[] };
export type LiveInteractionAction = 'poll_create' | 'poll_vote' | 'poll_close' | 'question_ask' | 'question_vote' | 'question_answer' | 'question_close' | 'chapter_add' | 'chapter_remove';
export type LiveAnalytics = { current_viewers: number | null; peak_viewers: number | null; unique_viewers: number | null; watch_minutes: number | null; chat_messages: number | null; reactions: number | null; clips: number | null; clip_views: number | null; clip_shares: number | null; measured_at: string | null };

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
const measured = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const emptyLiveInteractions = (): LiveInteractionsSnapshot => ({ polls: [], questions: [], chapters: [] });

/** A bounded public snapshot. Personalized vote fields are supplied only on reads. */
export function parseLiveInteractions(value: unknown): LiveInteractionsSnapshot | null {
  if (!record(value) || !Array.isArray(value.polls) || !Array.isArray(value.questions) || !Array.isArray(value.chapters)) return null;
  const polls: LivePoll[] = [];
  for (const row of value.polls.slice(0, 3)) {
    if (!record(row) || !isLiveUuid(row.id) || !Array.isArray(row.options) || !['open', 'closed'].includes(String(row.state))) continue;
    const options = row.options.slice(0, 6).flatMap(option => record(option) && isLiveUuid(option.id) ? [{ id: option.id, label: text(option.label, 100), votes: count(option.votes) }] : []);
    if (options.length < 2) continue;
    polls.push({ id: row.id, question: text(row.question, 160), state: row.state as LivePoll['state'], options, total_votes: count(row.total_votes), my_option_id: isLiveUuid(row.my_option_id) ? row.my_option_id : null });
  }
  const questions: LiveQuestion[] = [];
  for (const row of value.questions.slice(0, 25)) {
    if (!record(row) || !isLiveUuid(row.id) || !record(row.author) || !isLiveUuid(row.author.id)) continue;
    questions.push({ id: row.id, body: text(row.body, 500), author: { id: row.author.id, full_name: text(row.author.full_name, 120), username: text(row.author.username, 64) }, votes: count(row.votes), upvoted: row.upvoted === true, answer: text(row.answer, 1000), state: text(row.state, 30) || 'open' });
  }
  const chapters: LiveChapter[] = [];
  for (const row of value.chapters.slice(0, 100)) {
    if (!record(row) || !isLiveUuid(row.id) || !Number.isSafeInteger(row.position_ms) || Number(row.position_ms) < 0) continue;
    chapters.push({ id: row.id, title: text(row.title, 120), position_ms: Number(row.position_ms) });
  }
  return { polls, questions, chapters: chapters.sort((a, b) => a.position_ms - b.position_ms) };
}

/** Public broadcasts never erase the recipient's own vote selection. */
export function mergeLiveInteractions(previous: LiveInteractionsSnapshot, incoming: LiveInteractionsSnapshot): LiveInteractionsSnapshot {
  const votes = new Map(previous.polls.map(poll => [poll.id, poll.my_option_id]));
  const upvotes = new Map(previous.questions.map(question => [question.id, question.upvoted]));
  return { ...incoming, polls: incoming.polls.map(poll => ({ ...poll, my_option_id: votes.get(poll.id) ?? poll.my_option_id })), questions: incoming.questions.map(question => ({ ...question, upvoted: upvotes.get(question.id) ?? question.upvoted })) };
}

export function mergeLiveInteractionCounts(previous: LiveInteractionsSnapshot, value: unknown): LiveInteractionsSnapshot {
  if (!record(value)) return previous;
  const polls = new Map((Array.isArray(value.polls) ? value.polls.slice(0, 3) : []).flatMap(row => record(row) && isLiveUuid(row.id) ? [[row.id, row] as const] : []));
  const questions = new Map((Array.isArray(value.questions) ? value.questions.slice(0, 25) : []).flatMap(row => record(row) && isLiveUuid(row.id) ? [[row.id, row] as const] : []));
  return { ...previous, polls: previous.polls.map(poll => { const incoming = polls.get(poll.id); if (!incoming) return poll; const options = new Map((Array.isArray(incoming.options) ? incoming.options.slice(0, 6) : []).flatMap(row => record(row) && isLiveUuid(row.id) ? [[row.id, count(row.votes)] as const] : [])); return { ...poll, total_votes: count(incoming.total_votes), options: poll.options.map(option => ({ ...option, votes: options.get(option.id) ?? option.votes })) }; }), questions: previous.questions.map(question => questions.has(question.id) ? { ...question, votes: count(questions.get(question.id)?.votes) } : question) };
}

export async function getLiveInteractions(client: LiveClient, sessionId: string) {
  const value = parseLiveInteractions(await liveRpc(client, 'live_interactions', { p_session_id: sessionId }));
  if (!value) throw Error('INVALID_LIVE_INTERACTIONS');
  return value;
}

export function liveInteractionCommand(client: LiveClient, sessionId: string, action: LiveInteractionAction, payload: Record<string, unknown>, requestId: string) {
  return liveRpc(client, 'live_interaction_command', { p_session_id: sessionId, p_action: action, p_payload: payload, p_request_id: requestId });
}

export async function getLiveAnalytics(client: LiveClient, sessionId: string): Promise<LiveAnalytics> {
  const value = await liveRpc(client, 'live_analytics', { p_session_id: sessionId });
  return { current_viewers: measured(value.current_viewers), peak_viewers: measured(value.peak_viewers), unique_viewers: measured(value.unique_viewers), watch_minutes: measured(value.watch_minutes), chat_messages: measured(value.chat_messages), reactions: measured(value.reactions), clips: measured(value.clips), clip_views: measured(value.clip_views), clip_shares: measured(value.clip_shares), measured_at: typeof value.measured_at === 'string' && Number.isFinite(Date.parse(value.measured_at)) ? value.measured_at : null };
}
