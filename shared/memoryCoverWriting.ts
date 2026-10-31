import {memoryCoverTitleSize,memoryDesign} from './memoryBookDesign';
import type {MemoryCoverArtwork} from './memoryBookCreative';

type Box={left:number;right:number;top:number;height:number;fontSize:number;lineHeight:number};
type Writing={text:string;style:Box};
/** Covers set a note as a paragraph; the saved writing remains unchanged. */
export function memoryCoverParagraph(text:string):string{return text.replace(/\s+/gu,' ').trim();}

function textWidth(text:string):number{
 return Array.from(text).reduce((width,letter)=>width+(/\s/u.test(letter)?.36:/[MW@#%]/u.test(letter)?1.05:/[ilI.,'!:;]/u.test(letter)?.38:letter.codePointAt(0)!>0x2ff?1.1:.68),0);
}
function lines(text:string,width:number,font:number):number{
 let count=1,used=0;
 for(const word of text.split(' ')){
  const length=textWidth(word)*font,gap=used?.36*font:0;
  if(length<=width){if(used+gap+length>width){count++;used=length;}else used+=gap+length;}
  else{
   if(used){count++;used=0;}
   for(const letter of Array.from(word)){const advance=textWidth(letter)*font;if(used+advance>width){count++;used=0;}used+=advance;}
  }
 }
 return count;
}
function fit(text:string,width:number,height:number,preferred:number,padding=12):{height:number;fontSize:number;lineHeight:number}{
 let font=preferred;
 while(font>3&&lines(text,width,font)*font*1.3+padding>height)font-=.25;
 return {height:Math.min(height,lines(text,width,font)*font*1.3+padding),fontSize:font,lineHeight:font*1.3};
}
export function memoryCoverWritingTitleSize(title:string,design?:string,coverHeight=262):number{
 const d=memoryDesign(design).id,longPostcard=title.trim().length>12;
 const limits=d==='postcard'?{width:121.6,lines:longPostcard?2:1,height:longPostcard?60:32}:d==='editorial'?{width:159.6,lines:3,height:coverHeight*.43-17}:d==='night_film'?{width:126.6,lines:3,height:coverHeight*.37-18}:d==='daybook'?{width:109,lines:2,height:coverHeight*.4-16}:d==='field_notes'?{width:154.6,lines:2,height:39}:{width:149.6,lines:2,height:coverHeight*.26-29};
 let font=memoryCoverTitleSize(title,design);
 while(font>3){const count=lines(memoryCoverParagraph(title),limits.width,font);if(count<=limits.lines&&(count*1.04+.18)*font<=limits.height)break;font-=.25;}
 return font;
}

/** One bounded typography layout for native and web. All values use actual
 * cover pixels, so shelf thumbnails and the editable preview stay in sync. */
export function memoryCoverWritingLayout(artwork:MemoryCoverArtwork,design:string|undefined,title:string,width:number,height:number):{note:Writing|null;stamp:Writing|null}{
 const unit=width/200,h=height/unit,d=memoryDesign(design).id,text=memoryCoverParagraph(artwork.inscription),stampText=memoryCoverParagraph(artwork.postmark);
 const left=14,right=d==='night_film'?50:14,innerWidth=187.6-left-right-22;
 let top=0,bottom=0;
 if(d==='postcard'){top=(title.trim().length>12?88:59)+10;bottom=h-76;}
 else if(d==='keepsake'||d==='classic'||d==='botanical'){top=h*.17+8;bottom=h*.68-8;}
 else if(d==='field_notes'){top=h*.275+9;bottom=h*.695-9;}
 else if(d==='editorial'){top=h*.43;bottom=h-34;}
 else if(d==='night_film'){top=h*.46;bottom=h-22;}
 else{top=h*.43;bottom=h-35;}
 const scaled=(box:Box):Box=>({left:box.left*unit,right:box.right*unit,top:box.top*unit,height:box.height*unit,fontSize:box.fontSize*unit,lineHeight:box.lineHeight*unit});
 let stamp:Writing|null=null;
 if(stampText&&d!=='postcard'){
  const stampRight=d==='night_film'?47:8,stampLeft=Math.max(12,187.6-stampRight-122),style=fit(stampText,187.6-stampLeft-stampRight-10,28,6.5,6);
  const stampTop=artwork.inscriptionPosition==='top'?bottom-style.height:top;
  stamp={style:scaled({left:stampLeft,right:stampRight,top:stampTop,...style}),text:stampText};
  if(artwork.inscriptionPosition==='top')bottom=stampTop-8;else top=stampTop+style.height+8;
 }
 let note:Writing|null=null;
 if(text){
  const preferred=Array.from(text).length>90?9:Array.from(text).length>50?11:13,style=fit(text,innerWidth,Math.max(16,bottom-top),preferred);
  const noteTop=artwork.inscriptionPosition==='top'?top:bottom-style.height;
  note={style:scaled({left,right,top:noteTop,...style}),text};
 }
 return {note,stamp};
}
