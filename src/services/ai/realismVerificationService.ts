/**
 * realismVerificationService.ts
 *
 * The quality gate. Every reconstruction candidate must pass through here
 * before the user sees it. Bad generations are automatically discarded.
 *
 * Owns:
 *   - Identity similarity scoring
 *   - Geometric alignment verification
 *   - Lighting consistency estimation
 *   - Skin tone coherence checking
 *   - Uncanny valley heuristic detection
 *   - Composite realism scoring
 *   - Candidate ranking
 *   - Rejection thresholding
 *
 * Does NOT own:
 *   - Candidate generation (identityReconstructionService)
 *   - Identity training (faceIdentityService)
 *   - Face detection (enhancementAnalyzer)
 *   - UI/caching/draft state
 *
 * Philosophy: the verifier is MORE important than the generator.
 *   The generator creates possibilities.
 *   The verifier chooses truth.
 *
 * Phase 1: heuristic scoring from image metadata and face detection.
 * Phase 2: cloud-based InsightFace embedding comparison for mathematical
 *          identity verification.
 */

import type { FaceRegion, QualityAnalysis } from './enhancementService';
import type { ReconstructionCandidate } from './identityReconstructionService';

// ── Types ──

export interface VerificationScores {
  identity: number;         // 0-1, how much this looks like the same person
  geometry: number;         // 0-1, face landmark alignment with original
  lighting: number;         // 0-1, lighting consistency with background
  skinTone: number;         // 0-1, skin color coherence with body
  eyeRealism: number;       // 0-1, natural-looking eyes
  uncanny: number;          // 0-1, 1 = natural, 0 = obviously fake
  composite: number;        // weighted sum of all scores
}

export interface VerifiedCandidate {
  url: string;
  tone: string;
  strength: number;
  weakness: string;
  promptUsed: string;
  scores: VerificationScores;
  rank: number;             // 1 = best
  passed: boolean;          // did it pass all thresholds?
  rejectionReason: string | null;
}

export interface VerificationResult {
  verified: VerifiedCandidate[];   // passed candidates, ranked best-first
  rejected: VerifiedCandidate[];   // failed candidates with reasons
  totalCandidates: number;
  passedCount: number;
  rejectedCount: number;
  bestCompositeScore: number;
}

// ── Thresholds ──
// A candidate must pass ALL individual thresholds AND the composite minimum.
// These are intentionally strict. It's better to show fewer good results
// than to show a bad AI face.

const THRESHOLDS = {
  identity: 0.60,           // Phase 1: relaxed (no embedding yet). Phase 2: 0.75
  geometry: 0.55,           // landmark displacement tolerance
  lighting: 0.50,           // lighting direction consistency
  skinTone: 0.50,           // skin color coherence
  eyeRealism: 0.55,         // iris/pupil naturalness
  uncanny: 0.50,            // overall naturalness
  composite: 0.58,          // weighted overall minimum
};

// ── Weights for composite score ──

const WEIGHTS = {
  identity: 0.30,
  geometry: 0.20,
  lighting: 0.15,
  skinTone: 0.10,
  eyeRealism: 0.15,
  uncanny: 0.10,
};

// ── Maximum candidates to return ──

const MAX_VERIFIED = 4;

// ── Verification Service ──

class RealismVerificationServiceClass {

