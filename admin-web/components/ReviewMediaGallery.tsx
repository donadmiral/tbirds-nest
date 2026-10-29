'use client';

import { useState } from 'react';
import MediaPreview, { type ReviewMedia } from './MediaPreview';

export default function ReviewMediaGallery({ media }: { media: ReviewMedia[] }) {
  const [index, setIndex] = useState(0);
  const current = Math.max(0, Math.min(index, media.length - 1));
  if (!media.length) return null;
  return <div className="pc-review-gallery">
    <MediaPreview key={`${current}:${media[current].url}`} {...media[current]} />
    {media.length > 1 ? <>
      <div className="pc-review-gallery-nav">
        <button type="button" disabled={current === 0} onClick={() => setIndex(Math.max(0, current - 1))} aria-label="Previous attachment">←</button>
        <span>Attachment {current + 1} of {media.length}</span>
        <button type="button" disabled={current === media.length - 1} onClick={() => setIndex(Math.min(media.length - 1, current + 1))} aria-label="Next attachment">→</button>
      </div>
      <div className="pc-review-gallery-items">
        {media.map((item, position) => <button key={`${position}:${item.url}`} type="button" aria-label={`View attachment ${position + 1}`} aria-pressed={position === current}
          onClick={() => setIndex(position)}>{position + 1}{item.video ? ' · Video' : ' · Photo'}</button>)}
      </div>
    </> : null}
  </div>;
}
