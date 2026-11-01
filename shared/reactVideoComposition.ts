/** React records a continuous camera take and a separate, discontinuous source
 * clock. A source pause is a real hold in this timeline, never a recorder pause. */
export const REACT_MAX_SECONDS = 120;
export const REACT_MAX_SEGMENTS = 160;
export type ReactSource = {
  uri: string; kind: 'video' | 'image'; duration?: number; width?: number; height?: number;
  postId?: string; creatorId?: string; creatorName?: string; attributionText?: string;
  text?: string; title?: string; sourceMediaId?: string; sourceRevision?: string;
  isPrivate?: boolean; allowReact?: boolean;
};
export type ReactExport = {
  uri: string; mimeType: 'video/mp4'; width: 720; height: 1280; duration: number;
  source: Pick<ReactSource, 'postId' | 'creatorId' | 'creatorName' | 'attributionText' | 'sourceMediaId' | 'sourceRevision'>;
};
export type ReactCaptureParams = { source?: ReactSource } | undefined;
export type ReactLayout = 'side-by-side' | 'top-bottom' | 'pip' | 'cutout';
export type ReactRect = { x: number; y: number; width: number; height: number };
export type ReactPlaybackEvent = { at: number; sourceTime: number; playing: boolean; volume: number };
export type ReactSegment = { start: number; end: number; sourceStart: number; playing: boolean; volume: number };
export type ReactNativeRequest = {
  id: string; sourceUri: string; sourceKind: 'video' | 'image'; cameraUri: string; outputUri: string;
  width: 720; height: 1280; cameraStart: number; duration: number;
  segments: ReactSegment[]; sourceRect: ReactRect; faceRect: ReactRect;
  voiceVolume: number; sourceZoom: number; cutout: boolean; overlayUri?: string;
};
export type ReactNativeResult = { uri: string; duration: number; width: number; height: number; bytes: number; segmentCount: number; voiceMixed: boolean };
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** iOS view-shot returns an absolute filesystem path. Expo and the native
 * compositor use file URIs. Convert only that local path form, keeping URI
 * escapes intact and leaving native app-directory checks authoritative. */
