import type {MemoryCoverPage} from './memoryBookDesign';
import type {MemoryFilmPage} from './memoryFilm';
import type {MemoryCoverArtwork,MemoryFilmSettings} from './memoryBookCreative';
import type {SoundtrackSelection} from './soundtrack';

export type MemoryBookPage=MemoryFilmPage & {
  story_id?:string;sort_order?:number;taken_at?:string|null;created_at?:string|null;
  style?:'polaroid'|'full';dual_front_url?:string|null;
};
export type MemoryBookSummary={
  id:string;user_id?:string;title:string;subtitle?:string|null;cover_color:string;cover_design?:string;
  cover_story_id?:string|null;cover_page?:MemoryCoverPage|null;audience:string;count:number;
  is_default?:boolean;is_owner?:boolean;can_view?:boolean;
  cover_artwork?:MemoryCoverArtwork;film_settings?:MemoryFilmSettings;presentation_revision?:number;
};
export type MemoryBook=MemoryBookSummary & {
  is_owner:boolean;can_view:boolean;pages:MemoryBookPage[];soundtrack?:SoundtrackSelection|null;
};
export type MemoryBookshelf={is_owner:boolean;books:MemoryBookSummary[]};
export type MemoryBookNavigation={
  goBack:()=>void;
  navigate:(name:string,params?:Record<string,unknown>)=>void;
  push:(name:string,params?:Record<string,unknown>)=>void;
  replace:(name:string,params?:Record<string,unknown>)=>void;
};
