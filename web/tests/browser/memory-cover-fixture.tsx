import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {MemoryBookDesigner} from '../../components/memory/MemoryBookDesigner';
import {MemoryBookCover} from '../../components/memory/MemoryBookCover';
import {MemoryAlbumView} from '../../components/MemoryAlbum';
import {MEMORY_FEATURED_DESIGNS} from '../../../shared/memoryBookDesign';
import {memoryCoverArtwork,type MemoryCoverArtwork} from '../../../shared/memoryBookCreative';
import {OWNER,memoryCoverQA,savedBook,stories} from './memory-cover-adapter';

const normal='The days we wandered, the little places we found, and the people who made every moment feel like home. A book to keep and return to, wherever life takes us next.'.slice(0,160);
const paragraphs=Array.from({length:24},(_,index)=>`Line ${index}`).join('\n').slice(0,160);
const wide='那些一起走过的日子每一个微小的瞬间都值得被记住愿我们永远怀着好奇与温柔走向远方'.repeat(5).slice(0,160);
const longWord='W'.repeat(160);
function Gallery(){
 const params=new URLSearchParams(location.search),kind=params.get('text'),font=params.get('font')??'handwritten',position=params.get('position')??'bottom',width=Number(params.get('width'))||230;
 const artwork:MemoryCoverArtwork={...memoryCoverArtwork(),inscription:kind==='multiline'?paragraphs:kind==='wide'?wide:kind==='unbroken'?longWord:normal,inscriptionStyle:font as MemoryCoverArtwork['inscriptionStyle'],inscriptionPosition:position as MemoryCoverArtwork['inscriptionPosition'],postmark:'THE LAST WEEKEND OF SUMMER, 2026!'.slice(0,32)};
 const title=kind==='unbroken'?'W'.repeat(30):kind==='wide'?'那些一起走过的日子和最想珍藏的小小回忆':'All the places we called home';
 return <main style={{padding:24,background:'#e9e4d9',minHeight:'100vh',color:'#142642'}}><h1>Actual memory book cover verification</h1><div style={{display:'flex',gap:28,flexWrap:'wrap',marginTop:20}}>{MEMORY_FEATURED_DESIGNS.map(design=><section key={design.id} data-cover={design.id}><h2 style={{fontSize:14,marginBottom:12}}>{design.label}</h2><MemoryBookCover title={title} subtitle="The small moments that made this summer unforgettable" design={design.id} artwork={artwork} photoUrl={stories[0].media_url??undefined} takenAt={stories[0].created_at} width={width} height={width*1.31}/></section>)}</div></main>;
}
function Fixture(){
 const [book,setBook]=useState(()=>savedBook()?.id??null),[open,setOpen]=useState(true);
 useEffect(()=>{const target=window as Window&{memoryCoverQA?:typeof memoryCoverQA};target.memoryCoverQA=memoryCoverQA;return()=>{delete target.memoryCoverQA;};},[]);
 if(new URLSearchParams(location.search).get('mode')==='gallery')return <Gallery/>;
 return <main style={{minHeight:'100vh',background:'#f6f2e9',color:'#142642'}}><h1 className="p-4 text-sm">Synthetic owner · actual memory book designer and editor</h1>{book?<MemoryAlbumView ownerId={book}/>:open?<MemoryBookDesigner ownerId={OWNER} onClose={()=>setOpen(false)} onCreated={setBook}/>:<p role="status">The previous owner’s book draft is closed.</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
