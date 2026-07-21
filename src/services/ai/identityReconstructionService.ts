/**
 * identityReconstructionService.ts
 *
 * Two-pass identity transfer pipeline:
 *
 * Pass 1: Face Swap – DISABLED (generative, poor quality)
 *   Now uses source photo directly.
 *
 * Pass 2: Face Restoration (lucataco/codeformer)
 *   - Harmonizes lighting, skin tone, and blending
 *   - Restores micro-detail (pores, texture, grain)
 *
 * Cost: ~$0.003 per run (CodeFormer only)
 * Speed: ~16 seconds total (4 variations)
 */

import type { FaceRegion, QualityAnalysis } from './enhancementService';
import { supabase } from '../supabase';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ──

export type WeaknessType =
  | 'eyes_closed'
  | 'eyes_half'
  | 'expression_weak'
  | 'blur_face'
  | 'exposure_under'
  | 'exposure_over'
  | 'lighting_poor'
  | 'multiple_issues'
  | 'none';

export interface WeaknessMap {
  primary: WeaknessType;
  all: WeaknessType[];
  severity: number;
  regions: {
    eyes: boolean;
    mouth: boolean;
    fullFace: boolean;
  };
}

export interface ReconstructionInput {
  imageBase64: string;
  sourceFileUri?: string;
  userId?: string;
  faceRegion: FaceRegion;
  quality: QualityAnalysis;
  referencePhotoUrls: string[];
  imageWidth: number;
  imageHeight: number;
  targetFidelity?: number;
}

export interface ReconstructionCandidate {
  url: string;
  tone: string;
  strength: number;
  weakness: WeaknessType;
  promptUsed: string;
}

export interface ReconstructionResult {
  candidates: ReconstructionCandidate[];
  weakness: WeaknessMap;
  provider: string;
  model: string;
  latencyMs: number;
}

// ── Constants ──

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const MAX_POLL_SECONDS = 90;
const DELAY_BETWEEN_CALLS_MS = 2000;

const VARIATIONS = [
  { id: 'enhanced', label: 'Enhanced', fidelity: 0.5 },
];

// ── Weakness Detection ──

export function detectWeakness(quality: QualityAnalysis): WeaknessMap {
  const weaknesses: WeaknessType[] = [];
  const regions = { eyes: false, mouth: false, fullFace: false };

  if (quality.eyeOpenness < 0.3) {
    weaknesses.push('eyes_closed');
    regions.eyes = true;
  } else if (quality.eyeOpenness < 0.55) {
    weaknesses.push('eyes_half');
    regions.eyes = true;
  }
  if (quality.expressionConf < 0.4) {
    weaknesses.push('expression_weak');
    regions.mouth = true;
  }
  if (quality.blurScore < 0.35) {
    weaknesses.push('blur_face');
    regions.fullFace = true;
  }
  if (quality.exposureScore < -0.35) {
    weaknesses.push('exposure_under');
    regions.fullFace = true;
  } else if (quality.exposureScore > 0.35) {
    weaknesses.push('exposure_over');
    regions.fullFace = true;
  }
  if (quality.lightingQuality < 0.35) {
    weaknesses.push('lighting_poor');
    regions.fullFace = true;
  }

  let primary: WeaknessType = 'none';
  if (weaknesses.length === 0) primary = 'none';
  else if (weaknesses.length === 1) primary = weaknesses[0];
  else primary = 'multiple_issues';

  let severity = 0;
  if (regions.fullFace) severity = 0.7;
  else if (regions.eyes && regions.mouth) severity = 0.5;
  else if (regions.eyes) severity = 0.35;
  else if (regions.mouth) severity = 0.3;
  severity = Math.min(1, severity + (1 - quality.blurScore) * 0.1 + (1 - quality.eyeOpenness) * 0.1);

  return { primary, all: weaknesses, severity, regions };
}

// ── Reconstruction Service ──

function computeFidelities(center: number): Array<{ id: string; label: string; fidelity: number }> {
  const min = Math.max(0.2, +(center - 0.15).toFixed(2));
  const max = Math.min(0.8, +(center + 0.15).toFixed(2));
  const clamped = Math.max(0.2, Math.min(0.8, center));
  return [
    { id: 'less', label: 'Subtle', fidelity: max },
    { id: 'target', label: 'Balanced', fidelity: +clamped.toFixed(2) },
    { id: 'more', label: 'Enhanced', fidelity: min },
  ];
}

class IdentityReconstructionServiceClass {
  private get token(): string | null {
    return process.env.EXPO_PUBLIC_REPLICATE_API_TOKEN || null;
  }

