export const NOTIFICATION_CATEGORIES = [
  'messages', 'message_reactions', 'calls', 'likes', 'comments', 'mentions',
  'followers', 'updates', 'jobs', 'payments', 'account',
] as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export type NotificationPreferenceKey = NotificationCategory | 'all';
export type NotificationProfile = {
  notif_prefs?: unknown;
  notif_messages?: boolean | null;
  notif_connections?: boolean | null;
  notif_jobs?: boolean | null;
  quiet_from?: number | null;
  quiet_to?: number | null;
  quiet_tz_offset_min?: number | null;
  deactivated_at?: string | null;
  deleted_at?: string | null;
};

const CATEGORIES: Record<string, NotificationCategory> = {
  like: 'likes', comment_like: 'likes', story_reaction: 'likes', repost: 'likes',
  comment: 'comments', reply: 'comments', mention: 'mentions', story_mention: 'mentions',
  message: 'messages', message_request: 'messages', message_reaction: 'message_reactions',
  follow: 'followers', follow_request: 'followers', follow_accepted: 'followers',
  connection_request: 'followers', connection_accepted: 'followers',
  incoming_call: 'calls', missed_call: 'calls',
  community_invite: 'updates', collab_invite: 'updates', business_member: 'updates',
  channel_post: 'updates', mentorship_request: 'updates', mentorship_accepted: 'updates',
  job: 'jobs', job_application: 'jobs', job_referral: 'jobs',
  payment_received: 'payments', system: 'account', login_alert: 'account', verification: 'account',
};

export function notificationCategory(type: string): NotificationCategory {
  return CATEGORIES[type] ?? 'updates';
}

export function notificationPreferences(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
}

export function categoryEnabled(profile: NotificationProfile, category: NotificationCategory): boolean {
  const prefs = notificationPreferences(profile.notif_prefs);
  if (typeof prefs[category] === 'boolean') return prefs[category];
  if (category === 'messages' && profile.notif_messages === false) return false;
  if (category === 'followers' && profile.notif_connections === false) return false;
  if (category === 'jobs' && profile.notif_jobs === false) return false;
  // The old UI stored type keys. Until the person explicitly chooses a
  // category, show their existing disabled choices without silently enabling.
  return !Object.entries(CATEGORIES).some(([type, group]) => group === category && prefs[type] === false);
}

export function pushEnabled(profile: NotificationProfile): boolean {
  return notificationPreferences(profile.notif_prefs).all !== false;
}

export function notificationAllowed(profile: NotificationProfile | null, type: string, now = Date.now()): boolean {
  if (!profile || profile.deactivated_at || profile.deleted_at || !pushEnabled(profile)) return false;
  const category = notificationCategory(type), prefs = notificationPreferences(profile.notif_prefs);
  // An explicit category choice supersedes historical per-type/column values.
  if (typeof prefs[category] === 'boolean') {
    if (!prefs[category]) return false;
  } else {
    if (prefs[type] === false) return false;
    if (category === 'messages' && profile.notif_messages === false) return false;
    if (category === 'followers' && profile.notif_connections === false) return false;
    if (category === 'jobs' && profile.notif_jobs === false) return false;
  }
  const start = profile.quiet_from, end = profile.quiet_to, offset = profile.quiet_tz_offset_min ?? 0;
  if (typeof start === 'number' && Number.isInteger(start) && start >= 0 && start < 24
    && typeof end === 'number' && Number.isInteger(end) && end >= 0 && end < 24
    && start !== end && Number.isFinite(offset) && Math.abs(offset) <= 14 * 60) {
    const hour = new Date(now + offset * 60_000).getUTCHours();
    if (start < end ? hour >= start && hour < end : hour >= start || hour < end) return false;
  }
  return true;
}

export type NotificationEditorState = {
  profile: NotificationProfile | null;
  loading: boolean;
  pending: NotificationPreferenceKey | null;
  issue: string | null;
};

/** One account-scoped editor for web and native. Writes patch one server key;
 * refreshes and late failures cannot overwrite a newer choice or another user. */
export function createNotificationPreferenceEditor(options: {
  initialProfile?: NotificationProfile | null;
  isCurrent: () => boolean;
  read: (signal: AbortSignal) => Promise<NotificationProfile>;
  write: (key: NotificationPreferenceKey, enabled: boolean, signal: AbortSignal) => Promise<unknown>;
  onState: (state: NotificationEditorState) => void;
  timeoutMs?: number;
}) {
  let disposed = false, version = 0;
  let controller: AbortController | null = null;
  let state: NotificationEditorState = { profile: options.initialProfile ?? null, loading: false, pending: null, issue: null };
  const current = () => !disposed && options.isCurrent();
  const publish = (patch: Partial<NotificationEditorState>) => {
    state = { ...state, ...patch };
    if (current()) options.onState(state);
  };
  const operation = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    controller?.abort();
    const owned = new AbortController();
    controller = owned;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new Promise<never>((_, reject) => {
      owned.signal.addEventListener('abort', () => reject(new Error('This request was interrupted. Please try again.')), { once: true });
      timer = setTimeout(() => owned.abort(), options.timeoutMs ?? 12_000);
    });
    try { return await Promise.race([Promise.resolve().then(() => {
      if (owned.signal.aborted || !current()) throw new Error('The account changed.');
      return fn(owned.signal);
    }), abort]); }
    finally { clearTimeout(timer); if (controller === owned) controller = null; }
  };
  return {
    getState: () => state,
    async load() {
      if (!current() || state.pending) return;
      const attempt = ++version;
      publish({ loading: true, issue: null });
      try {
        const profile = await operation(options.read);
        if (current() && attempt === version) publish({ profile, loading: false });
      } catch {
        if (current() && attempt === version) publish({ loading: false, issue: 'Notification settings could not be loaded. Please try again.' });
      }
    },
    async set(key: NotificationPreferenceKey, enabled: boolean) {
      if (!current() || !state.profile || state.pending || typeof enabled !== 'boolean'
        || (key !== 'all' && !NOTIFICATION_CATEGORIES.includes(key))) return false;
      const previous = state.profile, attempt = ++version;
      publish({ profile: { ...previous, notif_prefs: { ...notificationPreferences(previous.notif_prefs), [key]: enabled } }, pending: key, loading: false, issue: null });
      try {
        const result = await operation(signal => options.write(key, enabled, signal));
        if (!current() || attempt !== version) return false;
        if (!result || typeof result !== 'object' || Array.isArray(result) || (result as Record<string, unknown>)[key] !== enabled) {
          throw new Error('The server did not confirm this preference.');
        }
        publish({ profile: { ...previous, notif_prefs: notificationPreferences(result) }, pending: null });
        return true;
      } catch {
        if (current() && attempt === version) publish({ profile: previous, pending: null, issue: 'That change could not be saved. Please try again.' });
        return false;
      }
    },
    dispose() { disposed = true; version++; controller?.abort(); controller = null; },
  };
}
