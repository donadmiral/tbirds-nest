import type { MediaPreviewEdit, ReviewMedia } from '../components/MediaPreview';

export function moderationCoverRefs(edit:MediaPreviewEdit|null|undefined) {
  return [edit?.coverUrl,edit?.thumbnail].filter((v):v is string=>typeof v==='string' && !!v);
}
/** Only resolved media crosses into a client preview. Caller-provided recipe fields
 * cannot point the derived route at a different post, bucket or Storage object. */
export function reviewMediaForPost(item:ReviewMedia, resolved:Record<string,string>, postId:string):ReviewMedia {
  const recipe=item.edit;
  const approved=(ref:unknown)=>{
    if(typeof ref!=='string'||!Object.hasOwn(resolved,ref)) return null;
    const value=resolved[ref];if(!value)return null;
    if(value.startsWith('/api/moderation-media?')){
      const q=new URLSearchParams(value.slice(value.indexOf('?')+1));
      if(q.get('kind')!=='post'||q.get('id')!==postId) return null;
    }
    return value;
  };
  const url=approved(item.url)||'';
  if(!recipe)return {...item,url,edit:null};
  const edit={...recipe,coverUrl:approved(recipe.coverUrl),thumbnail:approved(recipe.thumbnail)};
  const q=url.startsWith('/api/moderation-media?')?new URLSearchParams(url.slice(url.indexOf('?')+1)):null;
  if(item.video&&recipe.generatedPosterV1===true&&!recipe.coverUrl&&!recipe.thumbnail&&q?.get('bucket')==='post-media'&&!q.has('representation')){
    return {...item,url:url+'&representation=compatible',poster:url+'&representation=poster',edit};
  }
  return {...item,url,edit};
}
