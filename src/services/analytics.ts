/**
 * Analytics scaffold. No-op by default.
 *
 * Every screen and action in the app calls into this module. The day you
 * pick a provider (PostHog, Amplitude, Segment, Mixpanel, Supabase events,
 * anything), you wire the provider SDK inside these four functions and the
 * entire app starts reporting with zero changes to any screen.
 *
 * Design rules:
 * - Never throws. Analytics failures must not break the app.
 * - Never awaits in hot paths. Fire and forget.
 * - Typed event names would be ideal but would also slow you down right
 *   now. Keep it string-based until you have 50+ events and want discipline.
 */

type Props = Record<string, string | number | boolean | null | undefined>;

let userId: string | null = null;
let userProps: Props = {};
const DEBUG = __DEV__; // log to console in dev, silent in prod

function safeLog(tag: string, ...args: any[]) {
  if (!DEBUG) return;
  try { console.log('[analytics]', tag, ...args); } catch {}
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Called once at app start and whenever the signed-in user changes.
 * Pass null on sign-out.
 */
export function identify(id: string | null, props: Props = {}) {
  userId = id;
  userProps = id ? { ...props } : {};
  safeLog('identify', id, props);
  // Wire provider here later: posthog.identify(id, props) etc.
}

/**
 * Record a user action. Keep names snake_case and stable.
 * Example: track('post_liked', { post_id: '123' })
 */
export function track(event: string, props: Props = {}) {
  safeLog('track', event, props);
  // Wire provider here later: posthog.capture(event, props) etc.
}

/**
 * Record a screen view. Call this once per screen on focus.
 * Example: track_screen('Feed')
 */
export function trackScreen(name: string, props: Props = {}) {
  safeLog('screen', name, props);
  // Wire provider here later: posthog.screen(name, props) etc.
}

/**
 * Record a caught error. Called by ErrorBoundary and try/catch sites that
 * want non-fatal errors visible.
 */
export function trackError(err: unknown, context: Props = {}) {
  __shipError(err, context, false);
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  safeLog('error', message, context, stack);
  // Wire provider here later: Sentry.captureException(err, { extra: context })
}

/**
 * Read-only accessor. Mostly for debugging.
 */
export function currentUser() {
  return { id: userId, props: userProps };
}

// Default export for convenience: import analytics from '../services/analytics';
// analytics.track('foo')
const analytics = { identify, track, trackScreen, trackError, currentUser };
export default analytics;
/**
 * Durable crash shipping: every tracked or uncaught error writes itself
 * to client_errors. Fire and forget, never throws, lazy-requires the
 * client to avoid import cycles. The global handler nets crashes that
 * never reach a boundary.
 */
function __shipError(err: unknown, context: Props, fatal: boolean) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const { supabase } = require('./supabase');
    const Platform = require('react-native').Platform;
    let ver: string | null = null;
    try { ver = require('expo-constants').default?.expoConfig?.version ?? null; } catch {}
    supabase.from('client_errors').insert({
      user_id: currentUser().id ?? null,
      message: String(e.message || 'unknown').slice(0, 500),
      stack: String(e.stack || '').slice(0, 4000),
      context: { ...context, fatal },
      platform: Platform.OS,
      app_version: ver,
    }).then(() => {}, () => {});
  } catch {}
}

try {
  const EU: any = (globalThis as any).ErrorUtils;
  if (EU && EU.getGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e: any, isFatal?: boolean) => {
      __shipError(e, { source: 'global' }, !!isFatal);
      if (prev) prev(e, isFatal);
    });
  }
} catch {}