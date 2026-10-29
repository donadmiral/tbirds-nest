import type { StoryTextSticker } from './stories';
export type StoryDrawStroke=NonNullable<StoryTextSticker['strokes']>[number];
export type StoryDrawPoint=StoryDrawStroke['points'][number];
export const DRAW_TOOLS=['pen','neon','marker','highlight','arrow','dot','eraser'] as const;
export const DRAW_COLORS=['#FFFFFF','#000000','#FF3B30','#FF9500','#FFD60A','#34C759','#00C7BE','#007AFF','#AF52DE','#C9BFB0'];
export const MAX_DRAW_STROKES=60,MAX_DRAW_POINTS=512,MAX_DRAW_TOTAL_POINTS=16000;
export function copyDrawing(strokes:StoryDrawStroke[]):StoryDrawStroke[]{return strokes.map(stroke=>({...stroke,points:stroke.points.map(point=>({...point}))}));}
export function storyDrawing(stickers:StoryTextSticker[]):StoryDrawStroke[]{return copyDrawing(stickers.find(sticker=>sticker.kind==='drawing')?.strokes??[]);}
export function replaceStoryDrawing(stickers:StoryTextSticker[],strokes:StoryDrawStroke[],createId=()=>crypto.randomUUID()):StoryTextSticker[]{
 const other=stickers.filter(sticker=>sticker.kind!=='drawing');if(!strokes.length)return other;
 if(other.length>=30)throw new Error('Remove a sticker before adding a drawing. A story can contain 30 stickers.');
 if(strokes.length>MAX_DRAW_STROKES||strokes.reduce((sum,stroke)=>sum+stroke.points.length,0)>MAX_DRAW_TOTAL_POINTS)throw new Error('This drawing is too detailed. Undo a stroke or clear it before continuing.');
 const existing=stickers.find(sticker=>sticker.kind==='drawing');
 return [...other,{...(existing??{id:createId(),text:'',style:'classic',color:'#FFFFFF',nx:.5,ny:.5,scale:1,rotation:0}),kind:'drawing',strokes:copyDrawing(strokes)}];
}
export function drawingPoint(clientX:number,clientY:number,rect:{left:number;top:number;width:number;height:number}):StoryDrawPoint|null{
 if(![clientX,clientY,rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
 const unit=(value:number)=>Math.round(Math.max(0,Math.min(1,value))*100000)/100000;
 return{x:unit((clientX-rect.left)/rect.width),y:unit((clientY-rect.top)/rect.height)};
}
export function appendDrawingPoint(points:StoryDrawPoint[],point:StoryDrawPoint,max=MAX_DRAW_POINTS):StoryDrawPoint[]{
 const previous=points.at(-1);if(points.length>=max||previous&&Math.hypot(point.x-previous.x,point.y-previous.y)<.002)return points;return [...points,point];
}
export function eraseDrawingAt(strokes:StoryDrawStroke[],point:StoryDrawPoint,width:number):StoryDrawStroke[]{
 const x=point.x*390,y=point.y*780,r=Math.max(12,width*1.5);
 const hits=(stroke:StoryDrawStroke)=>stroke.points.some((p,index)=>{const a=stroke.points[Math.max(0,index-1)],ax=a.x*390,ay=a.y*780,bx=p.x*390,by=p.y*780,dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length)):0;return Math.hypot(x-(ax+t*dx),y-(ay+t*dy))<=r+stroke.width/2;});
 const next=strokes.filter(stroke=>!hits(stroke));return next.length===strokes.length?strokes:next;
}
