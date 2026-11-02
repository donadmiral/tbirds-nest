import type { SVGProps } from 'react';
export function LiveIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M5 6a8.5 8.5 0 0 0 0 12M2.5 3a12.5 12.5 0 0 0 0 18M19 6a8.5 8.5 0 0 1 0 12M21.5 3a12.5 12.5 0 0 1 0 18" />
    <path d="m10 8 6 4-6 4Z" fill="currentColor" stroke="none" />
  </svg>;
}
