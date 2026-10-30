import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';

/** A completion belongs to one mounted story visit and one authenticated actor.
 * Returning to the same story/account does not revive an earlier visit. */
export function useStoryInteractionScope(viewerId: string | null, storyId: string | undefined) {
  const scope = useRef({ viewerId, storyId, mounted: true });
  if (scope.current.viewerId !== viewerId || scope.current.storyId !== storyId) {
    scope.current = { viewerId, storyId, mounted: scope.current.mounted };
  }
  useEffect(() => {
    scope.current = { ...scope.current, mounted: true };
    return () => { scope.current = { ...scope.current, mounted: false }; };
  }, []);

  return useCallback((expectedViewer: string | null, expectedStory: string | undefined) => {
    const visit = scope.current;
    const owner = useAuthStore.getState().session?.user.id;
    return () => !!owner && !!expectedViewer && !!expectedStory
      && visit.mounted && scope.current === visit
      && visit.viewerId === expectedViewer && visit.storyId === expectedStory
      && useAuthStore.getState().session?.user.id === owner
      && useAuthStore.getState().profile?.id === expectedViewer;
  }, []);
}
