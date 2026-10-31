import type { ComponentProps } from 'react';
export default function Link(props: ComponentProps<'a'> & { prefetch?: boolean; replace?: boolean; scroll?: boolean }) {
  const html = { ...props }; delete html.prefetch; delete html.replace; delete html.scroll;
  return <a {...html} />;
}
export function usePathname() { return window.location.pathname; }
export function useRouter() { return { push: (href: string) => window.location.assign(href), replace: (href: string) => window.location.replace(href), refresh: () => window.location.reload() }; }
