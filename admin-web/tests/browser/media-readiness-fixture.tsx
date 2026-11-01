/** Actual media components with synthetic local assets, never hosted records. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import MediaPreview from '@/components/MediaPreview';
import ReviewMediaGallery from '@/components/ReviewMediaGallery';

function Fixture() {
  const [record, setRecord] = useState('a');
  const [empty, setEmpty] = useState(false);
  return <main style={{ maxWidth: 900, margin: '24px auto', padding: 20 }}>
    <h1>Admin media readiness fixture</h1>
    <section aria-label="Video tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, marginBottom: 16 }}>
      {Array.from({ length: 24 }, (_, index) => <div key={index} style={{ height: 60 }}><MediaPreview url={`/media/tile-${index}.mp4`} video thumbnail poster={index % 2 ? undefined : '/poster-a.png'} /></div>)}
    </section>
    <button type="button" onClick={() => { setRecord('b'); setEmpty(false); }}>Review record B</button>
    <button type="button" onClick={() => { setRecord('c'); setEmpty(false); }}>Review untrimmed record</button>
    <button type="button" onClick={() => setEmpty(true)}>Remove selected media</button>
    <section aria-label="Selected media" data-record={record}>
      <ReviewMediaGallery key={record} media={empty ? [] : [
        { url: `/media/video-${record}.mp4`, poster: `/poster-${record === 'a' ? 'a' : 'b'}.png`, video: true, width: 160, height: 90, edit: { trimStart: record === 'c' ? 0 : .2, trimEnd: .9 } },
        { url: '/poster-b.png', width: 256, height: 256 },
      ]} />
    </section>
    <section aria-label="Retriable photo" style={{ width: 200, marginTop: 16 }}><MediaPreview url="/retry-image.png" width={256} height={256} /></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
