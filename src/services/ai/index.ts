/**
 * AI Services barrel export.
 *
 * Five layers:
 *   1. faceIdentityService           - identity training, persistence, lookup
 *   2. identityReconstructionService - identity-conditioned face reconstruction
 *   3. enhancementAnalyzer           - on-device face detection + quality analysis
 *   4. enhancementService            - provider-agnostic cloud inference (Quick Enhance)
 *   5. enhancementCacheService       - temp file lifecycle
 */

export { getFaceIdentityService } from './faceIdentityService';
export type {
  IdentityModel,
  IdentityStatus,
  TrainingPhoto,
  TrainingProgress,
  TrainingProgressCallback,
} from './faceIdentityService';

export { getIdentityReconstructionService, detectWeakness } from './identityReconstructionService';
export type {
  WeaknessType,
  WeaknessMap,
  ReconstructionInput,
  ReconstructionCandidate,
  ReconstructionResult,
} from './identityReconstructionService';

export { getRealismVerificationService } from './realismVerificationService';
export type {
  VerificationScores,
  VerifiedCandidate,
  VerificationResult,
} from './realismVerificationService';

export { analyzeFace, getImageDimensions } from './enhancementAnalyzer';
export type { AnalysisResult } from './enhancementAnalyzer';

export { getEnhancementService, EnhancementService } from './enhancementService';
export type {
  FaceRegion,
  QualityAnalysis,
  VariationTone,
  EnhancementInput,
  VariationResult,
  EnhancementResult,
  EnhancementProvider,
} from './enhancementService';

export {
  cacheVariation,
  deleteCachedFile,
  deleteCachedFiles,
  cleanDraftCache,
  sweepOrphanedFiles,
  getCacheSize,
  enforceQuota,
} from './enhancementCacheService';
