'use client';
import { useEffect, useRef, useState } from 'react';
import { liveCommand, liveError, record, type LiveClient, type LiveDetail } from '@/lib/liveApi';

export function LiveGuestRequests({ client, detail, ownerId, scope, onRefresh, onJoin, inStudio = false }: {
  client: LiveClient; detail: LiveDetail; ownerId: string; scope: string; onRefresh(): Promise<unknown>; onJoin(): void; inStudio?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState('');
  const epoch = useRef(0), lock = useRef(false), request = useRef<{ key: string; id: string } | null>(null);
  const key = `${scope}:${detail.session.id}`, currentKey = useRef(key); currentKey.current = key;
  useEffect(() => { epoch.current++; lock.current = false; request.current = null; setPending(null); setError(''); return () => { epoch.current++; }; }, [key]);
  useEffect(() => {
    let alive = true, serial = 0, channel: ReturnType<LiveClient['channel']> | null = null;
    const current = () => alive && currentKey.current === key;
    const refresh = () => { if (current() && !document.hidden) void onRefresh(); };
    const leave = () => { serial++; if (channel) { void client.removeChannel(channel); channel = null; } };
    const join = async () => {
      leave();
      if (document.hidden || detail.guest_topic !== `live-guests:${detail.session.id}:${ownerId}`) return;
      const connection = serial;
      const { data } = await client.auth.getSession();
      if (!current() || serial !== connection || data.session?.user.id !== ownerId) return;
      await client.realtime.setAuth(data.session.access_token);
      if (!current() || serial !== connection) return;
      channel = client.channel(detail.guest_topic, { config: { private: true } })
        .on('broadcast', { event: 'guest_requests_changed' }, ({ payload }) => {
          if (!current() || serial !== connection || record(payload) && payload.session_id && payload.session_id !== detail.session.id) return;
          refresh();
        }).subscribe(status => { if (current() && serial === connection && status === 'SUBSCRIBED') refresh(); });
    };
    const foreground = () => { if (document.hidden) leave(); else { refresh(); void join().catch(() => {}); } };
    void join().catch(() => {});
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', foreground); window.addEventListener('focus', refresh);
    return () => { alive = false; leave(); clearInterval(timer); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('focus', refresh); };
  }, [client, key, detail.guest_topic, detail.session.id, ownerId, onRefresh]);

  const run = async (action: string, userId?: string) => {
    if (lock.current) return;
    lock.current = true; const version = epoch.current, intent = `${action}:${userId || ''}`;
    setPending(intent); setError('');
    if (request.current?.key !== intent) request.current = { key: intent, id: crypto.randomUUID() };
    try {
      const result = await liveCommand(client, detail.session.id, action, userId ? { user_id: userId } : {}, request.current.id);
      if (version !== epoch.current || currentKey.current !== key) return;
      if (result.ok !== true) throw Error('INVALID_SERVICE_RESPONSE');
      await onRefresh();
      if (version === epoch.current && currentKey.current === key) request.current = null;
    } catch (cause) { if (version === epoch.current && currentKey.current === key) setError(liveError(cause)); }
    finally { if (version === epoch.current && currentKey.current === key) { lock.current = false; setPending(null); } }
  };
  const manager = ['host', 'producer'].includes(detail.role), active = ['backstage', 'starting', 'live', 'reconnecting'].includes(detail.session.state);
  const status = detail.own_join_request?.status, accepted = status === 'accepted' && detail.role === 'guest';
  if (!active || !manager && !detail.can_request_join && status !== 'pending' && !accepted) return null;
  const button = 'min-h-11 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40';
  return <section aria-label="Join the live" className="space-y-3 rounded-xl border border-ink/15 bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-ink">{manager ? 'Guest requests' : 'Join the live'}</h2><p className="text-xs text-muted">{detail.stage.available} of {detail.stage.limit} places available</p></div>
    {error ? <p role="alert" className="text-sm text-ink">{error}</p> : null}
    {manager ? <div className="max-h-80 space-y-2 overflow-y-auto">{detail.join_requests.length ? detail.join_requests.map(person => {
      const name = person.profile.full_name || person.profile.username || 'Member';
      return <div key={person.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--canvas)] p-3"><span className="min-w-0 break-words text-sm text-ink">{name}</span><div className="flex flex-wrap gap-2"><button type="button" aria-label={`Accept ${name}`} disabled={!!pending || detail.stage.available < 1} className={button} onClick={() => void run('accept_join_request', person.user_id)}>{pending === `accept_join_request:${person.user_id}` ? 'Accepting…' : 'Accept'}</button><button type="button" aria-label={`Decline ${name}`} disabled={!!pending} className={button} onClick={() => void run('decline_join_request', person.user_id)}>Decline</button></div></div>;
    }) : <p className="text-sm text-muted">No requests yet.</p>}</div> : accepted ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-ink">{inStudio ? 'Use the studio controls to manage your camera and microphone.' : 'Your request was accepted. Your camera and microphone stay off until you choose to join.'}</p>{!inStudio ? <button type="button" className={button} onClick={onJoin}>Join camera</button> : null}</div> : status === 'pending' ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-ink">Waiting for the host to accept.</p><button type="button" disabled={!!pending} className={button} onClick={() => void run('cancel_join_request')}>{pending ? 'Cancelling…' : 'Cancel request'}</button></div> : <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted">{status === 'declined' ? 'The host declined your request. You can ask again.' : 'Ask the host to join on camera.'}</p><button type="button" disabled={!!pending || detail.stage.available < 1} className={button} onClick={() => void run('request_join')}>{pending ? 'Requesting…' : 'Request to join'}</button></div>}
  </section>;
}
