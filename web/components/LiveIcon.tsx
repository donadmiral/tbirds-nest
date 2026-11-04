import type { SVGProps } from 'react';
export function LiveIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={Math.round(size * 44 / 24)} height={size} viewBox="0 0 44 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <rect x="1" y="2" width="33" height="20" rx="5" />
    <path d="m34 9 8-4v14l-8-4" />
    <path d="M6 8v8h4M13 8v8M17 8l3 8 3-8M31 8h-5v8h5M26 12h4" strokeWidth="1.6" />
  </svg>;
}
