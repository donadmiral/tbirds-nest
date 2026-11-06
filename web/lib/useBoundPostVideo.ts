'use client';
import {useRef,useSyncExternalStore} from 'react';
import {getNavigationStore} from './navigationCache';

/** Bind a displayed capability to its issuing session. The web deployment installs React under web/ only. */
export function useBoundPostVideo(uri:string){
  const nav=getNavigationStore();
  const session=useSyncExternalStore(nav.subscribe,nav.getSnapshot,nav.getServerSnapshot);
  const {scope,initialized,changed}=session;
  const grant=useRef({uri,scope,pending:!initialized});
  if(grant.current.uri!==uri || (grant.current.pending && initialized && !changed)) grant.current={uri,scope,pending:!initialized};
  return !!scope && grant.current.scope===scope;
}