  /**
   * Verify all reconstruction candidates.
   *
   * Scores each candidate on 6 dimensions.
   * Rejects candidates below thresholds.
   * Ranks remaining by composite score.
   * Returns top 4.
   */
  async verify(
    candidates: ReconstructionCandidate[],
    originalFace: FaceRegion,
    originalQuality: QualityAnalysis,
    originalImageBase64: string | null,
  ): Promise<VerificationResult> {
    const scored: VerifiedCandidate[] = [];

    for (const candidate of candidates) {
      const scores = await this.scoreCandidate(
        candidate,
        originalFace,
        originalQuality,
        originalImageBase64
      );

      // Check individual thresholds
      let rejectionReason: string | null = null;
      if (scores.identity < THRESHOLDS.identity) {
        rejectionReason = 'identity_mismatch';
      } else if (scores.geometry < THRESHOLDS.geometry) {
        rejectionReason = 'geometry_distortion';
      } else if (scores.lighting < THRESHOLDS.lighting) {
        rejectionReason = 'lighting_inconsistent';
      } else if (scores.skinTone < THRESHOLDS.skinTone) {
        rejectionReason = 'skin_tone_mismatch';
      } else if (scores.eyeRealism < THRESHOLDS.eyeRealism) {
        rejectionReason = 'unrealistic_eyes';
      } else if (scores.uncanny < THRESHOLDS.uncanny) {
        rejectionReason = 'uncanny_valley';
      } else if (scores.composite < THRESHOLDS.composite) {
        rejectionReason = 'low_composite_score';
      }

      scored.push({
        url: candidate.url,
        tone: candidate.tone,
        strength: candidate.strength,
        weakness: candidate.weakness,
        promptUsed: candidate.promptUsed,
        scores,
        rank: 0,
        passed: rejectionReason === null,
        rejectionReason,
      });
    }

    // Separate passed and rejected
    const passed = scored.filter(c => c.passed);
    const rejected = scored.filter(c => !c.passed);

    // Rank passed candidates by composite score (highest first)
    passed.sort((a, b) => b.scores.composite - a.scores.composite);

    // Assign ranks
    passed.forEach((c, i) => { c.rank = i + 1; });
    rejected.forEach((c, i) => { c.rank = passed.length + i + 1; });

    // Take top MAX_VERIFIED
    const verified = passed.slice(0, MAX_VERIFIED);

    // Ensure tone variety in results (prefer one per tone if possible)
    const diversified = this.ensureToneVariety(verified, passed);

    return {
      verified: diversified,
      rejected,
      totalCandidates: candidates.length,
      passedCount: passed.length,
      rejectedCount: rejected.length,
      bestCompositeScore: diversified.length > 0 ? diversified[0].scores.composite : 0,
    };
  }

  /**
   * Score a single candidate across all 6 dimensions.
   *
   * Phase 1: heuristic scoring based on reconstruction parameters.
   * Phase 2: actual image analysis with InsightFace embeddings,
   *          pixel-level comparison, and learned classifiers.
   */
  private async scoreCandidate(
    candidate: ReconstructionCandidate,
    originalFace: FaceRegion,
    originalQuality: QualityAnalysis,
    _originalImageBase64: string | null,
  ): Promise<VerificationScores> {

    // ── Identity similarity ──
    // Phase 1: estimate from reconstruction strength.
    // Lower strength = more identity preservation = higher score.
    // Phase 2: InsightFace cosine similarity between original and candidate.
    const identity = this.scoreIdentity(candidate.strength);

    // ── Geometric alignment ──
    // Phase 1: estimate from face region stability.
    // If face region is large and centered, geometry is likely preserved.
    // Phase 2: landmark comparison between original and candidate.
    const geometry = this.scoreGeometry(originalFace, candidate.strength);

    // ── Lighting consistency ──
    // Phase 1: estimate from original lighting quality and reconstruction tone.
    // If original had good lighting and candidate matches, score high.
    // Phase 2: luminance histogram comparison.
    const lighting = this.scoreLighting(originalQuality, candidate.tone);

    // ── Skin tone coherence ──
    // Phase 1: estimate from exposure quality.
    // Phase 2: face vs neck/body color delta-E comparison.
    const skinTone = this.scoreSkinTone(originalQuality, candidate.strength);

    // ── Eye realism ──
    // Phase 1: boost score when weakness was specifically eyes
    // (targeted fix = better eye result).
    // Phase 2: iris shape regularity, specular highlight, pupil symmetry.
    const eyeRealism = this.scoreEyeRealism(
      originalQuality.eyeOpenness,
      candidate.weakness,
      candidate.strength
    );

    // ── Uncanny valley ──
    // Phase 1: composite heuristic from strength and quality scores.
    // Phase 2: trained uncanny valley classifier.
    const uncanny = this.scoreUncanny(candidate.strength, originalQuality);

    // ── Composite ──
    const composite =
      identity * WEIGHTS.identity +
      geometry * WEIGHTS.geometry +
      lighting * WEIGHTS.lighting +
      skinTone * WEIGHTS.skinTone +
      eyeRealism * WEIGHTS.eyeRealism +
      uncanny * WEIGHTS.uncanny;

    return { identity, geometry, lighting, skinTone, eyeRealism, uncanny, composite };
  }

  // ── Individual scoring functions ──

  /**
   * Identity: lower reconstruction strength = higher identity preservation.
   * Strength 0.15 (minimal) → score ~0.95
   * Strength 0.55 (maximum) → score ~0.65
   */
  private scoreIdentity(strength: number): number {
    return Math.max(0.5, 1.0 - strength * 0.7);
  }

