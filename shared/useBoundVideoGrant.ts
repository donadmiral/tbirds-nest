import {useRef} from 'react';
/** A capability already on screen is never rebound to a new session. A token renewal is a new grant. */
export function useBoundVideoGrant(uri:string,scope:string|null,pending=false,canAdopt=false){
 const grant=useRef({uri,scope,pending});
 if(grant.current.uri!==uri || (grant.current.pending && !pending && canAdopt))grant.current={uri,scope,pending};
 return !!scope && grant.current.scope===scope;
}
