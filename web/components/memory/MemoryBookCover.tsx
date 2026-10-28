import { Heart, Sun, Type, Feather, Moon, Star, BookOpen } from 'lucide-react';
import { memoryColors, memoryDesign } from '../../../shared/memoryBookDesign';
const marks = { heart: Heart, sun: Sun, type: Type, feather: Feather, moon: Moon, star: Star, 'book-open': BookOpen };
export function MemoryBookCover({title,color,design,width=66,height=84}:{title:string;color?:string;design?:string;width?:number;height?:number}) {
 const c=memoryColors(color),d=memoryDesign(design),Icon=marks[d.mark],u=width/66;
 return <span role="img" aria-label={`${d.label} book cover: ${title}`} className="relative block rounded-lg shadow-md" style={{width,height,background:c.spine,padding:3*u,paddingLeft:8*u}}>
  <span className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-md px-1" style={{background:c.cover,color:c.text,border:d.id==='editorial'?'none':`1px ${['keepsake','postcard','field_notes'].includes(d.id)?'dashed':'solid'} ${c.text}55`}}>
   {d.id==='daybook'&&<span className="absolute inset-0 opacity-50" style={{background:`repeating-linear-gradient(transparent,transparent ${10*u}px,${c.spine} ${10*u}px,${c.spine} ${11*u}px)`}}/>}
   {d.id==='night_film'&&<span className="absolute inset-y-1 left-0.5 w-1 opacity-30" style={{background:`repeating-linear-gradient(${c.text},${c.text} ${5*u}px,transparent ${5*u}px,transparent ${12*u}px)`}}/>}
   {d.id==='postcard'&&<span className="absolute right-1 top-1 border border-dashed opacity-50" style={{width:10*u,height:12*u}}/>}
   {d.id==='botanical'&&<><Feather size={32*u} className="absolute -left-2 top-0 -rotate-45" color={c.spine}/><Feather size={28*u} className="absolute -right-2 bottom-0 rotate-180" color={c.spine}/></>}
   {d.id==='classic'&&<span className="absolute inset-1 border opacity-30"/>}
   <Icon className="relative mb-1" size={13*u}/><span className={`relative line-clamp-3 text-center leading-tight ${['editorial','classic','field_notes'].includes(d.id)?'font-serif':'font-bold'}`} style={{fontSize:(d.id==='editorial'?11:10)*u}}>{title}</span><span className="relative mt-1 opacity-40" style={{width:18*u,height:1,background:c.text}}/>
  </span>
  {d.id==='keepsake'&&<span className="absolute rounded border border-[#B89A5F] bg-[#DFC58E]" style={{right:-4*u,top:height*.4,width:10*u,height:15*u}}/>}
  {d.id==='field_notes'&&<span className="absolute inset-y-0 opacity-25" style={{right:8*u,width:2*u,background:c.text}}/>}
 </span>;
}
