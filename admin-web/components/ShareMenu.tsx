'use client';

/**
 * The Share control that sits in the topbar of every desk. One flow for the
 * whole system: copy the exact view, print a snapshot, drop the page or a note
 * into the presentation tray, or open the builder with what has been collected.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trayAdd, trayRead, TRAY_EVENT } from '@/lib/share';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
  padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent',
  cursor: 'pointer', fontSize: 12.4, fontWeight: 500, color: 'var(--txt)',
};

export default function ShareMenu({ path, label }: { path: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');
  const wrap = useRef<HTMLDivElement | null>(null);

  const page = label && label.trim() ? label : path.replace('/', '') || 'Operations';

  useEffect(() => {
    const sync = () => setCount(trayRead().length);
    sync();
    window.addEventListener(TRAY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TRAY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) { setOpen(false); setNoting(false); }
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1600);
  }

  function copyLink() {
    void navigator.clipboard?.writeText(window.location.href);
    say('Link copied');
    setOpen(false);
  }

  function snapshot() {
    setOpen(false);
    setTimeout(() => window.print(), 120);
  }

  function addNote() {
    const text = note.trim();
    if (!text) return;
    trayAdd({ kind: 'note', title: page + ' note', page, path, note: { text } });
    setNote('');
    setNoting(false);
    setOpen(false);
    say('Added to presentation');
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className="pc-icon-btn"
        title="Share, export or present this view"
        style={{ display: 'flex', alignItems: 'center', gap: 7, height: 33, padding: '0 11px', borderRadius: 9, border: '1px solid rgba(var(--on),0.10)', background: 'transparent', cursor: 'pointer' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" style={{ stroke: 'rgba(var(--on),0.6)' }} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />
          <path d="M12 15V3M8 7l4-4 4 4" />
        </svg>
        <span style={{ fontSize: 11.8, fontWeight: 600, color: 'rgba(var(--on),0.6)' }}>Share</span>
        {count > 0 ? (
          <span className="pc-num" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: 'rgba(var(--accent-rgb),0.13)', color: 'var(--accent)' }}>{count}</span>
        ) : null}
      </button>

      {flash ? (
        <span style={{ position: 'absolute', top: 40, right: 0, whiteSpace: 'nowrap', padding: '5px 9px', borderRadius: 7, fontSize: 11.3, fontWeight: 600, color: 'var(--txt)', background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', boxShadow: '0 10px 26px rgba(0,0,0,0.18)', zIndex: 70 }}>{flash}</span>
      ) : null}

      {open ? (
        <div style={{
          position: 'absolute', top: 40, right: 0, zIndex: 70, width: 262, padding: 5,
          borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.11)',
          boxShadow: '0 18px 46px rgba(0,0,0,0.24)', animation: 'pcRise 140ms ' + EASE,
        }}>
          <div style={{ padding: '6px 10px 7px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: 'rgba(var(--on),0.38)' }}>{page.toUpperCase()}</div>

          <button type="button" className="pc-nav" style={rowStyle} onClick={copyLink}>
            <Ico d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" />
            Copy link to this view
          </button>

          <button type="button" className="pc-nav" style={rowStyle} onClick={snapshot}>
            <Ico d="M6 9V4h12v5M6 18H4v-5a2 2 0 012-2h12a2 2 0 012 2v5h-2M6 14h12v6H6v-6z" />
            Snapshot this view as PDF
          </button>

          <button type="button" className="pc-nav" style={rowStyle} onClick={() => setNoting(v => !v)}>
            <Ico d="M12 5v14M5 12h14" />
            Add a note to the presentation
          </button>

          {noting ? (
            <div style={{ padding: '2px 6px 8px' }}>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus
                placeholder={'What should the reader take away from ' + page + '?'}
                style={{ width: '100%', resize: 'vertical', padding: '8px 9px', borderRadius: 8, fontSize: 12, lineHeight: 1.45, color: 'var(--txt)', background: 'rgba(var(--on),0.04)', border: '1px solid rgba(var(--on),0.11)', outline: 'none' }} />
              <button type="button" onClick={addNote} disabled={!note.trim()}
                style={{ marginTop: 6, width: '100%', padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11.8, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)', opacity: note.trim() ? 1 : 0.4 }}>
                Add to presentation
              </button>
            </div>
          ) : null}

          <div style={{ height: 1, margin: '5px 8px', background: 'rgba(var(--on),0.08)' }} />

          <button type="button" className="pc-nav" style={rowStyle} onClick={() => { setOpen(false); router.push('/present'); }}>
            <Ico d="M4 5h16v10H4zM9 20h6M12 15v5" />
            <span style={{ flex: 1 }}>Open presentation builder</span>
            <span className="pc-num" style={{ fontSize: 10, fontWeight: 700, color: count > 0 ? 'var(--accent)' : 'rgba(var(--on),0.3)' }}>{count}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Ico({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: '0 0 14px', stroke: 'rgba(var(--on),0.5)' }}><path d={d} /></svg>
  );
}
