'use client';

import { useSyncExternalStore } from 'react';
import AdminIcon from '@/components/AdminIcon';

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
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
function currentTheme(): Theme {
  const value = document.documentElement.getAttribute('data-theme');
  return value === 'dark' || value === 'light' ? value : 'system';
}
const serverTheme = (): Theme => 'system';
export default function ThemeControls() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);

  function choose(next: Theme) {
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = 'pc-theme=' + next + '; path=/; max-age=31536000; samesite=lax';
  }

  return (
    <div style={SEG_WRAP} role="group" aria-label="Appearance">
      <button type="button" title="Light" aria-label="Light appearance" aria-pressed={theme === 'light'} className="pc-seg" style={seg(theme === 'light')} onClick={() => choose('light')}>
        <AdminIcon name="sun" size={17} />
      </button>
      <button type="button" title="Dark" aria-label="Dark appearance" aria-pressed={theme === 'dark'} className="pc-seg" style={seg(theme === 'dark')} onClick={() => choose('dark')}>
        <AdminIcon name="moon" size={17} />
      </button>
      <button type="button" title="Use device appearance" aria-label="Use device appearance" aria-pressed={theme === 'system'} className="pc-seg" style={seg(theme === 'system')} onClick={() => choose('system')}>
        <AdminIcon name="monitor" size={17} />
      </button>
    </div>
  );
}