  /**
   * Geometry: larger, centered faces are more likely to maintain alignment.
   * Lower strength also means less geometric drift.
   */
  private scoreGeometry(face: FaceRegion, strength: number): number {
    const faceArea = face.width * face.height;
    const areaScore = Math.min(1, faceArea / 40000); // normalize
    const strengthPenalty = strength * 0.3;
    return Math.max(0.4, areaScore * 0.6 + 0.5 - strengthPenalty);
  }

  /**
   * Lighting: if original had good lighting, result likely consistent.
   * Matching tones (natural with natural light) score higher.
   */
  private scoreLighting(quality: QualityAnalysis, tone: string): number {
    let base = 0.5 + quality.lightingQuality * 0.3;

    // Tone-lighting compatibility bonus
    if (quality.lightingQuality > 0.6 && tone === 'Natural') base += 0.1;
    if (quality.lightingQuality < 0.4 && tone === 'Evening') base += 0.05;

    return Math.min(1, Math.max(0.3, base));
  }

  /**
   * Skin tone: well-exposed originals produce better skin matches.
   * High strength increases risk of skin tone drift.
   */
  private scoreSkinTone(quality: QualityAnalysis, strength: number): number {
    const exposureQuality = 1 - Math.abs(quality.exposureScore);
    const strengthPenalty = strength * 0.2;
    return Math.max(0.4, exposureQuality * 0.4 + 0.5 - strengthPenalty);
  }

  /**
   * Eye realism: targeted eye fixes produce better eye results.
   * Generic full-face reconstruction has more eye risk.
   */
  private scoreEyeRealism(
    originalEyeOpenness: number,
    weakness: string,
    strength: number
  ): number {
    let base = 0.65;

    // If eyes were specifically targeted, the fix is more precise
    if (weakness === 'eyes_closed' || weakness === 'eyes_half') {
      base = 0.75;
    }

    // If original eyes were already good, less risk
    if (originalEyeOpenness > 0.7) base += 0.1;

    // Higher strength = more risk of fake eyes
    base -= strength * 0.15;

    return Math.min(1, Math.max(0.4, base));
  }

  /**
   * Uncanny valley: composite heuristic.
   * Lower strength = more natural.
   * Better original quality = less AI needed = more natural result.
   */
  private scoreUncanny(strength: number, quality: QualityAnalysis): number {
    const qualityAvg = (
      quality.eyeOpenness +
      quality.blurScore +
      quality.expressionConf +
      quality.lightingQuality
    ) / 4;

    // Higher original quality + lower strength = more natural
    const base = 0.5 + qualityAvg * 0.25 - strength * 0.3;

    return Math.min(1, Math.max(0.3, base));
  }

  // ── Tone variety ──

  /**
   * Ensure the top 4 results include tone variety when possible.
   * Prefer one Natural, one Golden, one Platinum, one Evening.
   * Fall back to best-scored if variety isn't available.
   */
  private ensureToneVariety(
    top: VerifiedCandidate[],
    allPassed: VerifiedCandidate[]
  ): VerifiedCandidate[] {
    if (allPassed.length <= MAX_VERIFIED) return allPassed;

    const desiredTones = ['Natural', 'Golden', 'Platinum', 'Evening'];
    const result: VerifiedCandidate[] = [];
    const used = new Set<string>();

    // First pass: pick best candidate per tone
    for (const tone of desiredTones) {
      const match = allPassed.find(c => c.tone === tone && !used.has(c.url));
      if (match) {
        result.push(match);
        used.add(match.url);
      }
    }

    // Fill remaining slots with best-scored unused candidates
    for (const c of allPassed) {
      if (result.length >= MAX_VERIFIED) break;
      if (!used.has(c.url)) {
        result.push(c);
        used.add(c.url);
      }
    }

    // Re-rank
    result.sort((a, b) => b.scores.composite - a.scores.composite);
    result.forEach((c, i) => { c.rank = i + 1; });

    return result.slice(0, MAX_VERIFIED);
  }
}

// ── Singleton ──

let _instance: RealismVerificationServiceClass | null = null;

export function getRealismVerificationService(): RealismVerificationServiceClass {
  if (!_instance) {
    _instance = new RealismVerificationServiceClass();
  }
  return _instance;
}
