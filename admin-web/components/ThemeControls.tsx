'use client';

import { useEffect, useState } from 'react';

const SEG_WRAP: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 9,
  background: 'rgba(var(--on),0.05)',
  border: '1px solid rgba(var(--on),0.10)',
};

function seg(on: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 7,
    cursor: 'pointer',
    border: 'none',
    background: on ? 'rgba(var(--on),0.10)' : 'transparent',
    color: on ? 'var(--txt-strong)' : 'var(--txt-muted)',
  };
}

type Theme = 'light' | 'dark' | 'system';
export default function ThemeControls() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const now = document.documentElement.getAttribute('data-theme');
    setTheme(now === 'dark' || now === 'light' ? now : 'system');
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = 'pc-theme=' + next + '; path=/; max-age=31536000; samesite=lax';
  }

  return (
    <div style={SEG_WRAP} role="group" aria-label="Appearance">
      <button type="button" title="Light" aria-label="Light appearance" aria-pressed={theme === 'light'} className="pc-seg" style={seg(theme === 'light')} onClick={() => choose('light')}>
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.7 5.7l1.4 1.4M16.9 16.9l1.4 1.4M18.3 5.7L16.9 7.1M7.1 16.9L5.7 18.3" />
        </svg>
      </button>
      <button type="button" title="Dark" aria-label="Dark appearance" aria-pressed={theme === 'dark'} className="pc-seg" style={seg(theme === 'dark')} onClick={() => choose('dark')}>
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: 'currentColor' }}>
          <path d="M13 3a9 9 0 108 13.6A7.5 7.5 0 0113 3z" />
        </svg>
      </button>
      <button type="button" title="Use device appearance" aria-label="Use device appearance" aria-pressed={theme === 'system'} className="pc-seg" style={seg(theme === 'system')} onClick={() => choose('system')}>
        <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
      </button>
    </div>
  );
}
