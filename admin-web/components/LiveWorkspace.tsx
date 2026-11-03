'use client';
import { useState } from 'react';
import LiveOperations from './LiveOperations';
import LiveClipOperations from './LiveClipOperations';
export default function LiveWorkspace(){
  const [tab,setTab]=useState('broadcasts');
  return <div><div role="tablist" aria-label="Live operations sections" style={{display:'flex',gap:10,marginBottom:20}}>{[['broadcasts','Broadcasts'],['clips','Clips and sharing']].map(([id,label])=><button type="button" role="tab" aria-selected={tab===id} key={id} onClick={()=>setTab(id)} style={{minHeight:44,border:'1px solid var(--line)',padding:'8px 18px',borderRadius:22,background:tab===id?'var(--txt)':'var(--panel)',color:tab===id?'var(--panel)':'var(--txt)',fontSize:13,fontWeight:600}}>{label}</button>)}</div>{tab==='broadcasts'?<LiveOperations/>:<LiveClipOperations/>}</div>;
}
