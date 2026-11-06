import {useSyncExternalStore} from 'react';
import {navigationScope,subscribeNavigationScope} from './navigationCache';
import {SUPABASE_URL} from '../services/supabase';
import {protectedPostVideo} from '../../shared/mediaDelivery';
import {useBoundVideoGrant} from '../../shared/useBoundVideoGrant';
export function usePostVideoRepresentation(uri:string,edit:unknown){
 const scope=useSyncExternalStore(subscribeNavigationScope,navigationScope,navigationScope);
 const bound=useBoundVideoGrant(uri,scope);const derived=protectedPostVideo(uri,edit,SUPABASE_URL);
 return {marked:!!derived,available:!derived||bound,source:derived?(bound?derived.compatible:''):uri,poster:derived&&bound?derived.poster:null,original:derived&&bound?uri:null};
}
