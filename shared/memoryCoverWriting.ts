import {memoryCoverTitleSize,memoryDesign} from './memoryBookDesign';
import type {MemoryCoverArtwork} from './memoryBookCreative';

type Box={left:number;right:number;top:number;height:number;fontSize:number;lineHeight:number};
type Writing={text:string;style:Box};
/** Covers set a note as a paragraph; the saved writing remains unchanged. */
export function memoryCoverParagraph(text:string):string{return text.replace(/\s+/gu,' ').trim();}

// Advance widths from the bundled Caveat SemiBold font, with 8% room for
// platform shaping differences. Unlisted scripts retain the fallback estimate.
const handwritingAdvances:Record<string,number>={" ":0.2614,"!":0.2268,"\"":0.256,"#":0.6037,"$":0.486,"%":0.648,"&":0.6091,"'":0.1264,"(":0.3564,")":0.3564,"*":0.392,"+":0.4817,",":0.2138,"-":0.3521,".":0.2138,"/":0.3564,"0":0.486,"1":0.486,"2":0.486,"3":0.486,"4":0.486,"5":0.4741,"6":0.5011,"7":0.4828,"8":0.486,"9":0.4774,":":0.2138,";":0.2138,"<":0.4817,"=":0.4817,">":0.4817,"?":0.4039,"@":0.6944,"A":0.5486,"B":0.5638,"C":0.513,"D":0.6307,"E":0.5746,"F":0.499,"G":0.5314,"H":0.6156,"I":0.4385,"J":0.337,"K":0.5454,"L":0.4601,"M":0.7841,"N":0.661,"O":0.5422,"P":0.5044,"Q":0.5346,"R":0.5854,"S":0.5314,"T":0.4946,"U":0.5206,"V":0.5292,"W":0.7776,"X":0.5659,"Y":0.5443,"Z":0.5638,"[":0.3564,"\\":0.3564,"]":0.3564,"^":0.4817,"_":0.4817,"`":0.3812,"a":0.4784,"b":0.4763,"c":0.3899,"d":0.4309,"e":0.3575,"f":0.3208,"g":0.3899,"h":0.5076,"i":0.2084,"j":0.2268,"k":0.4007,"l":0.189,"m":0.6113,"n":0.4925,"o":0.3877,"p":0.4082,"q":0.4072,"r":0.3888,"s":0.3748,"t":0.3575,"u":0.3996,"v":0.3575,"w":0.5584,"x":0.3704,"y":0.3683,"z":0.3402,"{":0.3564,"|":0.3564,"}":0.3564,"~":0.4817};
function textWidth(text:string,handwritten=false):number{
 return Array.from(text).reduce((width,letter)=>width+(handwritten&&handwritingAdvances[letter]!==undefined?handwritingAdvances[letter]:(/\s/u.test(letter)?.36:/[MW@#%]/u.test(letter)?1.05:/[ilI.,'!:;]/u.test(letter)?.38:letter.codePointAt(0)!>0x2ff?1.1:.68)),0);
}
function lines(text:string,width:number,font:number,handwritten=false):number{
 let count=1,used=0;
 for(const word of text.split(' ')){
  const length=textWidth(word,handwritten)*font,gap=used?.36*font:0;
  if(length<=width){if(used+gap+length>width){count++;used=length;}else used+=gap+length;}
  else{
   if(used){count++;used=0;}
   for(const letter of Array.from(word)){const advance=textWidth(letter,handwritten)*font;if(used+advance>width){count++;used=0;}used+=advance;}
  }
 }
 return count;
}
function fit(text:string,width:number,height:number,preferred:number,padding=12):{height:number;fontSize:number;lineHeight:number}{
 let font=preferred;
 while(font>3&&lines(text,width,font)*font*1.3+padding>height)font-=.25;
 return {height:Math.min(height,lines(text,width,font)*font*1.3+padding),fontSize:font,lineHeight:font*1.3};
}
export function memoryCoverWritingTitleSize(title:string,design?:string,coverHeight=262,handwritten=false):number{
 const d=memoryDesign(design).id,longPostcard=title.trim().length>12;
 const limits=d==='postcard'?{width:121.6,lines:longPostcard?2:1,height:longPostcard?60:32}:d==='editorial'?{width:159.6,lines:3,height:coverHeight*.43-17}:d==='night_film'?{width:126.6,lines:3,height:coverHeight*.37-18}:d==='daybook'?{width:109,lines:2,height:coverHeight*.4-16}:d==='field_notes'?{width:154.6,lines:2,height:39}:{width:149.6,lines:2,height:coverHeight*.26-29};
 let font=memoryCoverTitleSize(title,design);
 // Caveat's connected letterforms are narrower than the display serif. Keep
 // the title legible while retaining the same bounded line-height checks.
 while(font>3){const count=lines(memoryCoverParagraph(title),limits.width,font,handwritten);if(count<=limits.lines&&(count*1.04+.18)*font<=limits.height)break;font-=.25;}
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
