'use client';

/**
 * The workspace swap. The rail and topbar hold still; only this region fades
 * and lifts as one desk replaces another. 180ms, once, never looping.
 */

import { usePathname } from 'next/navigation';

export default function Workspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div id="workspace" tabIndex={-1} key={pathname} className="pc-work pc-workspace" style={{ flex: 1, minWidth: 0 }}>
      {children}
    </div>
  );
}
