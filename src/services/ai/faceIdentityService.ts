/**
 * faceIdentityService.ts
 *
 * Identity persistence layer. Manages reference photos that define
 * who the user looks like at their best.
 *
 * Phase 1 architecture: NO LoRA training. NO custom models.
 * Photos are stored as references. Identity becomes "ready" immediately
 * after upload. At enhancement time, best references are retrieved
 * and sent to InstantID/IP-Adapter for identity-conditioned reconstruction.
 *
 * Owns:
 *   - Reference photo upload to Supabase storage
 *   - Photo metadata persistence (identity_training_photos table)
 *   - Identity status management (user_identity_models table)
 *   - Reference photo retrieval (signed URLs for inference)
 *   - Identity deletion
 *
 * Does NOT own:
 *   - Face detection (enhancementAnalyzer)
 *   - Reconstruction inference (identityReconstructionService)
 *   - Reference selection/ranking (future referenceSelectionService)
 *   - UI/modals (controller layer)
 */

import { supabase } from '../supabase';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ──

export type IdentityStatus = 'uploading' | 'ready' | 'failed';

export interface IdentityModel {
  id: string;
  userId: string;
  status: IdentityStatus;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  identityMeta: Record<string, any>;
}

export interface TrainingPhoto {
  id: string;
  userId: string;
  storagePath: string;
  qualityScore: number;
  poseYaw: number;
  posePitch: number;
  poseRoll: number;
  lightingType: string;
  expressionType: string;
  isPrimaryReference: boolean;
  faceWidthRatio: number;
  sharpnessScore: number;
  exposureScore: number;
  createdAt: string;
}

export interface TrainingProgress {
  step: string;
  percent: number;
  status: 'uploading' | 'completed' | 'failed';
}

export type TrainingProgressCallback = (progress: TrainingProgress) => void;

// ── Constants ──

const TRAINING_BUCKET = 'identity-training-photos';
const MIN_PHOTOS = 8;
const MAX_PHOTOS = 20;

// ── Service ──

class FaceIdentityServiceClass {

  // ════════════════════════════════════════════
  // IDENTITY LOOKUP
  // ════════════════════════════════════════════

  /**
   * Check if user has an identity (reference photos uploaded).
   * Returns the identity record if ready, null if not set up.
   */
  async getIdentity(userId: string): Promise<IdentityModel | null> {
    const { data, error } = await supabase
      .from('user_identity_models')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return this.mapModelRow(data);
  }

  /**
   * Check if identity is ready for reconstruction.
   */
  async hasReadyIdentity(userId: string): Promise<boolean> {
    const model = await this.getIdentity(userId);
    return model !== null && model.status === 'ready';
  }

  // ════════════════════════════════════════════
  // REFERENCE PHOTO MANAGEMENT
  // ════════════════════════════════════════════

  /**
   * Upload reference photos and mark identity as ready.
   *
   * Flow:
   *   1. Upload each photo to Supabase storage
   *   2. Persist metadata per photo
   *   3. Create/update identity record with status "ready"
   *   4. Identity is immediately usable (no training wait)
   */
  async uploadReferencePhotos(
    userId: string,
    photoUris: string[],
    onProgress?: TrainingProgressCallback
  ): Promise<number> {
    let uploaded = 0;

    for (let i = 0; i < photoUris.length; i++) {
      const uri = photoUris[i];
      const progressPercent = Math.round(((i + 1) / photoUris.length) * 100);

      onProgress?.({
        step: `Curating photo ${i + 1} of ${photoUris.length}...`,
        percent: progressPercent,
        status: 'uploading',
      });

      try {
        const storagePath = await this.uploadSinglePhoto(userId, uri);
        await this.persistPhotoMetadata(userId, storagePath);
        uploaded++;
      } catch (err) {
        console.warn(`[Identity] Failed to upload photo ${i + 1}:`, err);
        // Continue with remaining photos
      }
    }

    if (uploaded >= MIN_PHOTOS) {
      // Mark identity as ready immediately (no training needed)
      await this.createOrUpdateIdentity(userId, uploaded);

      onProgress?.({
        step: 'Your identity is ready.',
        percent: 100,
        status: 'completed',
      });
    } else if (uploaded > 0) {
      onProgress?.({
        step: `Only ${uploaded} photos uploaded. Need at least ${MIN_PHOTOS}.`,
        percent: 0,
        status: 'failed',
      });
    } else {
      onProgress?.({
        step: 'Could not upload photos. Please try again.',
        percent: 0,
        status: 'failed',
      });
    }

    return uploaded;
  }

  /**
   * Get all reference photos for a user, ranked by quality.
   */
  async getReferencePhotos(userId: string): Promise<TrainingPhoto[]> {
    const { data, error } = await supabase
      .from('identity_training_photos')
      .select('*')
      .eq('user_id', userId)
      .order('quality_score', { ascending: false });

    if (error || !data) return [];
    return data.map(this.mapPhotoRow);
  }

