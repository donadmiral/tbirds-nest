import { createAppleMusicClient } from '../../shared/appleMusicClient';
import { createClient } from './supabase/client';

export const appleMusic = createAppleMusicClient(createClient());

export type MusicKitInstance = {
  isAuthorized: boolean;
  isPlaying: boolean;
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  setQueue(queue: { song: string }): Promise<unknown>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare global {
  interface Window {
    MusicKit?: { configure(options: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance> };
  }
}
