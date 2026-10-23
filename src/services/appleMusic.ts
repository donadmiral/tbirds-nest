import { createAppleMusicClient } from '../../shared/appleMusicClient';
import { supabase } from './supabase';
export const appleMusic = createAppleMusicClient(supabase);
