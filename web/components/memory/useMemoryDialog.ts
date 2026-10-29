'use client';
import {useEffect,useRef} from 'react';

/** Keep a book dialog still and keyboard focus inside it, then restore its opener. */
export function useMemoryDialog(active:boolean,onClose:()=>void) {
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);
 close.current=onClose;
 useEffect(()=>{
  const node=ref.current;if(!active||!node)return;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow,rootOverflow=document.documentElement.style.overflow;
  document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
  const controls=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length>0&&el.getAttribute('aria-hidden')!=='true');
  const first=()=>node.querySelector<HTMLElement>('[data-autofocus]')??controls()[0]??node;
  const frame=requestAnimationFrame(()=>first().focus({preventScroll:true}));
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return;}
   if(event.key!=='Tab')return;
   const list=controls(),start=list[0],end=list[list.length-1];
   if(!start){event.preventDefault();node.focus();return;}
   if(event.shiftKey&&(!node.contains(document.activeElement)||document.activeElement===start)){event.preventDefault();end.focus();}
   else if(!event.shiftKey&&(!node.contains(document.activeElement)||document.activeElement===end)){event.preventDefault();start.focus();}
  };
  const contain=(event:FocusEvent)=>{if(event.target instanceof Node&&!node.contains(event.target))first().focus({preventScroll:true});};
  document.addEventListener('keydown',keys,true);document.addEventListener('focusin',contain);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',keys,true);document.removeEventListener('focusin',contain);document.body.style.overflow=overflow;document.documentElement.style.overflow=rootOverflow;if(opener?.isConnected)opener.focus({preventScroll:true});};
 },[active]);
 return ref;
}
