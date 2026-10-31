import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {OriginalAudioUpload} from '../../components/OriginalAudioUpload';
import {PostSoundtrack} from '../../components/PostSoundtrack';
import {MemoryMovieExport} from '../../components/memory/MemoryMovieExport';
import type {SoundtrackTrack} from '../../../shared/soundtrack';
import type {MemoryPage} from '../../lib/memoryAlbum';
import {fixtureOwner,fixtureBookId,setFixtureBook} from './music-library-client';
function Fixture(){
 const [track,setTrack]=useState<SoundtrackTrack|null>(null),[mode,setMode]=useState<'book'|'retained'|null>(null),[uploader,setUploader]=useState(true);
 const pages:MemoryPage[]=[{id:'one',media_type:'text',media_url:null,thumbnail_url:null,caption:'First original memory',taken_at:null,sort_order:0,duration_sec:3,text_background:{color:'#11233d'},...(mode==='retained'&&track?{audio_sound_id:track.id,audio_duration_sec:1,audio_title:track.title,media_transform:{scale:1,translateNX:0,translateNY:0,audioStartSec:.4,mix:{music:50}}}:{})},{id:'two',media_type:'text',media_url:null,thumbnail_url:null,caption:'Second original memory',taken_at:null,sort_order:1,duration_sec:3,text_background:{color:'#d1b16e'}}];
 const selection=track?{soundId:track.id,startSec:.4,durationSec:1,volume:.5,originalVolume:1}:null;
 useEffect(()=>{setFixtureBook({id:fixtureBookId,title:'Original audio memories',can_view:true,is_owner:true,pages,soundtrack:mode==='book'?selection:null,presentation_revision:0});});
 return <main style={{maxWidth:680,margin:'0 auto',padding:24,color:'#102039',background:'#fff',minHeight:'100vh'}}><h1>Original audio acceptance</h1><p>Generated test sound and synthetic account transport. Actual upload, recording and movie components.</p><button onClick={()=>setUploader(value=>!value)}>{uploader?'Hide uploader':'Show uploader'}</button>{uploader?<OriginalAudioUpload owner={fixtureOwner} onAdded={setTrack}/>:null}{track?<section><output>Verified: {track.title}</output><PostSoundtrack selection={selection}/><button onClick={()=>setMode('book')}>Download book soundtrack</button><button onClick={()=>setMode('retained')}>Download retained story audio</button></section>:null}{mode&&track?<MemoryMovieExport bookId={fixtureBookId} revision={0} key={mode} title="Original audio memories" pages={pages} soundtrack={mode==='book'?selection:null} initialScore={false} initialOriginalAudio={false} scoreVolume={.3} onClose={()=>setMode(null)} onRefresh={()=>{}}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
