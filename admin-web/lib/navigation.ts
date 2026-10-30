/** Route inventory shared by the role-filtered shell and its browser checks. */
export const GROUPS: { label: string; items: { href: string; label: string; icon: string; key: string }[] }[] = [
  { label: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', key: 'D', icon: 'M4 5h7v7H4V5zm9 0h7v4h-7V5zm0 6h7v8h-7v-8zm-9 3h7v5H4v-5z' },
    { href: '/analytics', label: 'Analytics', key: 'A', icon: 'M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z' },
    { href: '/calls', label: 'Calls', key: 'C', icon: 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z' },
  ]},
  { label: 'Community', items: [
    { href: '/users', label: 'Users', key: 'U', icon: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z' },
    { href: '/businesses', label: 'Businesses', key: 'B', icon: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z' },
    { href: '/organizations', label: 'Organizations', key: 'G', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01' },
  ]},
  { label: 'Commerce', items: [
    { href: '/market', label: 'Market', key: 'M', icon: 'M4 7l2-4h12l2 4v2a3 3 0 01-1 2.2V20H5v-8.8A3 3 0 014 9V7zm3 6h4v5H7v-5z' },
    { href: '/jobs', label: 'Jobs', key: 'J', icon: 'M9 4h6a2 2 0 012 2v1h3a1 1 0 011 1v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a1 1 0 011-1h3V6a2 2 0 012-2zm1 3h4V6h-4v1z' },
    { href: '/payments', label: 'Payments', key: 'Y', icon: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6zm2 3h14V7H5v2zm0 3v5h14v-5H5z' },
    { href: '/ads', label: 'Ads Manager', key: 'V', icon: 'M3 10a2 2 0 012-2h2l7-4v16l-7-4H5a2 2 0 01-2-2v-4zm14-4.8a7 7 0 010 9.6V5.2z' },
  ]},
  { label: 'Content', items: [
    { href: '/content', label: 'Posts', key: 'P', icon: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z' },
    { href: '/stories', label: 'Stories', key: 'O', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z' },
  ]},
  { label: 'Moderation', items: [
    { href: '/reports', label: 'Reports', key: 'R', icon: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z' },
    { href: '/queue', label: 'Verification', key: 'Q', icon: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z' },
    { href: '/support', label: 'Support', key: 'S', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 016 6h-3a3 3 0 00-6 0H6a6 6 0 016-6zm-3 8h6a3 3 0 01-6 0z' },
    { href: '/audit', label: 'Audit log', key: 'L', icon: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z' },
  ]},
  { label: 'System', items: [
    { href: '/staff', label: 'Staff', key: 'F', icon: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z' },
    { href: '/system', label: 'Controls', key: 'W', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.6 4a6.6 6.6 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a6.9 6.9 0 00-1.9-1.1L15.8 3h-4l-.4 2.8a6.9 6.9 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6a6.6 6.6 0 000 2.2l-2 1.6 2 3.4 2.4-1a6.9 6.9 0 001.9 1.1l.4 2.8h4l.4-2.8a6.9 6.9 0 001.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z' },
  ]},
];

// Quick actions are permission-shaped: a desk you cannot open never offers its action.
export const ACTIONS: { href: string; label: string }[] = [
  { href: '/queue', label: 'Review verification queue' },
  { href: '/reports', label: 'Review open reports' },
  { href: '/support', label: 'Answer support tickets' },
  { href: '/users', label: 'Find a member' },
  { href: '/system', label: 'Publish an announcement' },
  { href: '/staff', label: 'Invite a staff member' },
];

