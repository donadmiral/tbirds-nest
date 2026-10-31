/** Only synthetic media. These canonical URLs are never sent to a network. */
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const OWNER = '10000000-0000-4000-8000-000000000001';
const BOOK = 'a0000000-0000-4000-8000-000000000001';
const NAVIGATION_BOOK = 'a0000000-0000-4000-8000-000000000002';
const PREFIX = 'story-media/' + OWNER + '/native-memory-capture/';
const MEDIA = Object.freeze({
  [PREFIX + 'photo.png']: 'memory-capture-photo.png',
  [PREFIX + 'sticker.png']: 'memory-capture-sticker.png',
  [PREFIX + 'video.mp4']: 'memory-capture-video.mp4',
});
const canonical = name => ORIGIN + '/storage/v1/object/public/' + PREFIX + name;
const capability = key => ORIGIN + '/functions/v1/media-content/' + key + '?token=' + 'a'.repeat(64);
function memoryBook() {
  return {
    id: BOOK, user_id: OWNER, title: 'THE CAPTURED MOMENTS', subtitle: 'Synthetic native acceptance',
    can_view: true, is_owner: true, presentation_revision: 0, audience: 'private',
    cover_color: '#142642', cover_design: 'linen', cover_page: null, count: 3, soundtrack: null,
    film_settings: { version: 1, mode: 'automatic', style: 'bright', length: 'full', order: 'book', titleCard: true, originalAudio: true },
    pages: [
      { id: 'a1000000-0000-4000-8000-000000000001', sort_order: 0, media_type: 'image',
        media_url: canonical('photo.png'), thumbnail_url: null, duration_sec: 3.2,
        caption: 'A photograph with its writing kept.', taken_at: '2026-01-02T10:00:00.000Z',
        media_transform: { fit: 'contain', scale: 1, translateNX: 0, translateNY: 0 },
        stickers: [{ id: 'native-timed-photo', kind: 'photo', text: '', style: 'classic', color: '#ffffff',
          nx: .18, ny: .66, scale: 1, rotation: 0, photoUrl: canonical('sticker.png'),
          photoShape: 'cell', photoFw: .18, photoFh: .1, startSec: 1, endSec: 2 }],
      },
      { id: 'a1000000-0000-4000-8000-000000000002', sort_order: 1, media_type: 'video',
        media_url: canonical('video.mp4'), thumbnail_url: null, duration_sec: 3,
        caption: 'Original sound and edited video.', taken_at: '2026-01-03T10:00:00.000Z',
        media_transform: { fit: 'contain', scale: 1, translateNX: 0, translateNY: 0,
          trimStart: .5, trimEnd: 2, speed: 1, mix: { orig: 50 }, adjust: { bri: -20 } }, stickers: [],
      },
      { id: 'a1000000-0000-4000-8000-000000000003', sort_order: 2, media_type: 'text',
        media_url: null, thumbnail_url: null, duration_sec: 3,
        caption: 'WORDS WORTH KEEPING', taken_at: '2026-01-04T10:00:00.000Z',
        text_background: { color: '#17455d' }, stickers: [],
      },
    ],
  };
}
/** Real reader/cover controls use a separate book so edits cannot alter the
 * independently decoded capture recipe. Text memories need no native remote
 * image loader and therefore keep this UI path entirely provider-free. */
function navigationBook() {
  return {
    id: NAVIGATION_BOOK, user_id: OWNER, title: 'THE SMALL ADVENTURES', subtitle: 'A book from this week',
    can_view: true, is_owner: true, is_default: false, presentation_revision: 0, audience: 'only_me',
    cover_color: 'cream', cover_design: 'keepsake', cover_story_id: null, cover_page: null,
    cover_artwork: { version: 1, inscription: '', inscriptionStyle: 'handwritten', inscriptionPosition: 'bottom',
      postmark: '', showDate: true, photo: { x: .5, y: .5, scale: 1 } },
    count: 2, soundtrack: null,
    film_settings: { version: 1, mode: 'automatic', style: 'reflective', length: 'full', order: 'book', titleCard: true, originalAudio: true },
    pages: [
      { id: 'a2000000-0000-4000-8000-000000000001', story_id: 'a3000000-0000-4000-8000-000000000001',
        sort_order: 0, media_type: 'text', media_url: null, thumbnail_url: null,
        caption: 'WE TOOK THE LONG WAY HOME', taken_at: '2026-01-02T10:00:00.000Z',
        text_background: { color: '#17455d' }, stickers: [] },
      { id: 'a2000000-0000-4000-8000-000000000002', story_id: 'a3000000-0000-4000-8000-000000000002',
        sort_order: 1, media_type: 'text', media_url: null, thumbnail_url: null,
        caption: 'THE STORIES WE KEEP', taken_at: '2026-01-03T10:00:00.000Z',
        text_background: { color: '#583b48' }, stickers: [] },
    ],
  };
}
module.exports = { ORIGIN, OWNER, BOOK, NAVIGATION_BOOK, MEDIA, capability, memoryBook, navigationBook };
