import React from 'react';
import {createRoot} from 'react-dom/client';
import Link,{usePathname} from './ui-router-adapter';
import {LivePlaybackProvider} from '../../components/LivePlaybackProvider';
import {LiveDirectoryView} from '../../components/LiveDirectoryView';
import {LiveSessionView} from '../../components/LiveSessionView';
import {LiveClipEditor} from '../../components/LiveClipEditor';
import {LiveClipLibrary} from '../../components/LiveClipLibrary';
import {LiveClipView} from '../../components/LiveClipView';
import {LiveClipSettings,LivePlatformSettings} from '../../components/LiveClipSettings';
import NewLivePage from '../../app/live/new/page';
import {id} from './live-backend';
function Fixture(){const path=usePathname();return <LivePlaybackProvider><nav className="flex gap-5 border-b border-ink/10 p-3 text-sm text-ink"><Link href="/live">Live directory</Link><Link href="/messages">Messages</Link><Link href={'/live/'+id(10)}>Stream</Link></nav><main className="mx-auto max-w-7xl p-4">{path==='/live'?<LiveDirectoryView/>:path==='/live/new'?<NewLivePage/>:path==='/live/settings'?<LivePlatformSettings/>:path.endsWith('/settings')?<LiveClipSettings sessionId={id(10)}/>:path==='/live/clips'?<LiveClipLibrary/>:path.startsWith('/live/clips/')?<LiveClipView id={id(20)}/>:path.endsWith('/clips')?<LiveClipEditor sessionId={id(10)}/>:path==='/messages'?<h1>Messages</h1>:<LiveSessionView id={id(10)}/>}</main></LivePlaybackProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
