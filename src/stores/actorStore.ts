/**
 * actorStore
 *
 * Who you are posting as. A business never signs in, so its team acts for it,
 * and the server enforces that through can_act_as(). This is the client half:
 * one value every create path reads instead of reaching for auth.uid().
 *
 * Two rules, both deliberate:
 *
 *   Reading is always as the person. Switching actor changes what you create,
 *   never what you see. Instagram's account switching changes both and people
 *   lose track of which feed they are looking at.
 *
 *   The actor resets to the person on every launch. Nobody should discover on
 *   Friday that they have been posting as their business since Tuesday.
 *
 * Nothing here is persisted, which is what makes the reset automatic.
 */
import { create } from 'zustand';
import { supabase } from '../services/supabase';

export type Actor = {
  actor_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  kind: 'personal' | 'business';
  role: string;
};

type ActorState = {
  actors: Actor[];
  actorId: string | null;
  loading: boolean;
  error: string | null;

  loadActors: () => Promise<void>;
  setActor: (id: string) => void;
  resetToSelf: () => void;
  clear: () => void;

  /** The actor to author new content as. Falls back to the signed-in person. */
  currentActor: () => Actor | null;
  /** True when acting as anything other than yourself. */
  isActingAsBusiness: () => boolean;
};

export const useActorStore = create<ActorState>((set, get) => ({
  actors: [],
  actorId: null,
  loading: false,
  error: null,

  loadActors: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase.rpc('get_my_actors');
    if (error) {
      console.log('[ACTORS]', error.message);
      set({ loading: false, error: error.message });
      return;
    }
    const actors = (data ?? []) as Actor[];
    const self = actors.find(a => a.kind === 'personal') ?? actors[0] ?? null;
    const current = get().actorId;
    // Keep the current selection only if it is still one of yours.
    const stillValid = current && actors.some(a => a.actor_id === current);
    set({
      actors,
      actorId: stillValid ? current : (self?.actor_id ?? null),
      loading: false,
    });
  },

  setActor: (id: string) => {
    if (get().actors.some(a => a.actor_id === id)) set({ actorId: id });
  },

  resetToSelf: () => {
    const self = get().actors.find(a => a.kind === 'personal');
    set({ actorId: self?.actor_id ?? null });
  },

  clear: () => set({ actors: [], actorId: null, loading: false, error: null }),

  currentActor: () => {
    const { actors, actorId } = get();
    return actors.find(a => a.actor_id === actorId)
      ?? actors.find(a => a.kind === 'personal')
      ?? null;
  },

  isActingAsBusiness: () => {
    const a = get().currentActor();
    return !!a && a.kind === 'business';
  },
}));

/**
 * The id to write into user_id, seller_id, posted_by or sender_id on create.
 * Falls back to the signed-in person when no actors have loaded yet, so a
 * create path is never blocked by this store failing.
 */
export function authorId(fallbackUserId: string | null): string | null {
  const a = useActorStore.getState().currentActor();
  return a?.actor_id ?? fallbackUserId;
}