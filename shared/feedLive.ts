export type FeedLivePost = { id: string; authorId: string };
export type FeedLiveRequest = { signal: AbortSignal; current: () => boolean };
export type FeedLiveRow = {
  post_id: string; content: string | null; body: string | null;
  likes_count: number; comments_count: number; reposts_count: number;
  bookmarks_count: number; shares_count: number; views_count: number;
  viewer_liked: boolean; viewer_bookmarked: boolean; viewer_reposted: boolean;
  comment_id: string | null; comment_body: string | null; comment_author: string | null;
  delivery_healthy: boolean;
};
type Client = { rpc: (name: string, args?: Record<string, unknown>) => any; channel: (name: string, options?: any) => any; removeChannel: (channel: any) => unknown };
type ChannelListener = { receive: () => void; status: (value: string) => void };
type ChannelLease = { channel: any; listeners: Set<ChannelListener>; status: string | null };
const sharedChannels = new WeakMap<Client, Map<string, ChannelLease>>();
const closingChannels = new WeakMap<Client, Map<string, Promise<void>>>();

/** The installed SDK reuses channels by topic. Share active leases, and wait
 * for an old leave before acquiring the same topic after rapid focus/auth or
 * Strict Mode cleanup. Otherwise a new owner can inherit a leaving channel. */
function acquireChannel(client: Client, topic: string, event: string, listener: ChannelListener) {
  let active = sharedChannels.get(client); if (!active) { active = new Map(); sharedChannels.set(client, active); }
  let closing = closingChannels.get(client); if (!closing) { closing = new Map(); closingChannels.set(client, closing); }
  let lease = active.get(topic);
  if (lease) {
    lease.listeners.add(listener);
    const status = lease.status;
    if (status) void Promise.resolve().then(() => { if (lease!.listeners.has(listener)) listener.status(status); });
  } else {
    lease = { channel: null, listeners: new Set([listener]), status: null }; active.set(topic, lease);
    const owned = lease;
    void (async () => {
      await closing!.get(topic);
      if (active!.get(topic) !== owned || !owned.listeners.size) return;
      try {
        owned.channel = client.channel(topic, { config: { private: true } });
        owned.channel.on('broadcast', { event }, () => [...owned.listeners].forEach(item => item.receive()))
          .subscribe((status: string) => { owned.status = status; [...owned.listeners].forEach(item => item.status(status)); });
      } catch { owned.status = 'CHANNEL_ERROR'; [...owned.listeners].forEach(item => item.status('CHANNEL_ERROR')); }
    })();
  }
  const owned = lease;
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size || active!.get(topic) !== owned) return;
    active!.delete(topic);
    if (!owned.channel) return;
    const pending = Promise.resolve().then(() => client.removeChannel(owned.channel)).then(() => {}, () => {});
    closing!.set(topic, pending);
    void pending.finally(() => { if (closing!.get(topic) === pending) closing!.delete(topic); });
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FEED_LIVE_MAX_IDS = 24;

/** A small look-ahead window prepares state without altering rendered rows,
 * scroll offsets, list keys or media ownership. */
export function feedLiveWindow(posts: FeedLivePost[], anchor: string | null, limit = 12): FeedLivePost[] {
  const unique = [...new Map(posts.filter(post => UUID.test(post.id) && UUID.test(post.authorId)).map(post => [post.id, post])).values()];
  const size = Math.max(1, Math.min(FEED_LIVE_MAX_IDS, limit));
  const index = Math.max(0, unique.findIndex(post => post.id === anchor));
  const start = Math.max(0, Math.min(index - 3, unique.length - size));
  return unique.slice(start, start + size);
}

/** Broadcast only invalidates known IDs. All displayed values are read again
 * through the caller's RLS. Legacy subscriptions stay available until the
 * server explicitly advertises a configured, healthy protocol. */
