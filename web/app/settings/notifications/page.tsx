"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { AtSign, Bell, Briefcase, CreditCard, Heart, MessageCircle, MessageSquare, Phone, Radio, Shield, Smile, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getNavigationStore } from "@/lib/navigationCache";
import { categoryEnabled, createNotificationPreferenceEditor, pushEnabled,
  type NotificationCategory, type NotificationEditorState, type NotificationPreferenceKey } from "../../../../shared/notificationPreferences";

// Instagram's categories, one switch each. These decide which kinds of activity reach the phone as a push;
// the Activity list always shows everything. The server maps every notification type to one category.
const CATEGORIES: { key: NotificationCategory; icon: React.ReactNode; label: string; sub: string }[] = [
  { key: "messages", icon: <MessageCircle size={16} />, label: "Messages", sub: "Direct messages, group messages and message requests" },
  { key: "message_reactions", icon: <Smile size={16} />, label: "Message reactions", sub: "Reactions to your messages" },
  { key: "calls", icon: <Phone size={16} />, label: "Calls", sub: "Incoming and missed voice and video calls" },
  { key: "likes", icon: <Heart size={16} />, label: "Likes", sub: "Likes on your posts, stories and comments, and reposts" },
  { key: "comments", icon: <MessageSquare size={16} />, label: "Comments", sub: "Comments on your posts and replies to your comments" },
  { key: "mentions", icon: <AtSign size={16} />, label: "Mentions and tags", sub: "When someone mentions or tags you in a post or story" },
  { key: "followers", icon: <UserPlus size={16} />, label: "Followers", sub: "New followers, follow requests and accepted requests" },
  { key: "updates", icon: <Radio size={16} />, label: "Content updates", sub: "Community and collab invitations, channel posts and business pages" },
  { key: "jobs", icon: <Briefcase size={16} />, label: "Jobs", sub: "Applications and referrals on your job posts" },
  { key: "payments", icon: <CreditCard size={16} />, label: "Payments", sub: "Money received in chat" },
  { key: "account", icon: <Shield size={16} />, label: "Account notices", sub: "Security alerts, sign-ins and system notices" },
];

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled: boolean }) {
  return <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    className={"relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[140ms] disabled:cursor-wait disabled:opacity-50 " + (on ? "bg-pearl" : "bg-ink/20")}>
    <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-[140ms] " + (on ? "translate-x-[22px]" : "translate-x-0.5")} />
  </button>;
}

const EMPTY_STATE: NotificationEditorState = { profile: null, pending: null, loading: true, issue: null };

export default function NotificationSettingsPage() {
  const [supabase] = useState(createClient);
  const [store] = useState(getNavigationStore);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const editor = useRef<ReturnType<typeof createNotificationPreferenceEditor> | null>(null);
  const [savedState, setSavedState] = useState<{ scope: string; state: NotificationEditorState } | null>(null);
  const state = savedState?.scope === session.scope ? savedState!.state : EMPTY_STATE;

  useEffect(() => {
    const owner = session.owner, scope = session.scope;
    if (!owner || !scope) return;
    const current = createNotificationPreferenceEditor({
      isCurrent: () => store.getSnapshot().scope === scope && store.getSnapshot().owner === owner,
      read: async signal => {
        const { data, error } = await supabase.from('profiles').select('notif_prefs,notif_messages,notif_connections,notif_jobs')
          .eq('id', owner).abortSignal(signal).single();
        if (error || !data) throw error ?? new Error('Notification settings unavailable');
        return data;
      },
      write: async (key, enabled, signal) => {
        const { data, error } = await supabase.rpc('set_notification_preference', { p_key: key, p_enabled: enabled }).abortSignal(signal);
        if (error) throw error;
        return data;
      },
      onState: value => setSavedState({ scope, state: value }),
    });
    editor.current = current;
    void current.load();
    return () => { current.dispose(); if (editor.current === current) editor.current = null; };
  }, [session.owner, session.scope, store, supabase]);

  const set = (key: NotificationPreferenceKey, enabled: boolean) => { void editor.current?.set(key, enabled); };
  const enabled = pushEnabled(state.profile ?? {});
  const busy = !state.profile || state.pending !== null;

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><Bell size={19} className="text-accent" /> Notifications</h1>
      <p className="pb-5 text-[13px] text-muted">Choose which kinds of activity reach your phone as a push. The Activity list always shows everything, and quiet hours are set on the phone.</p>
      {state.issue ? <div role="alert" className="pb-3 text-sm text-danger"><p>{state.issue}</p>
        <button type="button" onClick={() => { void editor.current?.load(); }} disabled={busy && !!state.profile} className="mt-2 underline">Retry notification settings</button></div> : null}
      {session.initialized && !session.owner ? <p className="py-10 text-sm text-muted">Sign in to manage your notifications.</p>
        : !state.profile ? <p role="status" className="py-10 text-center text-sm text-muted">{state.loading ? 'Loading your saved choices…' : 'Your saved choices are unavailable.'}</p> : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 rounded-lg border border-ink/10 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-accent"><Bell size={16} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-ink">Push notifications</span>
              <span className="block text-[12px] text-muted">Pause all alerts and keep your category choices.</span></span>
            <Toggle on={enabled} onChange={v => set('all', v)} label="Push notifications" disabled={busy} />
          </div>
          {CATEGORIES.map((c) => (
            <div key={c.key} className="flex items-center gap-3 rounded-lg border border-ink/10 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-accent">{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{c.label}</span>
                <span className="block text-[12px] text-muted">{c.sub}</span>
              </span>
              <Toggle on={enabled && categoryEnabled(state.profile!, c.key)} onChange={(v) => set(c.key, v)} label={c.label} disabled={busy || !enabled} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