export function reactLocalFileUri(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('React needs a local photo or video file.');
  if (value.startsWith('/') && !value.startsWith('//')) return `file://${value.split('/').map(encodeURIComponent).join('/')}`;
  if (/^file:\/\/\/[^?#]+$/.test(value)) return value;
  throw new Error('React needs a local photo or video file.');
}

export function reactRects(layout: ReactLayout, face: ReactRect = { x: .65, y: .56, width: .3, height: .38 }): { source: ReactRect; face: ReactRect } {
  if (layout === 'side-by-side') return { source: { x: 0, y: 0, width: .5, height: 1 }, face: { x: .5, y: 0, width: .5, height: 1 } };
  if (layout === 'top-bottom') return { source: { x: 0, y: 0, width: 1, height: .5 }, face: { x: 0, y: .5, width: 1, height: .5 } };
  const width = clamp(face.width, .18, .8), height = clamp(face.height, .18, .85);
  return { source: { x: 0, y: 0, width: 1, height: 1 }, face: { x: clamp(face.x, 0, 1 - width), y: clamp(face.y, 0, 1 - height), width, height } };
}

/** Last action wins at an identical timestamp, which makes rapid pause/seek
 * gestures deterministic without zero-length native clips. The source is held
 * at its final readable frame when it reaches the end, while the take continues. */
export function buildReactTimeline(events: readonly ReactPlaybackEvent[], duration: number, sourceDuration: number, kind: 'image' | 'video'): ReactSegment[] {
  if (!finite(duration, .1, REACT_MAX_SECONDS) || kind === 'video' && !finite(sourceDuration, .05, 86400)) throw new Error('The reaction or source duration is invalid.');
  if (!Array.isArray(events) || events.length > REACT_MAX_SEGMENTS || !events.length) throw new Error('The reaction playback timeline is missing or too complex.');
  const ordered = new Map<number, ReactPlaybackEvent>();
  for (const event of events) {
    if (!event || !finite(event.at, 0, REACT_MAX_SECONDS) || !finite(event.sourceTime, 0, 86400) || typeof event.playing !== 'boolean' || !finite(event.volume, 0, 1)) throw new Error('The reaction playback timeline is invalid.');
    if (event.at < duration) ordered.set(event.at, { ...event });
  }
  const sorted = [...ordered.values()].sort((a, b) => a.at - b.at);
  if (!sorted.length || sorted[0].at !== 0) throw new Error('The reaction playback timeline must start with the camera.');
  const result: ReactSegment[] = [];
  const append = (segment: ReactSegment) => {
    if (segment.end - segment.start < .00001) return;
    const previous = result[result.length - 1];
    const expected = previous ? previous.sourceStart + (previous.playing ? previous.end - previous.start : 0) : 0;
    if (previous && previous.playing === segment.playing && previous.volume === segment.volume && Math.abs(expected - segment.sourceStart) < .002) previous.end = segment.end;
    else result.push(segment);
  };
  sorted.forEach((event, index) => {
    const end = sorted[index + 1]?.at ?? duration;
    const sourceStart = kind === 'image' ? 0 : clamp(event.sourceTime, 0, Math.max(0, sourceDuration - 1 / 60));
    const playing = kind === 'video' && event.playing && event.sourceTime < sourceDuration;
    const playEnd = playing ? Math.min(end, event.at + sourceDuration - sourceStart) : event.at;
    if (playEnd > event.at) append({ start: event.at, end: playEnd, sourceStart, playing: true, volume: event.volume });
    if (playEnd < end) append({ start: playEnd, end, sourceStart: playing ? Math.max(0, sourceDuration - 1 / 60) : sourceStart, playing: false, volume: 0 });
  });
  if (result.length > REACT_MAX_SEGMENTS) throw new Error('This reaction has too many playback changes. Record a shorter take.');
  return result;
}

/** Trim the continuous face/mic and source together. A trim inside a hold keeps
 * the exact held frame; a trim inside playback advances only the source clock. */
export function trimReactTimeline(segments: readonly ReactSegment[], start: number, end: number): ReactSegment[] {
  if (!finite(start, 0, REACT_MAX_SECONDS) || !finite(end, start + .1, REACT_MAX_SECONDS)) throw new Error('Choose at least a tenth of a second for this reaction.');
  return segments.filter(segment => segment.end > start && segment.start < end).map(segment => {
    const from = Math.max(start, segment.start), to = Math.min(end, segment.end);
    return { ...segment, start: from - start, end: to - start, sourceStart: segment.sourceStart + (segment.playing ? from - segment.start : 0) };
  });
}

export function reactSourceAt(segments: readonly ReactSegment[], time: number): { time: number; playing: boolean; volume: number } {
  const segment = segments.find(value => time >= value.start && time < value.end) ?? segments[segments.length - 1];
  if (!segment) return { time: 0, playing: false, volume: 0 };
  return { time: segment.sourceStart + (segment.playing ? clamp(time - segment.start, 0, segment.end - segment.start) : 0), playing: segment.playing, volume: segment.volume };
}

/** Change source timing inside an existing face/mic take. A creator can turn a
 * recorded explanation into an exact frame hold or replay a passage without
 * deleting or extending their recorded voice. Unedited regions retain timing. */
export function replaceReactSourceWindow(segments: readonly ReactSegment[], edit: {
  start: number; end: number; sourceTime: number; playing: boolean; sourceDuration: number; kind: 'image' | 'video'; volume: number;
}): ReactSegment[] {
  const duration = segments[segments.length - 1]?.end;
  if (!finite(duration, .1, REACT_MAX_SECONDS) || !finite(edit.start, 0, duration - .1) || !finite(edit.end, edit.start + .1, duration)
    || !finite(edit.sourceTime, 0, edit.kind === 'video' ? edit.sourceDuration : 0) || !finite(edit.volume, 0, 1)) throw new Error('Choose a valid time range and source frame for this edit.');
  const before = segments.filter(value => value.start < edit.start).map(value => ({ ...value, end: Math.min(value.end, edit.start) }));
  const middle = buildReactTimeline([{ at: 0, sourceTime: edit.sourceTime, playing: edit.playing, volume: edit.volume }], edit.end - edit.start, edit.sourceDuration, edit.kind)
    .map(value => ({ ...value, start: value.start + edit.start, end: value.end + edit.start }));
  const after = segments.filter(value => value.end > edit.end).map(value => ({ ...value, start: Math.max(value.start, edit.end), sourceStart: value.sourceStart + (value.playing ? Math.max(0, edit.end - value.start) : 0) }));
  const result = [...before, ...middle, ...after];
  if (result.length > REACT_MAX_SEGMENTS) throw new Error('This take has too many source timing edits. Start with a shorter take.');
  return result;
}

export function validateReactRequest(request: ReactNativeRequest): void {
  const local = (uri: unknown) => typeof uri === 'string' && /^file:\/\//.test(uri);
  const rect = (value: ReactRect) => value && finite(value.x, 0, 1) && finite(value.y, 0, 1) && finite(value.width, .1, 1) && finite(value.height, .1, 1) && value.x + value.width <= 1.001 && value.y + value.height <= 1.001;
  if (!request || !/^[A-Za-z0-9_-]{8,120}$/.test(request.id) || !local(request.sourceUri) || !local(request.cameraUri) || !local(request.outputUri)
    || !/\/pc-react-export-[^/]+\.mp4$/.test(request.outputUri) || request.sourceUri === request.outputUri || request.cameraUri === request.outputUri
    || !['image', 'video'].includes(request.sourceKind) || request.width !== 720 || request.height !== 1280
    || !finite(request.duration, .1, REACT_MAX_SECONDS) || !finite(request.cameraStart, 0, REACT_MAX_SECONDS) || request.cameraStart + request.duration > REACT_MAX_SECONDS + .01
    || !rect(request.sourceRect) || !rect(request.faceRect) || !finite(request.voiceVolume, 0, 1) || !finite(request.sourceZoom, 1, 3) || typeof request.cutout !== 'boolean'
    || request.overlayUri != null && !local(request.overlayUri) || !Array.isArray(request.segments) || request.segments.length < 1 || request.segments.length > REACT_MAX_SEGMENTS) throw new Error('The reaction export request is invalid.');
  let cursor = 0;
  for (const segment of request.segments) {
    if (!segment || !finite(segment.start, 0, request.duration) || Math.abs(segment.start - cursor) > .002 || !finite(segment.end, segment.start + .00001, request.duration + .002)
      || !finite(segment.sourceStart, 0, 86400) || !finite(segment.volume, 0, 1) || typeof segment.playing !== 'boolean' || request.sourceKind === 'image' && segment.playing
      || !segment.playing && segment.volume !== 0) throw new Error('The reaction source has a gap or invalid hold.');
    cursor = segment.end;
  }
  if (Math.abs(cursor - request.duration) > .002) throw new Error('The reaction source must cover the full camera take.');
}

export function validateReactResult(request: ReactNativeRequest, value: unknown): ReactNativeResult {
  const result = value as ReactNativeResult | null;
  if (!result || result.uri !== request.outputUri || result.width !== 720 || result.height !== 1280 || !finite(result.duration, Math.max(.01, request.duration - .2), request.duration + .25)
    || !Number.isSafeInteger(result.bytes) || !finite(result.bytes, 1024, 512 * 1024 * 1024) || result.segmentCount !== request.segments.length || result.voiceMixed !== (request.voiceVolume > 0)) throw new Error('The combined reaction could not be verified. No video was saved.');
  return result;
}
