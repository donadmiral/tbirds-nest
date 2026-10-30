import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { MemoryFilm } from '../../components/memory/MemoryFilm';
import { MemoryMovieExport } from '../../components/memory/MemoryMovieExport';
import { memoryMovieLimit } from '../../lib/memoryFilmExport';
import type { MemoryPage } from '../../lib/memoryAlbum';
import type { StoryTextSticker } from '../../lib/stories';

const image = (color: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><path fill="${color}" d="M0 0h360v640H0z"/></svg>`);
const timedSticker: StoryTextSticker = { id: 'timed', kind: 'photo', text: '', style: 'classic', color: '#fff', nx: .15, ny: .8, scale: 1, rotation: 0, photoUrl: image('#00ff00'), photoShape: 'cell', photoFw: .2, photoFh: .1, startSec: 1, endSec: 2 };
const pages: MemoryPage[] = [
  { id: 'photo', media_type: 'image', media_url: image('#eeb444'), thumbnail_url: null, caption: 'Synthetic photograph · first memory', taken_at: null, sort_order: 0, duration_sec: 3, stickers: [timedSticker] },
  { id: 'video', media_type: 'video', media_url: '/source.mp4', thumbnail_url: null, caption: 'Synthetic graded video · second memory', taken_at: null, sort_order: 1, media_transform: { scale: 1, translateNX: 0, translateNY: 0, trimStart: .4, trimEnd: 2.4, speed: 2, mix: { orig: 40 }, adjust: { bri: -100 }, fit: 'contain' } },
  { id: 'text', media_type: 'text', media_url: null, thumbnail_url: null, caption: 'THE THIRD MEMORY', taken_at: null, sort_order: 2, duration_sec: 3, text_background: { color: '#17455d' } },
];

function Fixture() {
  const [open, setOpen] = useState(true), [film, setFilm] = useState(false), [revision, setRevision] = useState(0);
  const params = new URLSearchParams(location.search), mode = params.get('mode');
  const current = pages.map<MemoryPage>((page, index) => {
    if (index) return page;
    if (mode === 'missing') return { ...page, media_url: '/missing.jpg' };
    if (mode === 'overflow') return { ...page, caption: 'Long original caption. '.repeat(100) };
    if (mode === 'animated_primary') return { ...page, media_url: '/animated-photo.jpg' };
    if (mode === 'animated_sticker') return { ...page, stickers: [{ ...timedSticker, photoUrl: '/animated-sticker.png' }] };
    if (mode === 'animated_background') return { ...page, media_type: 'text', media_url: null, text_background: { color: 'url("/animated-background.jpg")' } };
    if (mode === 'animated_data') return { ...page, media_url: params.get('asset') };
    if (mode === 'image_inspection_cancel') return { ...page, media_url: '/slow-photo.png' };
    if (mode === 'static_images') return { ...page, media_url: '/static-photo.jpg', media_transform: { fit: 'cover', scale: 1, translateNX: 0, translateNY: 0 }, stickers: [{ ...timedSticker, photoUrl: '/static-sticker.png' }] };
    return page;
  });
  useEffect(() => {
    const target = window as Window & { movieQA?: { memoryMovieLimit: typeof memoryMovieLimit; pages: MemoryPage[]; close: () => void; replace: () => void } };
    target.movieQA = { memoryMovieLimit, pages, close: () => setOpen(false), replace: () => setRevision(value => value + 1) };
    return () => { delete target.movieQA; };
  }, []);
  return <main style={{ minHeight: '100vh', background: '#07111c', color: 'white', padding: 30 }}><h1>Synthetic memory movie verification</h1><p>Generated test media only. No account, provider or personal content.</p><button onClick={() => { setOpen(true); setFilm(false); }}>Open movie download</button><button onClick={() => { setOpen(true); setFilm(true); }}>Open memory film</button>{open && (film ? <MemoryFilm key={revision} title="Synthetic memories" pages={current} reduceMotion={false} onClose={() => setOpen(false)} onReadBook={() => setOpen(false)} onRetry={() => setRevision(value => value + 1)} /> : <MemoryMovieExport key={revision} title="Synthetic memories" pages={current} initialScore={mode === 'score'} scoreVolume={.32} initialOriginalAudio={mode !== 'silent'} onClose={() => setOpen(false)} onRefresh={() => setRevision(value => value + 1)} />)}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