  /**
   * Get signed URLs for reference photos (needed for inference).
   * Returns top N photos by quality score.
   */
  async getReferencePhotoUrls(userId: string, limit: number = 5): Promise<string[]> {
    const photos = await this.getReferencePhotos(userId);
    const topPhotos = photos.slice(0, limit);
    const urls: string[] = [];

    for (const photo of topPhotos) {
      const { data } = await supabase.storage
        .from(TRAINING_BUCKET)
        .createSignedUrl(photo.storagePath, 3600); // 1 hour expiry

      if (data?.signedUrl) {
        urls.push(data.signedUrl);
      }
    }

    return urls;
  }

  /**
   * Delete all reference photos for a user.
   */
  async deleteReferencePhotos(userId: string): Promise<void> {
    const photos = await this.getReferencePhotos(userId);
    const paths = photos.map(p => p.storagePath);

    if (paths.length > 0) {
      await supabase.storage.from(TRAINING_BUCKET).remove(paths);
    }

    await supabase
      .from('identity_training_photos')
      .delete()
      .eq('user_id', userId);
  }

  // ════════════════════════════════════════════
  // IDENTITY DELETION
  // ════════════════════════════════════════════

  /**
   * Delete user's entire identity: model record, photos, history.
   */
  async deleteIdentity(userId: string): Promise<void> {
    await this.deleteReferencePhotos(userId);

    await supabase
      .from('enhancement_history')
      .delete()
      .eq('user_id', userId);

    await supabase
      .from('user_identity_models')
      .delete()
      .eq('user_id', userId);
  }

  // ════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════

  /**
   * Upload a single photo to Supabase storage.
   * Uses fetch -> blob (no base64, no atob, works on all RN runtimes).
   */
  private async uploadSinglePhoto(userId: string, localUri: string): Promise<string> {
    const ext = localUri.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

    let readUri = localUri;

    // Handle non-file URIs (camera roll ph://)
    if (!localUri.startsWith('file://') && !localUri.startsWith('/')) {
      const tempPath = FileSystem.cacheDirectory + `identity_upload_${Date.now()}.${ext}`;
      await FileSystem.copyAsync({ from: localUri, to: tempPath });
      readUri = tempPath;
    }

    // Read file as base64 via FileSystem (proven working on iOS)
    const base64 = await FileSystem.readAsStringAsync(readUri, {
      encoding: 'base64',
    });

    // Clean temp copy
    if (readUri !== localUri) {
      FileSystem.deleteAsync(readUri, { idempotent: true }).catch(() => {});
    }

    // Convert base64 to Uint8Array for upload
    const byteArray = this.base64ToBytes(base64);
    console.log(`[Identity] Photo base64 length: ${base64.length}, bytes: ${byteArray.length}`);

    if (byteArray.length === 0) {
      throw new Error('Image read returned empty data');
    }

    // Upload to Supabase storage
    const { error } = await supabase.storage
      .from(TRAINING_BUCKET)
      .upload(fileName, byteArray, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return fileName;
  }

  /**
   * Pure JS base64 decoder. No atob dependency.
   */
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

  /**
   * Persist photo metadata in identity_training_photos table.
   */
  private async persistPhotoMetadata(userId: string, storagePath: string): Promise<void> {
    await supabase.from('identity_training_photos').insert({
      user_id: userId,
      storage_path: storagePath,
      quality_score: 0.7, // Phase 1: default. Phase 2: real scoring.
      pose_yaw: 0,
      pose_pitch: 0,
      pose_roll: 0,
      lighting_type: 'unknown',
      expression_type: 'unknown',
      is_primary_reference: false,
      face_width_ratio: 0,
      sharpness_score: 0,
      exposure_score: 0,
    });
  }

  /**
   * Create or update identity record. Status is immediately "ready"
   * since Phase 1 uses reference-image guidance, not model training.
   */
  private async createOrUpdateIdentity(userId: string, photoCount: number): Promise<void> {
    await supabase
      .from('user_identity_models')
      .upsert({
        user_id: userId,
        replicate_model_id: 'reference-image-identity',
        replicate_version: null,
        status: 'ready',
        photo_count: photoCount,
        trained_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        identity_meta: {
          type: 'reference-guided',
          min_photos: MIN_PHOTOS,
          inference_model: 'instantid',
        },
      }, { onConflict: 'user_id' });
  }

  /**
   * Map a Supabase row to IdentityModel.
   */
  private mapModelRow(row: any): IdentityModel {
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      photoCount: row.photo_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      identityMeta: row.identity_meta || {},
    };
  }

  /**
   * Map a Supabase row to TrainingPhoto.
   */
  private mapPhotoRow(row: any): TrainingPhoto {
    return {
      id: row.id,
      userId: row.user_id,
      storagePath: row.storage_path,
      qualityScore: row.quality_score,
      poseYaw: row.pose_yaw,
      posePitch: row.pose_pitch,
      poseRoll: row.pose_roll,
      lightingType: row.lighting_type,
      expressionType: row.expression_type,
      isPrimaryReference: row.is_primary_reference,
      faceWidthRatio: row.face_width_ratio,
      sharpnessScore: row.sharpness_score,
      exposureScore: row.exposure_score,
      createdAt: row.created_at,
    };
  }
}

// ── Singleton ──

let _instance: FaceIdentityServiceClass | null = null;

export function getFaceIdentityService(): FaceIdentityServiceClass {
  if (!_instance) {
    _instance = new FaceIdentityServiceClass();
  }
  return _instance;
}