  async reconstruct(input: ReconstructionInput): Promise<ReconstructionResult> {
    console.log('[Reconstruction] CodeFormer‑only pipeline started');
    console.log('[Reconstruction] userId:', input.userId || 'none');
    console.log('[Reconstruction] refs:', input.referencePhotoUrls.length);

    if (!this.token) throw new Error('Replicate API token not configured');
    if (!input.referencePhotoUrls || input.referencePhotoUrls.length === 0) {
      throw new Error('No reference photos. Select your best photo first.');
    }

    const start = Date.now();
    const weakness = detectWeakness(input.quality);
    const userId = input.userId || 'anon';
    const referenceUrl = input.referencePhotoUrls[0];

    // Normalize orientation then upload
    console.log('[Reconstruction] Normalizing orientation...');
    let normalizedBase64 = input.imageBase64;
    let normalizedUri: string | null = null;
    try {
      if (input.sourceFileUri) {
        normalizedUri = await this.normalizeOrientation(input.sourceFileUri);
        normalizedBase64 = await FileSystem.readAsStringAsync(normalizedUri, { encoding: 'base64' });
        console.log('[Reconstruction] Normalized base64 length:', normalizedBase64.length);
      }
    } catch (normErr: any) {
      console.warn('[Reconstruction] Normalization failed, using original:', normErr?.message);
    }

    console.log('[Reconstruction] Uploading source photo...');
    let sourceUrl: string;
    try {
      sourceUrl = await this.uploadSource(normalizedBase64, userId);
      console.log('[Reconstruction] Source URL obtained');
    } catch (err: any) {
      console.error('[Reconstruction] Upload failed:', err?.message);
      throw new Error('Failed to prepare photo.');
    } finally {
      if (normalizedUri && normalizedUri !== input.sourceFileUri) {
        FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(() => {});
      }
    }

    // PASS 1: Face swap – DISABLED (generative, poor quality)
    console.log('[Reconstruction] Skipping generative face swap, using source directly');
    const swappedUrl = sourceUrl;   // Direct pass‑through

    // PASS 2: CodeFormer harmonization
    console.log('[Reconstruction] Pass 2: CodeFormer harmonization...');
    const candidates: ReconstructionCandidate[] = [];

    for (let i = 0; i < VARIATIONS.length; i++) {
      const v = VARIATIONS[i];
      // Single result, no delay needed

      try {
        console.log(`[Reconstruction] ${v.id} (fidelity=${v.fidelity})`);
        const outputUrl = await this.runCodeFormer(swappedUrl, v.fidelity);
        candidates.push({
          url: outputUrl,
          tone: v.label,
          strength: v.fidelity,
          weakness: weakness.primary,
          promptUsed: `codeformer_fidelity=${v.fidelity}`,
        });
        console.log(`[Reconstruction] ${v.id} done`);
      } catch (err: any) {
        console.warn(`[Reconstruction] ${v.id} failed:`, err?.message);
        if (err?.message?.includes('429')) {
          console.log('[Reconstruction] Rate limited, waiting 10s...');
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error('Enhancement failed. Your original photo is safe.');
    }

    console.log(`[Reconstruction] ${candidates.length}/${VARIATIONS.length} variations done`);

    return {
      candidates,
      weakness,
      provider: 'replicate',
      model: 'codeformer-only',
      latencyMs: Date.now() - start,
    };
  }

  /**
   * CodeFormer harmonization (only pass – face swap removed)
   */


  private async runCodeFormer(imageUrl: string, fidelity: number): Promise<string> {
    const createRes = await fetch(`${REPLICATE_API_BASE}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '78f2bab438ab0ffc85a68cdfd316a2ecd3994b5dd26aa6b3d203357b45e5eb1b',
        input: {
          image: imageUrl,
          upscale: 1,
          face_upsample: false,
          background_enhance: false,
          codeformer_fidelity: fidelity,
        },
      }),
    });
    if (!createRes.ok) {
      const errBody = await createRes.text();
      throw new Error(`CodeFormer failed: ${createRes.status} ${errBody}`);
    }
    const prediction = await createRes.json();
    return this.pollPrediction(prediction.urls.get);
  }

  private async pollPrediction(pollUrl: string): Promise<string> {
    for (let i = 0; i < MAX_POLL_SECONDS; i++) {
      const res = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
      const data = await res.json();

      if (data.status === 'succeeded') {
        const output = data.output;
        if (typeof output === 'string') return output;
        if (Array.isArray(output) && output.length > 0) return output[0];
        throw new Error('Empty output');
      }
      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(`Prediction ${data.status}: ${data.error || 'unknown'}`);
      }
      if (i > 0 && i % 10 === 0) {
        console.log(`[Reconstruction] Waiting... ${i}s`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Prediction timeout');
  }

  private async normalizeOrientation(sourceFileUri: string): Promise<string> {
    try {
      const result = await manipulateAsync(
        sourceFileUri,
        [],
        { compress: 0.95, format: SaveFormat.JPEG }
      );
      console.log('[Reconstruction] Orientation normalized:', result.width + 'x' + result.height);
      return result.uri;
    } catch (err: any) {
      console.warn('[Reconstruction] Orientation normalization failed:', err?.message);
      return sourceFileUri;
    }
  }

  private async uploadSource(base64: string, userId: string): Promise<string> {
    const fileName = `${userId}/temp/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const byteArray = this.base64ToBytes(base64);
    if (byteArray.length === 0) throw new Error('Empty image data');

    const { error } = await supabase.storage
      .from('identity-training-photos')
      .upload(fileName, byteArray, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);

    const { data } = await supabase.storage
      .from('identity-training-photos')
      .createSignedUrl(fileName, 3600);
    if (!data?.signedUrl) throw new Error('Signed URL failed');

    setTimeout(async () => {
      await supabase.storage.from('identity-training-photos').remove([fileName]);
    }, 600000);

    return data.signedUrl;
  }

  private base64ToBytes(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const len = base64.length;
    let bufLen = Math.floor(len * 3 / 4);
    if (base64[len - 1] === '=') bufLen--;
    if (base64[len - 2] === '=') bufLen--;
    const bytes = new Uint8Array(bufLen);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const e1 = lookup[base64.charCodeAt(i)];
      const e2 = lookup[base64.charCodeAt(i + 1)];
      const e3 = lookup[base64.charCodeAt(i + 2)];
      const e4 = lookup[base64.charCodeAt(i + 3)];
      bytes[p++] = (e1 << 2) | (e2 >> 4);
      if (p < bufLen) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
      if (p < bufLen) bytes[p++] = ((e3 & 3) << 6) | e4;
    }
    return bytes;
  }
}

let _instance: IdentityReconstructionServiceClass | null = null;
export function getIdentityReconstructionService(): IdentityReconstructionServiceClass {
  if (!_instance) _instance = new IdentityReconstructionServiceClass();
  return _instance;
}
