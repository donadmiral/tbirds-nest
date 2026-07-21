/**
 * useEnhancementController.ts
 *
 * Finite state machine for cinematic memory enhancement.
 *
 * Owns: enhancement modal state, generation lifecycle, variation management,
 *       cancellation, cache cleanup, draft integration.
 * Does NOT own: cloud inference (delegates to enhancementService),
 *       face detection (delegates to enhancementAnalyzer),
 *       temp files (delegates to enhancementCacheService),
 *       draft state (writes via updateDraft callback),
 *       undo stack (calls pushHistory callback).
 *
 * States: idle | analyzing | generating | downloading | ready | applying | failed | cancelled
 * No boolean soup. Single state drives all UI and behavior.
 *
 * Cancellation: AbortController aborts fetch. Polling stops. Cache cleans.
 * Original asset: NEVER mutated. originalUri is immutable once set.
 * Undo: instant. Restores localUri to originalUri. No regeneration.
 * Re-render safety: all mutable data in refs. No accidental generation restart.
 *
 * Future-ready: state machine accepts new states (relighting, reframing, video)
 * without rewriting. Provider and model are opaque to this controller.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../../services/supabase';
import { analyzeFace, getImageDimensions } from '../../services/ai/enhancementAnalyzer';
import { getEnhancementService } from '../../services/ai/enhancementService';
import type { VariationResult, EnhancementResult } from '../../services/ai/enhancementService';
import { getFaceIdentityService } from '../../services/ai/faceIdentityService';
import { getIdentityReconstructionService } from '../../services/ai/identityReconstructionService';
import type { ReconstructionCandidate } from '../../services/ai/identityReconstructionService';
import { getRealismVerificationService } from '../../services/ai/realismVerificationService';
import type { VerifiedCandidate } from '../../services/ai/realismVerificationService';
import {
  cacheVariation,
  deleteCachedFiles,
  cleanDraftCache,
} from '../../services/ai/enhancementCacheService';

// â”€â”€ State machine â”€â”€

export type EnhancementState =
  | 'idle'
  | 'analyzing'
  | 'generating'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'failed'
  | 'cancelled';

export interface CachedVariation {
  localUri: string;
  tone: string;
  promptUsed: string;
}

export interface EnhancementMeta {
  provider: string;
  model: string;
  strength: number;
  variationIndex: number;
  generatedAt: string;
  faceBox: { x: number; y: number; w: number; h: number };
  tone: string;
}

// â”€â”€ Controller interface â”€â”€

export interface EnhancementControllerInput {
  draftId: string;
  localUri: string | null;
  originalUri: string | null;
  mediaType: 'image' | 'video' | 'text';
  updateDraft: (patch: Record<string, any>) => void;
  pushHistory: () => void;
  closeBloom: () => void;
}

export interface EnhancementControllerOutput {
  // State
  enhancerOpen: boolean;
  trainingWizardOpen: boolean;
  state: EnhancementState;
  variations: CachedVariation[];
  selectedIndex: number;
  failureMessage: string | null;
  faceDetected: boolean;
  multipleFaces: boolean;
  selectedReferenceUrl: string | null;
  setSelectedReferenceUrl: (url: string | null) => void;
  stableOriginalUri: string | null;
  enhancementIntensity: number;
  setEnhancementIntensity: (val: number) => void;

  // Actions
  openEnhancer: () => void;
  closeEnhancer: () => void;
  openTrainingWizard: () => void;
  closeTrainingWizard: () => void;
  onTrainingComplete: () => void;
  onTrainingSkip: () => void;
  generateEnhancements: () => Promise<void>;
  cancelGeneration: () => void;
  selectVariation: (index: number) => void;
  applyVariation: () => void;
  discardVariations: () => void;
  retryGeneration: () => void;
}

// â”€â”€ Image conversion â”€â”€

async function imageUriToBase64(uri: string): Promise<string> {
  let readableUri = uri;
  console.log('[Enhancement] imageUriToBase64 input uri:', uri);

  // Camera roll URIs (ph://, assets-library://) can't be read directly.
  // Copy to cache first to get a file:// URI.
  if (!uri.startsWith('file://') && !uri.startsWith('/')) {
    const ext = uri.includes('.png') ? 'png' : 'jpg';
    const tempPath = FileSystem.cacheDirectory + `enhance_temp_${Date.now()}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: tempPath });
      readableUri = tempPath;
      console.log('[Enhancement] Copied to cache:', tempPath);
    } catch (copyErr) {
      console.error('[Enhancement] Copy failed, cannot read non-file URI:', copyErr);
      throw new Error('Cannot read camera roll image. Try taking a new photo.');
    }
  }

  // Verify file exists before reading
  const info = await FileSystem.getInfoAsync(readableUri);
  console.log('[Enhancement] File info:', JSON.stringify(info));
  if (!info.exists) {
    throw new Error('Image file not found on device.');
  }

  const base64 = await FileSystem.readAsStringAsync(readableUri, {
    encoding: 'base64',
  });

  // Clean up temp copy
  if (readableUri !== uri) {
    FileSystem.deleteAsync(readableUri, { idempotent: true }).catch(() => {});
  }

  console.log('[Enhancement] base64 read success, length:', base64.length);
  return base64;
}

// â”€â”€ Controller â”€â”€

export function useEnhancementController(
  input: EnhancementControllerInput
): EnhancementControllerOutput {
  const { draftId, localUri, originalUri, mediaType, updateDraft, pushHistory, closeBloom } = input;

  // â”€â”€ State (only enhancerOpen and state trigger rerenders) â”€â”€
  const [enhancerOpen, setEnhancerOpen] = useState(false);
  const [trainingWizardOpen, setTrainingWizardOpen] = useState(false);
  const [state, _setState] = useState<EnhancementState>('idle');
  const [variations, setVariations] = useState<CachedVariation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [multipleFaces, setMultipleFaces] = useState(false);
  const [selectedReferenceUrl, setSelectedReferenceUrl] = useState<string | null>(null);
  const stableOriginalUri = useRef<string | null>(null);
  const [enhancementIntensity, setEnhancementIntensity] = useState(0.5);

  // Sync state and ref together so callbacks always read current state
  const setStateSafe = useCallback((next: EnhancementState) => {
    stateRef.current = next;
    _setState(next);
  }, []);

  // â”€â”€ Stable refs (survive re-renders, prevent accidental restarts) â”€â”€
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(0); // increments per generation, prevents stale completions
  const variationUrisRef = useRef<string[]>([]); // tracks all cached URIs for cleanup
  const appStateRef = useRef<AppStateStatus>('active');
  const stateRef = useRef<EnhancementState>('idle'); // ref mirror for guards inside callbacks

  // â”€â”€ Lifecycle â”€â”€

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort any in-flight generation
      abortRef.current?.abort();
      // Clean all cached variations on unmount
      if (variationUrisRef.current.length > 0) {
        deleteCachedFiles(variationUrisRef.current).catch(() => {});
        variationUrisRef.current = [];
      }
    };
  }, []);

  // â”€â”€ AppState: pause polling on background â”€â”€

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next !== 'active' && stateRef.current === 'generating') {
        // Don't abort, just note we're backgrounded. Polling checks this.
      }
    });
    return () => sub.remove();
  }, []);

  // â”€â”€ Open/Close â”€â”€

  const openEnhancer = useCallback(async () => {
    if (mediaType === 'text' || mediaType === 'video') return;
    if (!localUri) return;
    closeBloom();

    console.log('[Enhancement] openEnhancer called');

    // Check if user has trained identity
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      console.log('[Enhancement] userId:', userId || 'none');

      if (userId) {
        const identity = await getFaceIdentityService().getIdentity(userId);
        console.log('[Enhancement] identity:', identity ? identity.status : 'null');

        if (!identity || identity.status !== 'ready') {
          console.log('[Enhancement] No ready identity, opening wizard');
          setTrainingWizardOpen(true);
          return;
        }
        console.log('[Enhancement] Identity ready, opening enhancer');
      } else {
        console.log('[Enhancement] No userId, opening wizard');
        setTrainingWizardOpen(true);
        return;
      }
    } catch (authErr) {
      console.error('[Enhancement] Auth check failed:', authErr);
      // Still open wizard since we can't verify identity
      setTrainingWizardOpen(true);
      return;
    }

    setEnhancerOpen(true);
    setStateSafe('idle');
    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
    setFaceDetected(true);
    setMultipleFaces(false);
  }, [mediaType, localUri, closeBloom]);

  const closeEnhancer = useCallback(() => {
    // Abort any in-flight work
    abortRef.current?.abort();
    abortRef.current = null;

    // Clean cached variations
    if (variationUrisRef.current.length > 0) {
      deleteCachedFiles(variationUrisRef.current).catch(() => {});
      variationUrisRef.current = [];
    }

    setEnhancerOpen(false);
    setStateSafe('idle');
    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
  }, []);


  // â”€â”€ Generate â”€â”€

  const generateEnhancements = useCallback(async () => {
    if (!localUri) return;
    if (stateRef.current === 'generating' || stateRef.current === 'downloading') return;

    // Cancel previous generation if any
    abortRef.current?.abort();

    // New session
    const sessionId = ++sessionIdRef.current;
    const abort = new AbortController();
    abortRef.current = abort;

    // Clean previous variations
    if (variationUrisRef.current.length > 0) {
      await deleteCachedFiles(variationUrisRef.current);
      variationUrisRef.current = [];
    }
    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);

    // â”€â”€ Stage 1: Analyze face (on-device) â”€â”€
    setStateSafe('analyzing');

    const sourceUri = originalUri || localUri;
    const analysis = await analyzeFace(sourceUri);

    if (sessionIdRef.current !== sessionId || abort.signal.aborted) {
      setStateSafe('cancelled');
      return;
    }

    if (!analysis.faceDetected || !analysis.faceRegion || !analysis.quality) {
      if (mountedRef.current) {
        setFaceDetected(false);
        setFailureMessage('Enhancement works best when a face is visible.');
        setStateSafe('failed');
      }
      return;
    }

    if (mountedRef.current) {
      setFaceDetected(true);
      setMultipleFaces(analysis.multiplefaces);
    }

    // â”€â”€ Stage 2: Read image â”€â”€
    setStateSafe('generating');

    let base64: string;
    try {
      base64 = await imageUriToBase64(sourceUri);
    } catch (b64Err: any) {
      console.error('[Enhancement] base64 read failed:', b64Err);
      if (mountedRef.current) {
        setFailureMessage('Could not read image file. Try a different photo.');
        setStateSafe('failed');
      }
      return;
    }

    if (abort.signal.aborted || sessionIdRef.current !== sessionId) {
      setStateSafe('cancelled');
      return;
    }

    const dimensions = await getImageDimensions(sourceUri);

    // â”€â”€ Stage 3: Route - identity reconstruction or quick enhance â”€â”€
    let candidateUrls: { url: string; tone: string; promptUsed: string }[] = [];

    try {
      // Check for trained identity
      const identityService = getFaceIdentityService();
      let identity = null;
      let userId: string | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        userId = sessionData?.session?.user?.id;
        if (userId) {
          identity = await identityService.getIdentity(userId);
        }
      } catch {
        // Auth lookup failed, proceed with quick enhance
      }

      if (identity && identity.status === 'ready') {
        console.log('[Enhancement] Identity ready, fetching reference URLs...');
        // â”€â”€ IDENTITY RECONSTRUCTION (reference-image guided) â”€â”€
        // Get reference photo URLs for this user
        console.log('[Enhancement] Fetching refs for userId:', userId);
        let referenceUrls: string[];
        if (selectedReferenceUrl) {
          referenceUrls = [selectedReferenceUrl];
          console.log('[Enhancement] Using user-selected reference');
        } else {
          referenceUrls = await identityService.getReferencePhotoUrls(userId, 5);
        }
        console.log('[Enhancement] Got reference URLs:', referenceUrls.length);
        console.log('[Enhancement] Reference URLs:', referenceUrls.length);

        if (referenceUrls.length === 0) {
          // No reference photos available, fall through to quick enhance
        } else {
          try {
          const stablePath = FileSystem.cacheDirectory + 'original_' + Date.now() + '.jpg';
          await FileSystem.copyAsync({ from: sourceUri, to: stablePath });
          stableOriginalUri.current = stablePath;
          console.log('[Enhancement] Original copied to stable cache');
        } catch (copyErr) {
          console.warn('[Enhancement] Failed to copy original:', copyErr);
          stableOriginalUri.current = sourceUri;
        }
        console.log('[Enhancement] Starting reconstruction...');
          const reconstructor = getIdentityReconstructionService();
          console.log('[Enhancement] Calling reconstruct with', referenceUrls.length, 'refs');
          const result = await reconstructor.reconstruct({
            imageBase64: base64,
            sourceFileUri: sourceUri,
            userId: userId,
            faceRegion: analysis.faceRegion,
            quality: analysis.quality,
            referencePhotoUrls: referenceUrls,
            imageWidth: dimensions.width,
            imageHeight: dimensions.height,
            targetFidelity: enhancementIntensity,
          });

          if (abort.signal.aborted || sessionIdRef.current !== sessionId) {
            setStateSafe('cancelled');
            return;
          }

          // â”€â”€ Stage 4: Realism verification â”€â”€
          const verifier = getRealismVerificationService();
          const verification = await verifier.verify(
            result.candidates,
            analysis.faceRegion,
            analysis.quality,
            base64
          );

          if (verification.verified.length > 0) {
            candidateUrls = verification.verified.map(v => ({
              url: v.url, tone: v.tone, promptUsed: v.promptUsed,
            }));
          }
          // If verification rejected all, fall through to quick enhance
        }
      }

      // â”€â”€ QUICK ENHANCE (fallback or no identity) â”€â”€
      if (candidateUrls.length === 0) {
        const service = getEnhancementService();
        const result = await service.enhance({
          imageBase64: base64,
          faceRegion: analysis.faceRegion,
          quality: analysis.quality,
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });

        if (abort.signal.aborted || sessionIdRef.current !== sessionId) {
          setStateSafe('cancelled');
          return;
        }

        candidateUrls = result.variations.map(v => ({
          url: v.uri, tone: v.tone, promptUsed: v.promptUsed,
        }));
      }
    } catch (err: any) {
      if (abort.signal.aborted || sessionIdRef.current !== sessionId) {
        setStateSafe('cancelled');
        return;
      }
      if (mountedRef.current) {
        const msg = err?.message || '';
        if (msg.includes('No AI provider configured') || msg.includes('REPLICATE_API_TOKEN')) {
          setFailureMessage('AI enhancement is not configured yet. Set up your API token to enable this feature.');
        } else if (msg.includes('no trained version') || msg.includes('Training may still be')) {
          setFailureMessage('Your identity is still being prepared. Try again soon.');
        } else {
          setFailureMessage("Enhancement isn't available right now. Your original photo is safe.");
        }
        setStateSafe('failed');
      }
      return;
    }

    if (candidateUrls.length === 0) {
      if (mountedRef.current) {
        setFailureMessage('Could not generate variations. Your original photo is safe.');
        setStateSafe('failed');
      }
      return;
    }

    // â”€â”€ Stage 5: Download and cache â”€â”€
    setStateSafe('downloading');

    const cached: CachedVariation[] = [];
    const cachedUris: string[] = [];

    const downloads = candidateUrls.map(async (v, i) => {
      try {
        let cachedUri = await cacheVariation(v.url, draftId, i);
        // Resize to original dimensions (fixes cropping)
        try {
          const resized = await manipulateAsync(
            cachedUri,
            [{ resize: { width: dimensions.width, height: dimensions.height } }],
            { compress: 0.95, format: SaveFormat.JPEG }
          );
          cachedUri = resized.uri;
          console.log('[Enhancement] Resized to', dimensions.width + 'x' + dimensions.height);
        } catch (resizeErr) {
          console.warn('[Enhancement] Resize failed, using cached:', resizeErr);
        }
        return { localUri: cachedUri, tone: v.tone, promptUsed: v.promptUsed };
      } catch (dlErr) {
        console.warn(`[Enhancement] Failed to cache variation ${i}:`, dlErr);
        return null;
      }
    });

    const downloaded = await Promise.all(downloads);

    if (abort.signal.aborted || sessionIdRef.current !== sessionId) {
      const completedUris = downloaded.filter(Boolean).map(d => d!.localUri);
      if (completedUris.length > 0) deleteCachedFiles(completedUris).catch(() => {});
      setStateSafe('cancelled');
      return;
    }

    for (const d of downloaded) {
      if (d) { cached.push(d); cachedUris.push(d.localUri); }
    }

    if (cached.length === 0) {
      if (mountedRef.current) {
        setFailureMessage('Could not download results. Your original photo is safe.');
        setStateSafe('failed');
      }
      return;
    }

    const toneOrder: Record<string, number> = { Natural: 0, Golden: 1, Platinum: 2, Evening: 3 };
    cached.sort((a, b) => (toneOrder[a.tone] ?? 99) - (toneOrder[b.tone] ?? 99));

    variationUrisRef.current = cachedUris;

    if (mountedRef.current) {
      setVariations(cached);
      setSelectedIndex(0);
      setStateSafe('ready');
    }
  }, [localUri, originalUri, draftId]);

  // â”€â”€ Cancel â”€â”€

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (variationUrisRef.current.length > 0) {
      deleteCachedFiles(variationUrisRef.current).catch(() => {});
      variationUrisRef.current = [];
    }

    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
    setStateSafe('cancelled');

    // Reset to idle after brief cancel acknowledgment
    setTimeout(() => {
      if (mountedRef.current) setStateSafe('idle');
    }, 300);
  }, []);

  // â”€â”€ Select variation â”€â”€

  const selectVariation = useCallback((index: number) => {
    if (index >= 0 && index < variations.length) {
      setSelectedIndex(index);
    }
  }, [variations.length]);

  // â”€â”€ Apply selected variation to draft â”€â”€

  const applyVariation = useCallback(() => {
    if (stateRef.current !== 'ready' || variations.length === 0) return;
    if (selectedIndex < 0 || selectedIndex >= variations.length) return;

    setStateSafe('applying');
    const selected = variations[selectedIndex];

    // Push undo checkpoint BEFORE modifying draft
    if (typeof pushHistory === "function") pushHistory();

    // Preserve original if not already preserved
    const preservedOriginal = originalUri || localUri;

    // Build enhancement metadata
    const meta: EnhancementMeta = {
      provider: getEnhancementService().getProviderName(),
      model: 'codeformer+sdxl',
      strength: 0, // adaptive, stored for analytics
      variationIndex: selectedIndex,
      generatedAt: new Date().toISOString(),
      faceBox: { x: 0, y: 0, w: 0, h: 0 }, // populated from analysis in future
      tone: selected.tone,
    };

    // Update draft: localUri becomes enhanced, original preserved
    updateDraft({
      localUri: selected.localUri,
      originalUri: preservedOriginal,
      enhancedUri: selected.localUri,
      enhancementMeta: meta,
    });

    // Clean unselected variations (selected stays until upload completes)
    const unselectedUris = variationUrisRef.current.filter(u => u !== selected.localUri);
    if (unselectedUris.length > 0) {
      deleteCachedFiles(unselectedUris).catch(() => {});
    }
    variationUrisRef.current = [selected.localUri];

    if (mountedRef.current) {
      setEnhancerOpen(false);
      setVariations([]);
      setSelectedIndex(0);
      setStateSafe('idle');
    }
  }, [variations, selectedIndex, localUri, originalUri, pushHistory, updateDraft]);

  // â”€â”€ Discard all variations â”€â”€

  const discardVariations = useCallback(() => {
    if (variationUrisRef.current.length > 0) {
      deleteCachedFiles(variationUrisRef.current).catch(() => {});
      variationUrisRef.current = [];
    }

    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
    setStateSafe('idle');
  }, []);

  // â”€â”€ Retry after failure â”€â”€

  const retryGeneration = useCallback(() => {
    setFailureMessage(null);
    setStateSafe('idle');
  }, []);

  // â”€â”€ Training wizard controls â”€â”€

  const openTrainingWizard = useCallback(() => {
    closeBloom();
    setTrainingWizardOpen(true);
  }, [closeBloom]);

  const closeTrainingWizard = useCallback(() => {
    setTrainingWizardOpen(false);
  }, []);

  const onTrainingComplete = useCallback(() => {
    setTrainingWizardOpen(false);
    // Identity is now ready. Open enhancer for immediate use.
    setEnhancerOpen(true);
    setStateSafe('idle');
    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
    setFaceDetected(true);
    setMultipleFaces(false);
  }, []);

  const onTrainingSkip = useCallback(() => {
    setTrainingWizardOpen(false);
    // Open enhancer with Quick Enhance fallback
    setEnhancerOpen(true);
    setStateSafe('idle');
    setVariations([]);
    setSelectedIndex(0);
    setFailureMessage(null);
    setFaceDetected(true);
    setMultipleFaces(false);
  }, []);

  return {
    enhancerOpen,
    trainingWizardOpen,
    state,
    variations,
    selectedIndex,
    failureMessage,
    faceDetected,
    multipleFaces,
    selectedReferenceUrl,
    setSelectedReferenceUrl,
    stableOriginalUri: stableOriginalUri.current,
    enhancementIntensity,
    setEnhancementIntensity,

    openEnhancer,
    closeEnhancer,
    openTrainingWizard,
    closeTrainingWizard,
    onTrainingComplete,
    onTrainingSkip,
    generateEnhancements,
    cancelGeneration,
    selectVariation,
    applyVariation,
    discardVariations,
    retryGeneration,
  };
}





