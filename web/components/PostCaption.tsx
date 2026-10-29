import { postCaptionAt, type PostCaptionCue } from '../../shared/postMediaEditing';

export function PostCaption({captions,time,preview}:{captions?:PostCaptionCue[]|null;time:number;preview?:PostCaptionCue|null}) {
  const cue = preview ?? postCaptionAt(captions,time);
  if(!cue?.text)return null;
  return <div aria-live="off" className="pointer-events-none absolute inset-x-[8%] z-[4] flex justify-center" style={cue.position==='top'?{top:'10%'}:cue.position==='middle'?{top:'44%'}:{bottom:'16%'}}>
    <span style={{maxWidth:'100%',whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:'7px 11px',borderRadius:5,textAlign:'center',fontSize:'clamp(15px, 2.2vw, 24px)',lineHeight:1.35,fontFamily:cue.style==='clean'?'Georgia, serif':undefined,fontWeight:cue.style==='bold'?800:cue.style==='highlight'?700:400,background:cue.style==='highlight'?'#F0E4CE':'rgba(0,0,0,.58)',color:cue.style==='highlight'?'#10213E':'#FFF',textShadow:cue.style==='highlight'?'none':'0 1px 5px rgba(0,0,0,.6)'}}>{cue.text}</span>
  </div>;
}
