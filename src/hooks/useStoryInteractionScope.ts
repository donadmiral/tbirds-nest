import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

/** A completion belongs to one mounted story visit and one authenticated actor.
 * Returning to the same story/account does not revive an earlier visit. */
export function useStoryInteractionScope(viewerId: string | null, storyId: string | undefined) {
  const scope = useRef({ viewerId, storyId, mounted: true });
  const identity = useRef(0);
  const [identityRevision, setIdentityRevision] = useState(0);
  if (scope.current.viewerId !== viewerId || scope.current.storyId !== storyId) {
    scope.current = { viewerId, storyId, mounted: scope.current.mounted };
  }
  useEffect(() => {
    scope.current = { ...scope.current, mounted: true };
    const initial = useAuthStore.getState();
    let owner = initial.session?.user.id, profile = initial.profile?.id;
    const unsubscribe = useAuthStore.subscribe(next => {
      if (owner !== next.session?.user.id || profile !== next.profile?.id) {
        // Account changes can complete before React renders. Returning to the
        // same account must still invalidate work from the previous visit.
        scope.current = { ...scope.current };
        identity.current += 1; setIdentityRevision(identity.current);
        owner = next.session?.user.id; profile = next.profile?.id;
      }
    });
    return () => { unsubscribe(); scope.current = { ...scope.current, mounted: false }; };
  }, []);

  return useCallback((expectedViewer: string | null, expectedStory: string | undefined) => {
    const visit = scope.current;
    const owner = useAuthStore.getState().session?.user.id;
    return () => !!owner && !!expectedViewer && !!expectedStory
      && identityRevision === identity.current
      && visit.mounted && scope.current === visit
      && visit.viewerId === expectedViewer && visit.storyId === expectedStory
      && useAuthStore.getState().session?.user.id === owner
      && useAuthStore.getState().profile?.id === expectedViewer;
  }, [identityRevision]);
}
