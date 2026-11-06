import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {initialize,usePathname} from './live-connected-adapter';
import {LivePlaybackProvider} from '../../components/LivePlaybackProvider';
import {LiveDirectoryView} from '../../components/LiveDirectoryView';
import {LiveSessionView} from '../../components/LiveSessionView';
import {LiveClipEditor} from '../../components/LiveClipEditor';
import {LiveClipLibrary} from '../../components/LiveClipLibrary';
import {LiveClipView} from '../../components/LiveClipView';
import {LiveClipSettings} from '../../components/LiveClipSettings';
import NewLivePage from '../../app/live/new/page';
function Content(){const path=usePathname(),parts=path.split('/').filter(Boolean);return <LivePlaybackProvider><main className="mx-auto max-w-7xl p-4">{path==='/live'?<LiveDirectoryView/>:path==='/live/new'?<NewLivePage/>:path==='/live/clips'?<LiveClipLibrary/>:parts[1]==='clips'&&parts[2]?<LiveClipView id={parts[2]}/>:parts[2]==='clips'?<LiveClipEditor sessionId={parts[1]}/>:parts[2]==='settings'?<LiveClipSettings sessionId={parts[1]}/>:<LiveSessionView id={parts[1]}/>}</main></LivePlaybackProvider>;}
function Fixture(){const [ready,setReady]=useState(false),[error,setError]=useState('');useEffect(()=>{void initialize().then(()=>setReady(true)).catch(()=>setError('QA sign-in failed'));},[]);return ready?<Content/>:<p role="status">{error||'Signing in to QA'}</p>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
