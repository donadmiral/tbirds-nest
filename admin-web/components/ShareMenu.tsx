'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ActionPopover from '@/components/ActionPopover';
import { trayAdd, trayRead, TRAY_EVENT } from '@/lib/share';

export default function ShareMenu({ path, label }: { path: string; label?: string }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');
  const [failure, setFailure] = useState(false);
  const [copying, setCopying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const page = label?.trim() || path.replace('/', '') || 'Operations';

  useEffect(() => {
    const sync = () => setCount(trayRead().length);
    sync();
    window.addEventListener(TRAY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TRAY_EVENT, sync);
      window.removeEventListener('storage', sync);
      clearTimeout(timer.current);
    };
  }, []);

  function say(message: string, error = false) {
    clearTimeout(timer.current);
    setFlash(message);
    setFailure(error);
    timer.current = setTimeout(() => setFlash(''), error ? 8000 : 3000);
  }

  async function copyLink(close: () => void) {
    if (copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(window.location.href);
      say('Link copied');
      close();
    } catch { say('The link could not be copied. Copy the address from your browser.', true); }
    finally { setCopying(false); }
  }

  function addNote(close: () => void) {
    const text = note.trim();
    if (!text) return;
    try {
      trayAdd({ kind: 'note', title: page + ' note', page, path, note: { text } });
      setNote('');
      setNoting(false);
      say('Added to presentation');
      close();
    } catch (error) { say(error instanceof Error ? error.message : 'The note could not be saved.', true); }
  }

  return <div className="pc-share-control">
    <ActionPopover label="Share this view" align="start" trigger={<>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 15V3M8 7l4-4 4 4" /></svg>
      <span>Share</span>{count > 0 ? <span className="pc-share-count">{count}</span> : null}
    </>}>
      {close => <>
        <p className="pc-popover-heading">{page}</p>
        <button type="button" className="pc-popover-action" disabled={copying} onClick={() => void copyLink(close)}>{copying ? 'Copying…' : 'Copy link to this view'}</button>
        <button type="button" className="pc-popover-action" onClick={() => { close(); window.print(); }}>Print or save this view as PDF</button>
        <button type="button" className="pc-popover-action" aria-expanded={noting} onClick={() => setNoting(value => !value)}>Add a note to the presentation</button>
        {noting ? <div className="pc-popover-note">
          <label>Presentation note<textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={10000} autoFocus
            placeholder={'What should the reader take away from ' + page + '?'} /></label>
          <button type="button" className="pc-button pc-button-primary" onClick={() => addNote(close)} disabled={!note.trim()}>Add to presentation</button>
        </div> : null}
        <div className="pc-popover-divider" />
        <button type="button" className="pc-popover-action" onClick={() => { close(); router.push('/present'); }}>Open presentation builder{count ? ` (${count})` : ''}</button>
      </>}
    </ActionPopover>
    {flash ? <p role={failure ? 'alert' : 'status'} className="pc-share-feedback" data-error={failure}>{flash}</p> : null}
  </div>;
}
