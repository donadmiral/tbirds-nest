import {readSoundtrack} from './soundtrack';
import {memoryFilmItems,memoryPageSoundtrack,type MemoryFilmPage} from './memoryFilm';
import {memoryStoryStickers} from './memoryStoryPresentation';
import {storyVideoExportLimit} from './storyVideoComposition';
import {planMemoryMovie} from './memoryMoviePlan';
type ExportPage=MemoryFilmPage & {dual_front_url?:string|null};

/** Whole movies are all-or-nothing. An unavailable layer is never replaced by its poster. */
export function memoryMovieLimit(pages: readonly ExportPage[], soundtrack?: unknown,filmSettings?:unknown): string | null {
  if (!pages.length) return 'Add a memory before downloading a movie.';
  if (pages.length > 80) return `A memory movie can contain up to ${80} memories. Create a shorter book before exporting.`;
  if (soundtrack&&!readSoundtrack(soundtrack)) return 'Choose the book soundtrack again before exporting.';
  if(filmSettings){try{pages=planMemoryMovie(pages,filmSettings).scenes.map(scene=>pages[scene.sourceIndex]);}catch(error){return error instanceof Error?error.message:'The memory movie could not be planned.';}}
  const items = memoryFilmItems(pages);
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index], item = items[index], prefix = `Memory ${index + 1}: `;
    if (page.dual_front_url) return prefix + 'dual-camera composition cannot be exported yet. The second camera will not be discarded.';
    if ((page.audio_url || page.audio_title) && !memoryPageSoundtrack(page)) return prefix + 'this older added audio needs verification. Upload the original and select it again before exporting.';
    if ((page.media_type === 'image' || page.media_type === 'video') && !item.uri) return prefix + 'the original media is unavailable. Refresh the book and try again.';
    if (item.uri && /\.gif(?:[?#]|$)|^data:image\/gif/i.test(item.uri)) return prefix + 'animated GIF media cannot be exported yet.';
    const stickers = memoryStoryStickers(page.stickers);
    const posts = stickers.filter(sticker => sticker.kind === 'post');
    if (posts.length && (page.media_url || posts.length > 1)) return prefix + 'a shared-post card layered over another memory cannot be exported yet. The card will not be left out.';
    if (posts.length && !page.media_url && (posts[0].postMediaType === 'image' || posts[0].postMediaType === 'video') && !item.uri) return prefix + 'the original shared media is unavailable. Refresh the book and try again.';
    if (posts.some(post => post.postMediaEdit || post.postMediaPlayback)) return prefix + 'this shared post has its own media edits that movie export cannot reproduce yet. Its edits will not be discarded.';
    // A shared post may itself be the primary media. Any other embedded video
    // remains unsupported; the primary one is rendered as an actual video.
    const artwork = stickers.filter(sticker => !(sticker.kind === 'post' && !page.media_url && sticker.postMediaUrl === item.uri));
    const problem = storyVideoExportLimit(artwork);
    if (problem) return prefix + problem;
  }
  return null;
}

