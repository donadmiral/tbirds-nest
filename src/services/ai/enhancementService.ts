/**
 * enhancementService.ts
 *
 * Provider-agnostic cloud inference layer for cinematic memory enhancement.
 *
 * Owns: API communication, polling, retry, provider selection, fallback.
 * Does NOT own: face detection, quality analysis, draft state, UI, caching.
 *
 * Architecture:
 *   - EnhancementProvider interface: any provider implements this
 *   - ReplicateProvider: primary (Phase 1)
 *   - FalProvider: fallback (Phase 1b)
 *   - SelfHostedProvider: future cost optimization
 *   - Provider swap is a config change, zero consumer code changes
 *
 * Environment variables (in .env):
 *   EXPO_PUBLIC_ENHANCEMENT_PROVIDER=replicate
 *   EXPO_PUBLIC_REPLICATE_API_TOKEN=r8_xxxxx
 *   EXPO_PUBLIC_FAL_API_KEY=fal_xxxxx  (optional fallback)
 */

// ── Types ──

export interface FaceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  landmarks: {
    leftEye: { x: number; y: number } | null;
    rightEye: { x: number; y: number } | null;
    nose: { x: number; y: number } | null;
    leftMouth: { x: number; y: number } | null;
    rightMouth: { x: number; y: number } | null;
  };
}

export interface QualityAnalysis {
  eyeOpenness: number;       // 0-1, 1 = fully open
  blurScore: number;         // 0-1, 1 = sharp
  exposureScore: number;     // -1 to 1, 0 = balanced, negative = under, positive = over
  faceAngle: number;         // degrees from frontal, 0 = straight on
  expressionConf: number;    // 0-1, confidence in expression clarity
  lightingQuality: number;   // 0-1, 1 = well lit
}

export type VariationTone = 'warm' | 'platinum' | 'natural' | 'mood';

export interface EnhancementInput {
  imageBase64: string;
  faceRegion: FaceRegion;
  quality: QualityAnalysis;
  imageWidth: number;
  imageHeight: number;
}

export interface VariationResult {
  uri: string;               // URL or local URI of generated image
  tone: VariationTone;
  promptUsed: string;
}

export interface EnhancementResult {
  variations: VariationResult[];
  provider: string;
  model: string;
  latencyMs: number;
}

// ── Provider interface ──

export interface EnhancementProvider {
  readonly name: string;
  enhance(input: EnhancementInput): Promise<EnhancementResult>;
  checkHealth(): Promise<boolean>;
}

// ── Prompt engineering for 4 emotional tones ──

function buildPromptForTone(tone: VariationTone, quality: QualityAnalysis): { prompt: string; negativePrompt: string } {
  const baseNegative = 'blurry, distorted, unnatural skin, plastic skin, overprocessed, airbrushed, uncanny valley, bad anatomy, warped features, asymmetric distortion, beauty filter, oversharpened, noise artifacts';

  // Adaptive base: fix what's actually wrong
  const fixes: string[] = [];
  if (quality.eyeOpenness < 0.5) fixes.push('eyes naturally open');
  if (quality.blurScore < 0.4) fixes.push('sharp facial detail');
  if (quality.exposureScore < -0.3) fixes.push('well-lit face');
  if (quality.exposureScore > 0.3) fixes.push('balanced exposure');
  if (quality.expressionConf < 0.5) fixes.push('clear natural expression');
  if (quality.lightingQuality < 0.4) fixes.push('natural soft lighting on face');

  const fixStr = fixes.length > 0 ? fixes.join(', ') + ', ' : '';

  const tonePrompts: Record<VariationTone, string> = {
    warm: `${fixStr}warm golden hour lighting, soft skin tones, gentle warmth, natural texture preserved, emotionally inviting, intimate atmosphere, real photograph`,
    platinum: `${fixStr}cool platinum cinematic lighting, refined contrast, subtle film grain, editorial quality, elegant atmosphere, premium photography, real photograph`,
    natural: `${fixStr}natural daylight, true-to-life colors, documentary realism, authentic skin texture, unprocessed feel, honest portrait, real photograph`,
    mood: `${fixStr}atmospheric low-light, rich shadows, cinematic depth, moody contrast, evening ambiance, intimate tone, real photograph`,
  };

  return {
    prompt: tonePrompts[tone],
    negativePrompt: baseNegative,
  };
}

// Adaptive strength based on what actually needs fixing
function computeAdaptiveStrength(quality: QualityAnalysis): number {
  let strength = 0.25; // baseline: very subtle

  // Eyes closed or nearly closed: needs more correction
  if (quality.eyeOpenness < 0.3) strength += 0.15;
  else if (quality.eyeOpenness < 0.5) strength += 0.08;

  // Blurry: needs clarity restoration
  if (quality.blurScore < 0.3) strength += 0.1;
  else if (quality.blurScore < 0.5) strength += 0.05;

  // Bad exposure: needs lighting fix
  if (Math.abs(quality.exposureScore) > 0.4) strength += 0.08;

  // Weak expression: needs subtle refinement
  if (quality.expressionConf < 0.4) strength += 0.05;

  // Poor lighting: needs restoration
  if (quality.lightingQuality < 0.3) strength += 0.08;

  // Clamp to safe range: never go so high it looks fake
  return Math.min(0.55, Math.max(0.2, strength));
}

