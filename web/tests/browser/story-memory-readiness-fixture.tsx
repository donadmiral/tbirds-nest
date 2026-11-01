import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { StoryViewer } from '../../components/StoryViewer';
import { MemoryAlbumView } from '../../components/MemoryAlbum';
import { MemoryFilm } from '../../components/memory/MemoryFilm';
import { MemoryBookCover } from '../../components/memory/MemoryBookCover';
import { AUTHOR_TWO, BOOK, OTHER, book, pages, readinessFixture } from './story-memory-readiness-adapter';
import type { CatchupUser } from '../../lib/stories';

const users: CatchupUser[] = [{ user_id: OTHER, full_name: 'Fixture author', username: 'fixture_author', avatar_url: null,
  story_count: 3, unseen_count: 3, latest_story_at: '2026-11-01T00:00:00Z', latest_story_id: pages[0].story_id!, has_unseen: true },
  { user_id: AUTHOR_TWO, full_name: 'Second author', username: 'second_author', avatar_url: null,
    story_count: 1, unseen_count: 1, latest_story_at: '2026-11-01T00:00:00Z', latest_story_id: '44444444-4444-4444-8444-444444444444', has_unseen: true }];
function Fixture() {
  const mode = new URLSearchParams(location.search).get('mode') || 'story';
  const [open, setOpen] = useState(mode !== 'coexistence'), background = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    Object.assign(window, { readinessFixture: { ...readinessFixture, close: () => setOpen(false) } });
  }, []);
  useEffect(() => { const stop = () => background.current?.pause(); window.addEventListener('platinum:stop-media', stop); return () => window.removeEventListener('platinum:stop-media', stop); }, []);
  return <main style={{ minHeight: '100vh', background: '#f6f2eb', padding: 20 }}><h1>Local media readiness fixture</h1>
    <p>Actual web components, generated media and synthetic account responses.</p>
    {mode === 'coexistence' && <><video ref={background} data-background-video src="/media/background.mp4" muted autoPlay playsInline loop width={180} height={320}/><button type="button" onClick={() => setOpen(true)}>Open stories</button></>}
    {open && (mode === 'book' ? <MemoryAlbumView ownerId={BOOK} /> : mode === 'film'
      ? <MemoryFilm bookId={BOOK} title={book.title} pages={pages} filmSettings={book.film_settings} reduceMotion onClose={() => setOpen(false)} onReadBook={() => setOpen(false)} onRetry={() => {}} />
      : mode === 'cover' ? <div data-static-cover><MemoryBookCover title="Static video cover" design="night_film" videoUrl="/media/a.mp4" width={240} height={314} /></div>
      : <StoryViewer users={users} startIndex={0} onClose={() => setOpen(false)} />)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
