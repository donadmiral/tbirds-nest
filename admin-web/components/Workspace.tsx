'use client';

/**
 * The workspace swap. The rail and topbar hold still; only this region fades
 * and lifts as one desk replaces another. 180ms, once, never looping.
 */

import { usePathname } from 'next/navigation';

export default function Workspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="pc-work" style={{ flex: 1, minWidth: 0, padding: '22px 22px 30px' }}>
      {children}
    </div>
  );
}
