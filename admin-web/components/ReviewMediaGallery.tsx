'use client';

import { useEffect, useRef, useState } from 'react';
import MediaPreview, { type ReviewMedia } from './MediaPreview';
import AdminIcon from './AdminIcon';
import { trapDialogTab } from '@/lib/dialogFocus';

export default function ReviewMediaGallery({ media }: { media: ReviewMedia[] }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const openGallery = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setExpanded(true);
  };
  const current = Math.max(0, Math.min(index, media.length - 1));
  const hasMedia = media.length > 0;
  useEffect(() => {
    if (!expanded || !hasMedia) return;
    const node = dialog.current;
    const previousFocus = returnFocus.current;
    const fallbackFocus = expandButton.current;
    const overflow = document.body.style.overflow;
    // Keep the same player DOM and buffer in both modes. A dialog must be
    // closed before promoting its nonmodal inline presentation to showModal.
    node?.close();
    node?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      node?.close();
      if (node?.isConnected) node.show();
      document.body.style.overflow = overflow;
      const focusTarget = previousFocus?.isConnected ? previousFocus : fallbackFocus;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    };
  }, [expanded, hasMedia]);
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
    <dialog ref={dialog} open className={expanded ? 'pc-media-dialog' : 'pc-media-inline'} role={expanded ? 'dialog' : 'group'} aria-label={expanded ? 'Full screen media review' : 'Media attachments'} aria-modal={expanded || undefined}
      style={expanded ? undefined : { position: 'static', width: '100%', maxWidth: 'none', maxHeight: 'none', margin: 0, padding: 0, border: 0, background: 'transparent', color: 'inherit', overflow: 'visible' }}
      onKeyDown={event => { if (!expanded) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); } else trapDialogTab(event); }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); setExpanded(false); }} onClose={event => { if (!event.currentTarget.open) setExpanded(false); }}>
      {expanded ? <header><h2>Attachment {current + 1} of {media.length}</h2><button type="button" className="pc-button pc-button-square" aria-label="Close full screen media" onClick={() => setExpanded(false)}><AdminIcon name="close" size={20} /></button></header> : null}
      <MediaPreview key={`${current}:${media[current].url}`} {...media[current]} expanded={expanded} onExpand={openGallery} />{navigation}
    </dialog>
    <button ref={expandButton} type="button" className="pc-button pc-gallery-expand" onClick={openGallery}><AdminIcon name="expand" size={17} /> Full screen</button>
  </div>;
}
