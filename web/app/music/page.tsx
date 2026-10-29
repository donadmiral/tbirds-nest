'use client';

import { useState } from 'react';
import AppleMusicPicker from '@/components/AppleMusicPicker';
import { Card, PageHeader } from '@/components/ui';
import { appleMusicShareText, type AppleMusicTrack } from '../../../shared/appleMusic';

export default function MusicPage() {
  const [message, setMessage] = useState('');
  async function share(track: AppleMusicTrack) {
    setMessage('');
    try {
      if (navigator.share) await navigator.share({ title: track.title, text: [track.title, track.artist].filter(Boolean).join(' · '), url: track.url });
      else { await navigator.clipboard.writeText(appleMusicShareText(track)); setMessage('Song link copied. Paste it into a post or message.'); }
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setMessage('Could not share automatically. Open the song and copy its Apple Music link.'); }
  }
  return <main className="mx-auto w-full max-w-3xl p-4 md:p-6"><PageHeader title="Apple Music" subtitle="Find music and share what you are listening to." /><Card><AppleMusicPicker onSelect={track => { void share(track); }} />{message ? <p role="status" className="mt-4 text-sm">{message}</p> : null}</Card></main>;
}