export function createFeedLive(options: {
  client: Client; owner: string; current: () => boolean;
  mode: (broadcast: boolean) => void;
  apply: (ids: string[], rows: FeedLiveRow[], requestedAt: number) => string[] | void;
  head: (request: FeedLiveRequest) => Promise<void>;
  hasPending: () => boolean;
  access: (authors: string[] | null, request: FeedLiveRequest) => Promise<void>;
  active?: boolean; random?: () => number;
}) {
  let active = options.active !== false, disposed = false, broadcast = false, deliveryHealthy = false, generation = 0;
  let probing = false, reading = false, headReading = false, accessReading = false, windowRevision = 0;
  let headDirty = false, allAccess = false, failures = 0, accessFailures = 0, nextRead = 0, nextHead = 0, nextAccess = 0;
  let recoveryGeneration: number | null = null, recoveryAccess = false, nextRecoveryAccess = 0;
  let nextWindowSync = 0;
  let window = new Map<string, FeedLivePost>();
  const dirty = new Set<string>(), versions = new Map<string, number>(), authorsDirty = new Set<string>();
  const channels = new Map<string, { release: () => void; connected: boolean; joined: boolean }>();
  const requests = new Set<AbortController>();
  let stateTimer: ReturnType<typeof setTimeout> | undefined, headTimer: ReturnType<typeof setTimeout> | undefined;
  let accessTimer: ReturnType<typeof setTimeout> | undefined, recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let windowTimer: ReturnType<typeof setTimeout> | undefined;
  const current = () => active && !disposed && options.current();
  const jitter = (ms: number) => Math.round(ms * (0.8 + (options.random ?? Math.random)() * .4));
  async function request<T>(work: (signal: AbortSignal) => PromiseLike<T> | T): Promise<T> {
    const controller = new AbortController(); requests.add(controller);
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void = () => {};
    const timeout = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('Feed update cancelled.'));
      controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error('Feed update timed out.')); }, 10000);
    });
    try {
      const result = await Promise.race([work(controller.signal), timeout]);
      if (controller.signal.aborted) throw new Error('Feed update cancelled.');
      return result;
    } finally { clearTimeout(timer!); controller.signal.removeEventListener('abort', abort); requests.delete(controller); }
  }
  async function rpc(name: string, args?: Record<string, unknown>) {
    const result = await request(signal => options.client.rpc(name, args).abortSignal(signal)) as { data: any; error: any };
    if (result.error) throw result.error;
    return result.data;
  }
  function disconnect() {
    for (const { release } of channels.values()) release();
    channels.clear();
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer); recoveryTimer = undefined;
  }
  function setMode(value: boolean) {
    if (broadcast === value) return;
    broadcast = value;
    if (!value) disconnect();
    options.mode(value);
  }
  function scheduleRecovery() {
    if (deliveryHealthy && ![...channels.values()].some(channel => !channel.connected)) {
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer); recoveryTimer = undefined; return;
    }
    if (!current() || !broadcast || recoveryTimer !== undefined) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!current() || !broadcast) return;
      invalidate([...window.keys()]); headDirty = true; scheduleHead();
      scheduleRecovery();
    }, Math.min(30000, jitter(30000)));
  }
  function subscribe(topic: string, event: string, receive: () => void, onReconnect?: () => void) {
    if (channels.has(topic)) return;
    const entry = { release: () => {}, connected: false, joined: false };
    channels.set(topic, entry);
    entry.release = acquireChannel(options.client, topic, event, {
      receive: () => { if (current() && channels.get(topic) === entry) receive(); },
      status: (status: string) => {
        if (!current() || channels.get(topic) !== entry) return;
        const rejoined = entry.joined, wasConnected = entry.connected;
        entry.connected = status === 'SUBSCRIBED';
        if (entry.connected) {
          entry.joined = true;
          if (!wasConnected && rejoined) onReconnect?.();
          // Cover the gap between the first canonical read and channel join.
          if (!wasConnected && !rejoined && (topic.startsWith('feed:post:') || topic.startsWith('feed:viewer:') || topic === 'feed:head:v1')) receive();
          if (deliveryHealthy && [...channels.values()].every(channel => channel.connected) && recoveryTimer !== undefined) {
            clearTimeout(recoveryTimer); recoveryTimer = undefined;
          }
        } else scheduleRecovery();
      },
    });
    scheduleRecovery();
  }
  function syncChannels() {
    if (!current() || !broadcast) return;
    const wanted = new Set<string>(['feed:viewer:' + options.owner, 'feed:recovery:v1']);
    for (const post of window.values()) { wanted.add('feed:post:' + post.id); wanted.add('feed:author:' + post.authorId); }
    if (!options.hasPending()) wanted.add('feed:head:v1');
    for (const [topic, entry] of channels) if (!wanted.has(topic)) { channels.delete(topic); entry.release(); }
    const accessAll = () => { allAccess = true; invalidate([...window.keys()]); scheduleAccess(); headDirty = true; scheduleHead(); };
    subscribe('feed:viewer:' + options.owner, 'invalidate', accessAll, accessAll);
    subscribe('feed:recovery:v1', 'resync', recoverDelivery, recoverDelivery);
    for (const post of window.values()) {
      const changed = () => invalidate([post.id]);
      subscribe('feed:post:' + post.id, 'invalidate', changed, changed);
      const authorChanged = () => {
        authorsDirty.add(post.authorId);
        invalidate([...window.values()].filter(row => row.authorId === post.authorId).map(row => row.id));
        scheduleAccess();
      };
      subscribe('feed:author:' + post.authorId, 'invalidate', authorChanged, authorChanged);
    }
    if (!options.hasPending()) {
      const changed = () => { headDirty = true; scheduleHead(); };
      subscribe('feed:head:v1', 'new_posts', changed, changed);
    }
  }
  function recoverDelivery() {
    // Recovery hints contain no IDs or content. Late outage transactions can
    // emit a second hint, so keep a trailing refresh and bound global sweeps.
    invalidate([...window.keys()]); allAccess = true; recoveryAccess = true;
    nextAccess = Math.max(nextAccess, nextRecoveryAccess); scheduleAccess();
    headDirty = true; scheduleHead();
  }
  function scheduleState() {
    if (!current() || !broadcast || reading || !dirty.size || stateTimer !== undefined) return;
    stateTimer = setTimeout(() => { stateTimer = undefined; void readState(); }, Math.max(jitter(350), nextRead - Date.now()));
  }
  function invalidate(ids: string[]) {
    // A new hint during a read stays dirty for a trailing read. It does not
    // starve canonical snapshots while a popular post changes continuously.
    for (const id of ids) if (window.has(id)) dirty.add(id);
    scheduleState();
  }
  async function readState() {
    if (!current() || !broadcast || reading) return;
    const ids = [...dirty].filter(id => window.has(id)).slice(0, FEED_LIVE_MAX_IDS);
    if (!ids.length) return;
    ids.forEach(id => dirty.delete(id));
    const before = new Map(ids.map(id => [id, versions.get(id)]));
    const token = generation, requestedAt = Date.now(); reading = true;
    try {
      const data = await rpc('get_feed_live_state', { p_ids: ids });
      if (!current() || token !== generation) return;
      if (!Array.isArray(data)) throw new Error('Invalid feed state response.');
      if (data.length) deliveryHealthy = data.every(row => row.delivery_healthy !== false);
      scheduleRecovery();
      const accepted = ids.filter(id => window.has(id) && versions.get(id) === before.get(id));
      const allowed = new Set(accepted);
      const retry = options.apply(accepted, (data as FeedLiveRow[]).filter(row => allowed.has(row.post_id)), requestedAt);
      retry?.forEach(id => { if (window.has(id)) dirty.add(id); });
      failures = 0;
      nextRead = Date.now() + jitter(2000);
    } catch (error: any) {
      if (!current() || token !== generation) return;
      if (error?.code === 'PGRST202' || error?.code === '42883' || error?.code === '55000') {
        setMode(false); return;
      }
      ids.forEach(id => { if (window.has(id)) dirty.add(id); });
      failures++;
      nextRead = Date.now() + Math.min(30000, jitter(2000 * 2 ** Math.min(failures, 4)));
    } finally {
      if (token === generation) { reading = false; scheduleState(); }
    }
  }
  function scheduleHead() {
    if (!current() || !broadcast || !headDirty || headReading || headTimer !== undefined || options.hasPending()) return;
    // Invisible/private/unrelated new posts cannot cause a head-read storm.
    // Even without a populated pill, repeated hints read at most once/15s.
    headTimer = setTimeout(() => { headTimer = undefined; void readHead(); }, Math.max(jitter(500), nextHead - Date.now()));
  }
  async function readHead() {
    if (!current() || !broadcast || headReading || options.hasPending()) return;
    const token = generation; headReading = true; headDirty = false;
    try { await request(signal => options.head({ signal, current: () => current() && token === generation && !signal.aborted })); }
    catch { if (token === generation && current()) headDirty = true; }
    finally {
      if (token === generation) {
        headReading = false; nextHead = Date.now() + 15000 + jitter(1000);
        syncChannels(); scheduleHead();
      }
    }
  }
  function scheduleAccess() {
    if (!current() || !broadcast || accessReading || accessTimer !== undefined || (!allAccess && !authorsDirty.size)) return;
    accessTimer = setTimeout(() => { accessTimer = undefined; void readAccess(); }, Math.max(jitter(500), nextAccess - Date.now()));
  }
  async function readAccess() {
    if (!current() || !broadcast || accessReading) return;
    const token = generation, authors = allAccess ? null : [...authorsDirty];
    if (recoveryAccess) nextRecoveryAccess = Date.now() + 15000;
    recoveryAccess = false;
    allAccess = false; authorsDirty.clear(); accessReading = true;
    try { await request(signal => options.access(authors, { signal, current: () => current() && token === generation && !signal.aborted })); accessFailures = 0; }
    catch { if (token === generation && current()) { allAccess = true; accessFailures++; } }
    finally { if (token === generation) {
      accessReading = false; nextAccess = Date.now() + Math.min(30000, jitter(2000 * 2 ** Math.min(accessFailures, 4))); scheduleAccess();
    } }
  }
  async function probe() {
    if (!current() || probing) return;
    const token = generation; probing = true;
    try {
      const capability = await rpc('get_feed_live_capability');
      if (!current() || token !== generation) return;
      deliveryHealthy = capability?.enabled === true;
      const latestRecovery = Number.isSafeInteger(capability?.recovery_generation) ? capability.recovery_generation as number : 0;
      const recovered = recoveryGeneration !== null && latestRecovery !== recoveryGeneration;
      recoveryGeneration = latestRecovery;
      setMode(capability?.version === 1 && (deliveryHealthy || (broadcast && capability.configured === true)) && capability.max_ids >= FEED_LIVE_MAX_IDS);
      if (broadcast) { syncChannels(); invalidate([...window.keys()]); if (recovered) recoverDelivery(); }
    } catch (error: any) {
      if (current() && token === generation) {
        if (error?.code === 'PGRST202' || error?.code === '42883') setMode(false);
        else { deliveryHealthy = false; scheduleRecovery(); }
      }
    }
    finally { if (token === generation) probing = false; }
  }
  function pause() {
    generation++; probing = false; reading = false; headReading = false; accessReading = false;
    for (const timer of [stateTimer, headTimer, accessTimer, recoveryTimer, windowTimer]) if (timer !== undefined) clearTimeout(timer);
    stateTimer = headTimer = accessTimer = recoveryTimer = windowTimer = undefined;
    requests.forEach(request => request.abort()); requests.clear(); disconnect();
  }
  return {
    start: probe, invalidate,
    setWindow(posts: FeedLivePost[]) {
      if (disposed) return;
      const next = new Map(posts.filter(post => UUID.test(post.id) && UUID.test(post.authorId)).slice(0, FEED_LIVE_MAX_IDS).map(post => [post.id, post]));
      if (next.size === window.size && [...next.values()].every(post => window.get(post.id)?.authorId === post.authorId)) return;
      const added = [...next.keys()].filter(id => window.get(id)?.authorId !== next.get(id)?.authorId);
      added.forEach(id => versions.set(id, ++windowRevision));
      window = next;
      for (const id of dirty) if (!window.has(id)) dirty.delete(id);
      for (const id of versions.keys()) if (!window.has(id)) versions.delete(id);
      if (windowTimer !== undefined) clearTimeout(windowTimer);
      if (current() && broadcast) windowTimer = setTimeout(() => {
        windowTimer = undefined; nextWindowSync = Date.now() + 2000; syncChannels();
      }, Math.max(350, nextWindowSync - Date.now()));
      invalidate(added);
    },
    pendingChanged() {
      if (options.hasPending()) { headDirty = false; if (headTimer !== undefined) clearTimeout(headTimer); headTimer = undefined; }
      syncChannels();
    },
    setActive(value: boolean) {
      if (disposed || value === active) return;
      active = value;
      if (value) void probe(); else pause();
    },
    dispose() { disposed = true; active = false; pause(); window.clear(); dirty.clear(); versions.clear(); },
  };
}
