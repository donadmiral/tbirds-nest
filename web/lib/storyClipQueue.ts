export type StoryClipAttempt = { clipId: string; requestId: string; payload: Record<string, unknown>; storyId?: string };
export type StoryClipQueue = { version: 1; editable?: boolean; clips: StoryClipAttempt[] };

export function readStoryClipQueue(raw: string): StoryClipQueue {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('clips' in data) || !Array.isArray(data.clips) || !data.clips.length || data.clips.length > 10) throw new Error('Invalid pending story clips.');
  if ('editable' in data && typeof data.editable !== 'boolean') throw new Error('Invalid pending story state.');
  const ids = new Set<string>();
  for (const item of data.clips) {
    if (!item || typeof item.clipId !== 'string' || typeof item.requestId !== 'string' || !item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload) || ids.has(item.clipId)) throw new Error('Invalid pending story clip.');
    if (!['image', 'video', 'text'].includes(item.payload.media_type) || item.storyId != null && typeof item.storyId !== 'string') throw new Error('Invalid pending story media.');
    ids.add(item.clipId);
  }
  return data as StoryClipQueue;
}

/** Confirm one clip at a time. An uncertain request always retains its original
 * immutable payload/id; a confirmed clip is never submitted again in this session. */
export async function publishStoryClipQueue(queue: StoryClipQueue, io: {
  check: () => Promise<void>;
  send: (attempt: StoryClipAttempt) => Promise<string>;
  persist: (queue: StoryClipQueue) => void;
  confirmed?: (attempt: StoryClipAttempt, index: number) => void;
}) {
  io.persist(queue);
  for (let index = 0; index < queue.clips.length; index += 1) {
    const attempt = queue.clips[index];
    if (attempt.storyId) continue;
    await io.check();
    const id = await io.send(attempt);
    await io.check();
    if (typeof id !== 'string' || !id) throw new Error('The server did not confirm this clip. Retry safely.');
    attempt.storyId = id;
    io.persist(queue);
    io.confirmed?.(attempt, index);
  }
  return queue.clips.map(clip => clip.storyId!);
}
