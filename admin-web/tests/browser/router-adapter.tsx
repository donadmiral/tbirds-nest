/** Isolated browser-test adapter. Never imported by an application route. */
import { useSyncExternalStore, type ComponentProps } from 'react';
const subscribe = (callback: () => void) => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); };
const snapshot = () => window.location.pathname;
const navigate = (href: string) => { window.history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); };
export function usePathname() { return useSyncExternalStore(subscribe, snapshot, () => '/dashboard'); }
// This fixture changes history synchronously. Real route-loading feedback is
// verified separately against the deployed Next.js router.
export function useLinkStatus() { return { pending: false }; }
export function useRouter() { return { push: navigate, replace: navigate, refresh() { window.dispatchEvent(new CustomEvent('fixture:refresh')); } }; }
export default function Link({ href, onClick, ...props }: ComponentProps<'a'>) {
  return <a {...props} href={href} onClick={event => { onClick?.(event); if (!event.defaultPrevented && href?.startsWith('/') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(href); } }} />;
}
