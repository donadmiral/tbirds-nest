'use client';
import {useSyncExternalStore} from 'react';
import {useBoundVideoGrant} from '../../shared/useBoundVideoGrant';
import {getNavigationStore} from './navigationCache';
export function useBoundPostVideo(uri:string){
 const nav=getNavigationStore();const session=useSyncExternalStore(nav.subscribe,nav.getSnapshot,nav.getServerSnapshot);
 return useBoundVideoGrant(uri,session.scope,!session.initialized,!session.changed);
}
