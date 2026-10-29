'use client';
import {forwardRef,useCallback,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode,type PointerEvent} from 'react';
import {MemoryBookTurnMachine,memoryTurnAngle,memoryTurnDuration,memoryTurnProgress,memoryTurnShouldCommit,type MemoryTurn,type MemoryTurnDirection} from '../../../shared/memoryBookTurn';
import {memoryCoverMedia,type MemoryCoverPage} from '../../../shared/memoryBookDesign';
import styles from './MemoryPageTurn.module.css';
export type MemoryPageTurnHandle={turn:(direction:MemoryTurnDirection)=>void;cancel:()=>void};
type Props={pageIds:readonly string[];index:number;active:boolean;spine:string;title:string;children:ReactNode;renderPreview:(index:number)=>ReactNode;onCommit:(index:number)=>void;onTurningChange:(turning:boolean)=>void};
export const MemoryPageTurn=forwardRef<MemoryPageTurnHandle,Props>(function MemoryPageTurn({pageIds,index,active,spine,title,children,renderPreview,onCommit,onTurningChange},ref){
 const machine=useRef(new MemoryBookTurnMachine(pageIds,index)).current;
 const root=useRef<HTMLDivElement>(null),frame=useRef(0),live=useRef(true),reduced=useRef(false);
 const callbacks=useRef({onCommit,onTurningChange});callbacks.current={onCommit,onTurningChange};
 const [turn,setTurn]=useState<MemoryTurn|null>(null);
 const gesture=useRef<{id:number;x:number;y:number;time:number;lastX:number;lastTime:number;velocity:number;token?:number;direction?:MemoryTurnDirection}|null>(null);
 const paint=useCallback((progress:number,direction:MemoryTurnDirection)=>{root.current?.style.setProperty('--book-angle',String(memoryTurnAngle(progress,direction)));root.current?.style.setProperty('--fold-shadow',String(Math.sin(Math.PI*progress)));},[]);
 const cancel=useCallback(()=>{cancelAnimationFrame(frame.current);machine.cancel();gesture.current=null;paint(0,1);if(live.current){setTurn(null);callbacks.current.onTurningChange(false);}},[machine,paint]);
 const identity=pageIds.join('|');
 useLayoutEffect(()=>{cancelAnimationFrame(frame.current);machine.sync(pageIds,index);if(!machine.turn){paint(0,1);setTurn(null);callbacks.current.onTurningChange(false);}},[identity,index,machine,paint]);
 useEffect(()=>{live.current=true;const media=matchMedia('(prefers-reduced-motion: reduce)');const apply=()=>{reduced.current=media.matches;if(media.matches)cancel();};apply();media.addEventListener('change',apply);const hidden=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hidden);return()=>{live.current=false;cancelAnimationFrame(frame.current);machine.cancel();media.removeEventListener('change',apply);document.removeEventListener('visibilitychange',hidden);};},[cancel,machine]);
 useEffect(()=>{if(!active)cancel();},[active,cancel]);
 const settle=useCallback((current:MemoryTurn,commit:boolean)=>{
  if(!machine.settle(current.token))return;
  const start=current.progress,target=commit?1:0,duration=memoryTurnDuration(start,commit,reduced.current),began=performance.now();
  const finish=()=>{if(!live.current||machine.turn?.token!==current.token)return;const next=machine.finish(current.token,commit);if(next!==null)callbacks.current.onCommit(next);else{setTurn(null);paint(0,1);callbacks.current.onTurningChange(false);}};
  if(!duration){paint(target,current.direction);finish();return;}
  const tick=(now:number)=>{if(!live.current||machine.turn?.token!==current.token)return;const part=Math.min(1,(now-began)/duration),eased=1-Math.pow(1-part,3);paint(start+(target-start)*eased,current.direction);if(part<1)frame.current=requestAnimationFrame(tick);else finish();};
  frame.current=requestAnimationFrame(tick);
 },[machine,paint]);
 const turnPage=useCallback((direction:MemoryTurnDirection)=>{if(!active)return;const next=machine.begin(direction);if(!next)return;paint(0,direction);setTurn({...next});callbacks.current.onTurningChange(true);settle(next,true);},[active,machine,paint,settle]);
 useImperativeHandle(ref,()=>({turn:turnPage,cancel}),[turnPage,cancel]);
 const down=(event:PointerEvent<HTMLDivElement>)=>{if(!active||machine.turn||event.button!==0)return;if((event.target as HTMLElement).closest('button,a,input,textarea,select,video,[contenteditable=true]'))return;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,lastX:event.clientX,lastTime:event.timeStamp,velocity:0};};
 const move=(event:PointerEvent<HTMLDivElement>)=>{const g=gesture.current;if(!g||g.id!==event.pointerId)return;const dx=event.clientX-g.x,dy=event.clientY-g.y;if(!g.token){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){gesture.current=null;return;}if(Math.abs(dx)<12||Math.abs(dx)<Math.abs(dy)*1.4)return;const dir:MemoryTurnDirection=dx<0?1:-1,next=machine.begin(dir,true);if(!next){gesture.current=null;return;}g.token=next.token;g.direction=dir;root.current?.setPointerCapture(event.pointerId);setTurn({...next});callbacks.current.onTurningChange(true);}
  const elapsed=event.timeStamp-g.lastTime;if(elapsed>0)g.velocity=(event.clientX-g.lastX)/elapsed;g.lastX=event.clientX;g.lastTime=event.timeStamp;const progress=memoryTurnProgress(dx,root.current?.clientWidth??1,g.direction!);machine.move(g.token!,progress);paint(progress,g.direction!);};
 const release=(event:PointerEvent<HTMLDivElement>,cancelled=false)=>{const g=gesture.current;if(!g||g.id!==event.pointerId)return;gesture.current=null;const current=machine.turn;if(!current||current.token!==g.token)return;const velocity=event.timeStamp-g.lastTime>100?0:g.velocity;settle(current,!cancelled&&memoryTurnShouldCommit(current.progress,velocity,current.direction));if(root.current?.hasPointerCapture(event.pointerId))root.current.releasePointerCapture(event.pointerId);};
 return <div ref={root} role="group" aria-label={title+' pages'} className={styles.book} style={{'--book-spine':spine} as CSSProperties} data-memory-turn={turn?turn.direction===1?'forward':'backward':'idle'} onPointerDown={down} onPointerMove={move} onPointerUp={e=>release(e)} onPointerCancel={e=>release(e,true)}>
  <div className={styles.stage}>
   {turn?.direction===1&&<div aria-hidden="true" className={styles.under}>{renderPreview(turn.to)}</div>}
   <div className={styles.cast}/>
   <div className={styles.live+(turn?.direction===1?' '+styles.forward:'')} aria-hidden={!!turn} inert={!!turn} data-memory-live-page><div className={styles.content}>{children}</div></div>
   {turn&&<div className={styles.sheet} aria-hidden="true">{turn.direction===-1&&<div className={styles.front}>{renderPreview(turn.to)}</div>}<div className={styles.back}><span>{title}</span><small>{String(turn.direction===1?turn.from+1:turn.to+1).padStart(2,'0')}</small></div></div>}
   <button type="button" tabIndex={-1} aria-label="Previous page" disabled={index===0||!!turn||!active} className={styles.edge+' '+styles.previous} onClick={()=>turnPage(-1)}/>
   <button type="button" tabIndex={-1} aria-label="Next page" disabled={index>=pageIds.length-1||!!turn||!active} className={styles.edge+' '+styles.next} onClick={()=>turnPage(1)}/>
  </div>
 </div>;
});
/** Turning sheets intentionally render no video/audio element or player. */
export function MemoryTurnPreview({page,index}:{page:MemoryCoverPage;index:number}){
 const media=memoryCoverMedia(page),[failed,setFailed]=useState<string[]>([]),src=[media.photoUrl,media.fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 return <div className={styles.preview}><span className={styles.previewNumber}>{String(index+1).padStart(2,'0')} ─</span><div className={styles.previewMedia}>{src?<img src={src} alt="" onError={()=>setFailed(values=>[...values,src])}/>:<span>{page.media_type==='video'?'Video memory':page.story_caption||page.caption||'A memory'}</span>}</div><span className={styles.previewCaption}>{page.caption}</span></div>;
}