// ── Replicate provider ──

class ReplicateProvider implements EnhancementProvider {
  readonly name = 'replicate';
  private baseUrl = 'https://api.replicate.com/v1';

  private get token(): string {
    return process.env.EXPO_PUBLIC_REPLICATE_API_TOKEN || '';
  }

  async enhance(input: EnhancementInput): Promise<EnhancementResult> {
    const start = Date.now();
    const strength = computeAdaptiveStrength(input.quality);
    const tones: VariationTone[] = ['warm', 'platinum', 'natural', 'mood'];
    const variations: VariationResult[] = [];

    // Stage 1: Face restoration (CodeFormer) for clarity/expression recovery
    const restoredBase64 = await this.runCodeFormer(input.imageBase64, strength);

    // Stage 2: Generate 4 emotional variations via SDXL img2img
    const promises = tones.map(async (tone) => {
      const { prompt, negativePrompt } = buildPromptForTone(tone, input.quality);
      const result = await this.runImg2Img(restoredBase64, prompt, negativePrompt, strength * 0.6);
      return { uri: result, tone, promptUsed: prompt };
    });

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        variations.push(r.value);
      }
    }

    if (variations.length === 0) {
      throw new Error('All variation generations failed');
    }

    return {
      variations,
      provider: this.name,
      model: 'codeformer+sdxl',
      latencyMs: Date.now() - start,
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Token ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async runCodeFormer(imageBase64: string, fidelity: number): Promise<string> {
    const prediction = await this.createPrediction(
      'sczhou/codeformer:7bc24fc2f52f4418fb2bfce34da4f8e82f33123a2ab692e2f3a8bd4700889a64',
      {
        image: `data:image/jpeg;base64,${imageBase64}`,
        codeformer_fidelity: Math.min(0.9, fidelity + 0.3), // higher = more faithful to original
        background_enhance: false,
        face_upsample: true,
        upscale: 1,
      }
    );
    return prediction;
  }

  private async runImg2Img(imageBase64: string, prompt: string, negativePrompt: string, strength: number): Promise<string> {
    const prediction = await this.createPrediction(
      'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
      {
        image: `data:image/jpeg;base64,${imageBase64}`,
        prompt,
        negative_prompt: negativePrompt,
        strength: Math.min(0.45, strength), // cap low: preserve identity
        guidance_scale: 7.0,
        num_inference_steps: 25,
        scheduler: 'K_EULER',
        num_outputs: 1,
      }
    );
    return prediction;
  }

  private async createPrediction(version: string, inputData: Record<string, any>): Promise<string> {
    const res = await fetch(`${this.baseUrl}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version, input: inputData }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Replicate create failed: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    return this.pollPrediction(data.urls.get);
  }

  private async pollPrediction(url: string): Promise<string> {
    const maxAttempts = 60; // 60 seconds max
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(url, {
        headers: { Authorization: `Token ${this.token}` },
      });

      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
      const data = await res.json();

      if (data.status === 'succeeded') {
        const output = data.output;
        // Replicate returns either a string URL or array of URLs
        if (typeof output === 'string') return output;
        if (Array.isArray(output) && output.length > 0) return output[0];
        throw new Error('Empty prediction output');
      }

      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(`Prediction ${data.status}: ${data.error || 'unknown'}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Prediction timeout after 60s');
  }
}

// ── Fal provider (fallback) ──

class FalProvider implements EnhancementProvider {
  readonly name = 'fal';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async enhance(input: EnhancementInput): Promise<EnhancementResult> {
    // Fal implementation follows same pattern as Replicate
    // Placeholder for Phase 1b activation
    throw new Error('Fal provider not yet implemented. Use Replicate.');
  }

  async checkHealth(): Promise<boolean> {
    // Fal health check
    return false;
  }
}

// ── Service orchestrator ──

export class EnhancementService {
  private primary: EnhancementProvider;
  private fallback: EnhancementProvider | null;

  constructor() {
    const provider = process.env.EXPO_PUBLIC_ENHANCEMENT_PROVIDER || 'replicate';

    // ReplicateProvider reads token lazily via getter
    this.primary = new ReplicateProvider();

    // Fallback (Phase 1b)
    this.fallback = null;
  }

  async enhance(input: EnhancementInput): Promise<EnhancementResult> {
    try {
      return await this.primary.enhance(input);
    } catch (primaryErr) {
      console.error(`[Enhancement] Primary provider (${this.primary.name}) failed:`, primaryErr);

      if (this.fallback) {
        console.log(`[Enhancement] Falling back to ${this.fallback.name}`);
        try {
          return await this.fallback.enhance(input);
        } catch (fallbackErr) {
          console.error(`[Enhancement] Fallback provider (${this.fallback.name}) also failed:`, fallbackErr);
          throw fallbackErr;
        }
      }

      throw primaryErr;
    }
  }

  async checkHealth(): Promise<{ primary: boolean; fallback: boolean }> {
    const primary = await this.primary.checkHealth();
    const fallback = this.fallback ? await this.fallback.checkHealth() : false;
    return { primary, fallback };
  }

  getProviderName(): string {
    return this.primary.name;
  }
}

// ── Singleton ──

let _instance: EnhancementService | null = null;

export function getEnhancementService(): EnhancementService {
  if (!_instance) {
    _instance = new EnhancementService();
  }
  return _instance;
}
