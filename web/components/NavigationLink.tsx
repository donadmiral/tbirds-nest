'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

/** Full dynamic-page prefetch is limited to an actual navigation intention. */
export function NavigationLink({ onPointerEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const warm = () => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (navigator.onLine === false || connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g') return;
    setIntent(true);
  };
  return <Link {...props} prefetch={intent}
    onPointerEnter={event => { warm(); onPointerEnter?.(event); }}
    onFocus={event => { warm(); onFocus?.(event); }}
    onTouchStart={event => { warm(); onTouchStart?.(event); }} />;
}
