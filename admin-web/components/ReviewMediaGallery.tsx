'use client';

import { useEffect, useRef, useState } from 'react';
import MediaPreview, { type ReviewMedia } from './MediaPreview';
import AdminIcon from './AdminIcon';
import { trapDialogTab } from '@/lib/dialogFocus';

export default function ReviewMediaGallery({ media }: { media: ReviewMedia[] }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = Math.max(0, Math.min(index, media.length - 1));
  useEffect(() => {
    if (!expanded) return;
    const node = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    window.dispatchEvent(new Event('platinum:stop-media'));
    node?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { node?.close(); document.body.style.overflow = overflow; previousFocus?.focus({ preventScroll: true }); };
  }, [expanded]);
  if (!media.length) return null;
  const navigation = media.length > 1 ? <>
    <div className="pc-review-gallery-nav">
      <button type="button" disabled={current === 0} onClick={() => setIndex(Math.max(0, current - 1))} aria-label="Previous attachment"><AdminIcon name="chevronLeft" size={18} /></button>
      <span aria-live="polite">Attachment {current + 1} of {media.length}</span>
      <button type="button" disabled={current === media.length - 1} onClick={() => setIndex(Math.min(media.length - 1, current + 1))} aria-label="Next attachment"><AdminIcon name="chevronRight" size={18} /></button>
    </div>
    <div className="pc-review-gallery-items">
      {media.map((item, position) => <button key={`${position}:${item.url}`} type="button" aria-label={`View attachment ${position + 1}`} aria-pressed={position === current}
        onClick={() => setIndex(position)}>{position + 1}{item.video ? ' · Video' : ' · Photo'}</button>)}
    </div>
  </> : null;
  return <div className="pc-review-gallery">
    {!expanded ? <><MediaPreview key={`${current}:${media[current].url}`} {...media[current]} onExpand={() => setExpanded(true)} />{navigation}</> : null}
    <button type="button" className="pc-button pc-gallery-expand" onClick={() => setExpanded(true)}><AdminIcon name="expand" size={17} /> Full screen</button>
    <dialog ref={dialog} className="pc-media-dialog" aria-label="Full screen media review" onKeyDown={trapDialogTab} onClose={() => setExpanded(false)}>
      <header><h2>Attachment {current + 1} of {media.length}</h2><button type="button" className="pc-button pc-button-square" aria-label="Close full screen media" onClick={() => setExpanded(false)}><AdminIcon name="close" size={20} /></button></header>
      {expanded ? <><MediaPreview key={`${current}:${media[current].url}`} {...media[current]} expanded />{navigation}</> : null}
    </dialog>
  </div>;
}
