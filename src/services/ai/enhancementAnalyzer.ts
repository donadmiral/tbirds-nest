/**
 * enhancementAnalyzer.ts
 *
 * On-device face detection and quality analysis.
 * Runs entirely on device. Zero cost. Sub-200ms.
 *
 * Owns: face detection, landmark extraction, quality scoring, enhancement routing.
 * Does NOT own: cloud inference, caching, draft state, UI.
 *
 * This is the intelligence layer. It decides HOW the enhancement should behave
 * based on what's actually wrong with the photo.
 *
 * Quality scores drive adaptive strength and prompt selection in enhancementService.
 *
 * Graceful fallback: if expo-face-detector native module is not available
 * (e.g. running in Expo Go instead of dev build), returns a synthetic
 * "face detected" result with neutral quality scores so enhancement
 * can still proceed without face-specific routing.
 */

let FaceDetector: any = null;
try {
  FaceDetector = require('expo-face-detector');
} catch {
  // Native module not available (Expo Go or missing native build)
}

import { Image } from 'react-native';
import type { FaceRegion, QualityAnalysis } from './enhancementService';

export interface AnalysisResult {
  faceDetected: boolean;
  faceRegion: FaceRegion | null;
  quality: QualityAnalysis | null;
  multiplefaces: boolean;
  faceCount: number;
}

let _fallbackWarned = false;

/**
 * Detect faces and analyze quality for enhancement routing.
 *
 * Returns the primary face (largest, most centered) with quality scores.
 * Quality scores are derived from expo-face-detector classifications
 * and landmark geometry.
 *
 * If face detector is unavailable, returns a fallback result that
 * assumes a face is present with neutral quality, so the enhancement
 * flow continues without blocking.
 */
export async function analyzeFace(imageUri: string): Promise<AnalysisResult> {
  const empty: AnalysisResult = {
    faceDetected: false,
    faceRegion: null,
    quality: null,
    multiplefaces: false,
    faceCount: 0,
  };

  // Fallback when native module is not available
  if (!FaceDetector || !FaceDetector.detectFacesAsync) {
    if (!_fallbackWarned) {
      console.log('[EnhancementAnalyzer] expo-face-detector not available, using fallback (this message shows once)');
      _fallbackWarned = true;
    }
    return getFallbackResult(imageUri);
  }

  try {
    const detection = await FaceDetector.detectFacesAsync(imageUri, {
      mode: FaceDetector.FaceDetectorMode.accurate,
      detectLandmarks: FaceDetector.FaceDetectorLandmarks.all,
      runClassifications: FaceDetector.FaceDetectorClassifications.all,
    });

    if (!detection.faces || detection.faces.length === 0) {
      return empty;
    }

    // Select primary face: largest bounding box area
    const sorted = [...detection.faces].sort((a, b) => {
      const areaA = (a.bounds?.width || 0) * (a.bounds?.height || 0);
      const areaB = (b.bounds?.width || 0) * (b.bounds?.height || 0);
      return areaB - areaA;
    });

    const primary = sorted[0];
    const bounds = primary.bounds;

    if (!bounds || bounds.width < 20 || bounds.height < 20) {
      return empty;
    }

    // Extract landmarks
    const faceRegion: FaceRegion = {
      x: bounds.origin?.x ?? bounds.x ?? 0,
      y: bounds.origin?.y ?? bounds.y ?? 0,
      width: bounds.width,
      height: bounds.height,
      landmarks: {
        leftEye: primary.leftEyePosition || null,
        rightEye: primary.rightEyePosition || null,
        nose: primary.noseBasePosition || null,
        leftMouth: primary.leftMouthPosition || null,
        rightMouth: primary.rightMouthPosition || null,
      },
    };

    // Compute quality scores from available classifications
    const quality = computeQuality(primary, faceRegion);

    return {
      faceDetected: true,
      faceRegion,
      quality,
      multiplefaces: detection.faces.length > 1,
      faceCount: detection.faces.length,
    };
  } catch (err) {
    console.error('[EnhancementAnalyzer] Face detection failed:', err);
    return empty;
  }
}

