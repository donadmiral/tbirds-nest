import type { CSSProperties } from 'react';

/** One optical grid and stroke weight for operations navigation and actions. */
export const ADMIN_ICON_PATHS = {
  dashboard: 'M3.5 3.5h7v7h-7zM14 3.5h6.5v4.75H14zM14 11.75h6.5v8.75H14zM3.5 14h7v6.5h-7z',
  analytics: 'M4 20.5V14m8 6.5V4m8 16.5V9',
  phone: 'M7.4 3.5H4.7a1.3 1.3 0 0 0-1.3 1.4 17.2 17.2 0 0 0 15.7 15.7 1.3 1.3 0 0 0 1.4-1.3v-2.7a1.3 1.3 0 0 0-1-1.3l-2.8-.7a1.3 1.3 0 0 0-1.3.4l-1.2 1.4a13.2 13.2 0 0 1-6.6-6.6L9 8.6a1.3 1.3 0 0 0 .4-1.3L8.7 4.5a1.3 1.3 0 0 0-1.3-1z',
  users: 'M15.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM4 20v-1.5A5.5 5.5 0 0 1 9.5 13h5a5.5 5.5 0 0 1 5.5 5.5V20',
  business: 'M4 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M16 10.5h3a1 1 0 0 1 1 1v9M8 20.5v-4h4v4M7.5 7.5h1m3 0h1m-5 4h1m3 0h1M2.5 20.5h19',
  organization: 'M3 20.5h18M5 20.5V7l7-3.5L19 7v13.5M9 20.5V15h6v5.5M9 9h.01M15 9h.01M9 12h.01M15 12h.01',
  market: 'M3.5 9 5 3.5h14L20.5 9M3.5 9v1a2.85 2.85 0 0 0 5.7 0 2.8 2.8 0 0 0 5.6 0 2.85 2.85 0 0 0 5.7 0V9h-17ZM5 12.5v8h14v-8M9 20.5v-5h6v5',
  jobs: 'M8 7V4.5h8V7M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm-1 5a25 25 0 0 0 18 0M10 11.5h4v3h-4z',
  payment: 'M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V6A1.5 1.5 0 0 1 4 4.5Zm-1.5 5h19M6 15.5h3m3 0h2',
  ads: 'M4 9h4l10-5v16L8 15H4a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 4 9Zm4 0v6m-2 0 1.5 5H11l-1.5-4M21 9v6',
  content: 'M5 3.5h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Zm3 4h8M8 12h8m-8 4.5h5',
  stories: 'M8 3.9a9 9 0 0 0-4.1 4.1M3 12a9 9 0 0 0 .9 4M8 20.1a9 9 0 0 0 4 .9m4-.9a9 9 0 0 0 4.1-4.1M21 12a9 9 0 0 0-.9-4M16 3.9a9 9 0 0 0-4-.9M9.5 8.5l6 3.5-6 3.5z',
  reports: 'M5 21V3.5m0 1c5-3 9 3 14 0v11c-5 3-9-3-14 0',
  verification: 'm12 2.5 2.6 1.8 3.1.1 1.1 2.9 2.2 2.2-1 3 .3 3.1-2.7 1.5-1.5 2.7-3.1-.3-3 1-2.2-2.2-2.9-1.1-.1-3.1L2.5 12l1.8-2.6.1-3.1 2.9-1.1 2.2-2.2 2.5-.5ZM8 12l2.6 2.6L16 9.2',
  support: 'M4 13v-1a8 8 0 0 1 16 0v1M4 11.5H3A1.5 1.5 0 0 0 1.5 13v3A1.5 1.5 0 0 0 3 17.5h3v-6H4Zm16 0h1a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3v-6h2Zm0 6a4 4 0 0 1-4 4h-3',
  audit: 'M7 3.5h10a1 1 0 0 1 1 1v16H6v-16a1 1 0 0 1 1-1Zm2 4h6M9 12h6m-6 4.5h3',
  staff: 'M10.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM1.5 20v-1.5A4.5 4.5 0 0 1 6 14h3a4.5 4.5 0 0 1 4.5 4.5V20M16.5 4.5a3 3 0 0 1 0 6M17 14h1a4.5 4.5 0 0 1 4.5 4.5V20',
  controls: 'M5 3v7m0 4v7M12 3v12m0 4v2M19 3v2m0 4v12M2.5 10h5v4h-5zM9.5 15h5v4h-5zM16.5 5h5v4h-5z',
  deletion: 'M3.5 6.5h17M9 6.5v-3h6v3M5.5 6.5l1 14h11l1-14M10 10v7m4-7v7',
  order: 'm3.5 7 8.5-4 8.5 4v10L12 21l-8.5-4V7Zm0 0 8.5 4 8.5-4M12 11v10M8 5l8.5 4',
  review: 'm12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 9.6l6.3-.9L12 3Z',
  presentation: 'M3 4h18v13H3zM12 17v4m-4 0 4-4 4 4M7 12V9m5 3V7m5 5v-2',
  security: 'm12 3 8 3v5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6l8-3Zm-3.5 9 2.5 2.5 4.5-5',
  search: 'M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Zm-2 5.5 5 5',
  close: 'm6 6 12 12M6 18 18 6',
  expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  music: 'M9 18V5l12-2v13M9 9l12-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  arrowLeft: 'M20 12H4m6-6-6 6 6 6',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  arrowUpRight: 'M6 18 18 6M6 6h12v12',
  menu: 'M4 6h16M4 12h16M4 18h16',
  pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Zm3 12v6',
  panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm4 0v16m7-11-3 3 3 3',
  bell: 'M18.5 8.5a6.5 6.5 0 0 0-13 0V13L3 17h18l-2.5-4V8.5ZM9 20h6',
  check: 'm5 12 4.5 4.5L19 7',
  plus: 'M12 4v16M4 12h16',
  refresh: 'M20 4v6h-6M4 20v-6h6m9.3-6A8 8 0 0 0 5.5 5.5L4 8m16 8-1.5 2.5A8 8 0 0 1 4.7 16',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M20.3 14.5A8.8 8.8 0 0 1 9.5 3.7a8.8 8.8 0 1 0 10.8 10.8Z',
  monitor: 'M5 3.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2ZM12 17.5v4m-4 0h8',
  logout: 'M9 3.5H4.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1H9M9 12h12m-5-5 5 5-5 5',
  history: 'M3 4v6h6M3.5 9a8.5 8.5 0 1 1 .3 6M12 7v5l3 2',
  grid: 'M3.5 3.5h6v6h-6zM14.5 3.5h6v6h-6zM3.5 14.5h6v6h-6zM14.5 14.5h6v6h-6z',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 8.5a3 3 0 1 1 5.2 2c-1.2 1-2.2 1-2.2 3M12 17h.01',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6M12 7h.01',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  image: 'M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Zm-1.5 13L9 11l4 4 3-3 4.5 4.5M15 7.5h.01',
  pulse: 'M3 12h4l2-7 5 14 3-7h4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  heart: 'M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2',
  location: 'M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Zm-4.5 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  video: 'M3 5.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 17V7A1.5 1.5 0 0 1 3 5.5ZM15.5 9l7-4v14l-7-4',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-4 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM12 12h.01',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4',
  copy: 'M8 8h12v12H8zM4 16H3V3h13v1',
  print: 'M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h.01',
  download: 'M4 16v4h16v-4M12 3v12m-4-4 4 4 4-4',
  sort: 'M8 4v16m-4-4 4 4 4-4m4 4V4m-4 4 4-4 4 4',
} as const;

export type AdminIconName = keyof typeof ADMIN_ICON_PATHS;

export default function AdminIcon({ name, size = 20, className, style }: {
  name: AdminIconName; size?: number; className?: string; style?: CSSProperties;
}) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24"
    className={className ? `pc-admin-icon ${className}` : 'pc-admin-icon'} style={style}
    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={ADMIN_ICON_PATHS[name]} />
  </svg>;
}