/**
 * Compute quality scores from face detector output.
 *
 * expo-face-detector provides:
 *   - smilingProbability (0-1)
 *   - leftEyeOpenProbability (0-1)
 *   - rightEyeOpenProbability (0-1)
 *   - rollAngle, yawAngle
 *
 * We derive remaining scores from geometry and heuristics.
 */
function computeQuality(face: any, region: FaceRegion): QualityAnalysis {
  // Eye openness: average of both eyes
  const leftEyeOpen = face.leftEyeOpenProbability ?? 0.8;
  const rightEyeOpen = face.rightEyeOpenProbability ?? 0.8;
  const eyeOpenness = (leftEyeOpen + rightEyeOpen) / 2;

  // Face angle from frontal (yaw is horizontal rotation)
  const yaw = Math.abs(face.yawAngle ?? 0);
  const roll = Math.abs(face.rollAngle ?? 0);
  const faceAngle = Math.max(yaw, roll);

  // Expression confidence: smile probability as proxy
  // Low smile probability with high eye openness = neutral but clear expression
  // Low everything = unclear expression
  const smileProb = face.smilingProbability ?? 0.5;
  const expressionConf = Math.min(1, (eyeOpenness * 0.6) + (smileProb * 0.4));

  // Blur score: estimated from face size relative to image
  // Larger face region = likely sharper capture
  // This is a rough heuristic; real blur detection needs pixel analysis
  const faceAreaRatio = (region.width * region.height) / (1000 * 1000); // normalize
  const blurScore = Math.min(1, Math.max(0.2, faceAreaRatio * 5));

  // Exposure and lighting: not available from face detector alone
  // Default to neutral. Phase 2 can add pixel-level analysis.
  const exposureScore = 0;
  const lightingQuality = 0.6; // assume acceptable until we add real analysis

  return {
    eyeOpenness,
    blurScore,
    exposureScore,
    faceAngle,
    expressionConf,
    lightingQuality,
  };
}

/**
 * Get image dimensions for face region normalization.
 */
export function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err || new Error('Failed to get image dimensions'))
    );
  });
}

/**
 * Fallback result when expo-face-detector native module is unavailable.
 * Assumes a face is present with neutral quality scores so the
 * enhancement pipeline can proceed. The cloud model handles
 * actual face detection internally.
 */
async function getFallbackResult(imageUri: string): Promise<AnalysisResult> {
  try {
    const dims = await getImageDimensions(imageUri);
    // Estimate face region as center 40% of image
    const fw = dims.width * 0.4;
    const fh = dims.height * 0.4;
    return {
      faceDetected: true,
      faceRegion: {
        x: (dims.width - fw) / 2,
        y: (dims.height - fh) / 2.5, // slightly above center (typical face position)
        width: fw,
        height: fh,
        landmarks: {
          leftEye: null,
          rightEye: null,
          nose: null,
          leftMouth: null,
          rightMouth: null,
        },
      },
      quality: {
        eyeOpenness: 0.7,
        blurScore: 0.6,
        exposureScore: 0,
        faceAngle: 0,
        expressionConf: 0.6,
        lightingQuality: 0.6,
      },
      multiplefaces: false,
      faceCount: 1,
    };
  } catch {
    return {
      faceDetected: true,
      faceRegion: {
        x: 100, y: 100, width: 200, height: 250,
        landmarks: { leftEye: null, rightEye: null, nose: null, leftMouth: null, rightMouth: null },
      },
      quality: {
        eyeOpenness: 0.7, blurScore: 0.6, exposureScore: 0,
        faceAngle: 0, expressionConf: 0.6, lightingQuality: 0.6,
      },
      multiplefaces: false,
      faceCount: 1,
    };
  }
}
