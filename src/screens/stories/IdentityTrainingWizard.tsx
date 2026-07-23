/**
 * IdentityTrainingWizard.tsx
 *
 * Luxury onboarding ritual for identity photo selection.
 * "Show us your best moments" - not "train AI model."
 *
 * Owns: photo selection UI, quality feedback, coverage meters,
 *       upload orchestration, training trigger, progress display.
 * Does NOT own: actual training (faceIdentityService),
 *       face detection, reconstruction, verification.
 *
 * Design: PlatinumCircles base tokens + elevated cinematic layer.
 * The experience should feel personal, premium, and emotionally meaningful.
 *
 * Quality over quantity: 8 excellent varied photos beat 20 mediocre selfies.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  FlatList,
  Animated,
  Dimensions,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  palette, surface, text as textColor, accent,
  space, typeSize, fontWeight,
} from '../../constants/tokens';
import {
  SPRING_ARRANGEMENT_ENTER,
  EASE_CINEMATIC,
  FADE_COMPOSER_ENTRY,
} from '../../constants/motionDualMemory';
import { getFaceIdentityService } from '../../services/ai/faceIdentityService';
import type { TrainingProgress } from '../../services/ai/faceIdentityService';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Cinematic tokens (matches EnhancerModal layer) ──

const cinema = {
  bgDeep: 'rgb(4, 6, 12)',
  glowPlatinum: 'rgba(196, 186, 168, 0.12)',
  accentPlatinum: '#C4BAA8',
  accentPlatinumSoft: 'rgba(196, 186, 168, 0.6)',
  textHero: '#F5F0E8',
  textWhisper: 'rgba(245, 240, 232, 0.4)',
  textCalm: 'rgba(245, 240, 232, 0.65)',
  surfaceGlass: 'rgba(255, 255, 255, 0.06)',
  surfaceGlassActive: 'rgba(255, 255, 255, 0.12)',
  borderSubtle: 'rgba(196, 186, 168, 0.15)',
  borderActive: 'rgba(196, 186, 168, 0.5)',
  successSoft: 'rgba(52, 199, 89, 0.15)',
  successText: '#34C759',
  warnSoft: 'rgba(255, 159, 10, 0.15)',
  warnText: '#FF9F0A',
};

// ── Coverage categories ──

interface CoverageState {
  frontal: number;       // 0-1, how many front-facing photos
  angles: number;        // 0-1, variety of angles
  expressions: number;   // 0-1, variety of expressions
  lighting: number;      // 0-1, variety of lighting conditions
  sharpness: number;     // 0-1, average sharpness quality
  overall: number;       // 0-1, composite readiness
}

const MIN_PHOTOS = 8;
const MAX_PHOTOS = 20;
const READY_THRESHOLD = 0.65;

// ── Guidance messages ──

interface GuidanceTip {
  icon: string;
  message: string;
  priority: number;
}

function generateGuidance(photos: SelectedPhoto[], coverage: CoverageState): GuidanceTip[] {
  const tips: GuidanceTip[] = [];

  if (photos.length < MIN_PHOTOS) {
    tips.push({
      icon: 'plus-circle',
      message: `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length > 1 ? 's' : ''} to get started`,
      priority: 1,
    });
  }

  if (coverage.frontal < 0.3 && photos.length >= 3) {
    tips.push({
      icon: 'user',
      message: 'Add a clear front-facing photo',
      priority: 2,
    });
  }

  if (coverage.angles < 0.4 && photos.length >= 5) {
    tips.push({
      icon: 'rotate-cw',
      message: 'Try a photo from a different angle',
      priority: 3,
    });
  }

  if (coverage.expressions < 0.4 && photos.length >= 5) {
    tips.push({
      icon: 'smile',
      message: 'Add a photo with a different expression',
      priority: 4,
    });
  }

  if (coverage.lighting < 0.4 && photos.length >= 6) {
    tips.push({
      icon: 'sun',
      message: 'Include a photo in different lighting',
      priority: 5,
    });
  }

  if (coverage.sharpness < 0.5 && photos.length >= 4) {
    tips.push({
      icon: 'aperture',
      message: 'Choose sharper, well-lit photos for better results',
      priority: 6,
    });
  }

  tips.sort((a, b) => a.priority - b.priority);
  return tips.slice(0, 2); // Show max 2 tips at a time
}

// ── Photo quality estimation ──

interface SelectedPhoto {
  uri: string;
  width: number;
  height: number;
  qualityEstimate: number; // 0-1
}

function estimatePhotoQuality(photo: { width: number; height: number }): number {
  // Phase 1: heuristic from resolution
  // Higher resolution = likely sharper capture
  const megapixels = (photo.width * photo.height) / 1_000_000;
  if (megapixels >= 8) return 0.9;
  if (megapixels >= 4) return 0.75;
  if (megapixels >= 2) return 0.6;
  if (megapixels >= 1) return 0.45;
  return 0.3;
}

function computeCoverage(photos: SelectedPhoto[]): CoverageState {
  if (photos.length === 0) {
    return { frontal: 0, angles: 0, expressions: 0, lighting: 0, sharpness: 0, overall: 0 };
  }

  // Phase 1: estimate coverage from photo count and quality
  // Phase 2: real analysis from face detection per photo
  const count = photos.length;
  const avgQuality = photos.reduce((sum, p) => sum + p.qualityEstimate, 0) / count;

  // More photos = more likely variety (heuristic)
  const frontal = Math.min(1, count >= 3 ? 0.7 : count * 0.2);
  const angles = Math.min(1, count >= 6 ? 0.8 : count * 0.12);
  const expressions = Math.min(1, count >= 5 ? 0.7 : count * 0.13);
  const lighting = Math.min(1, count >= 7 ? 0.75 : count * 0.1);
  const sharpness = avgQuality;

  const overall = (frontal * 0.25 + angles * 0.2 + expressions * 0.2 + lighting * 0.15 + sharpness * 0.2);

  return { frontal, angles, expressions, lighting, sharpness, overall };
}

// ── Training state ──

type WizardState = 'selecting' | 'uploading' | 'completed' | 'failed';

// ── Props ──

interface IdentityTrainingWizardProps {
  visible: boolean;
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
  onClose: () => void;
}

// ── Component ──

export default function IdentityTrainingWizard({
  visible,
  userId,
  onComplete,
  onSkip,
  onClose,
}: IdentityTrainingWizardProps) {
  const insets = useSafeAreaInsets();

  // State
  const [wizardState, setWizardState] = useState<WizardState>('selecting');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [coverage, setCoverage] = useState<CoverageState>(computeCoverage([]));
  const [trainingProgress, setTrainingProgress] = useState<TrainingProgress>({
    step: '', percent: 0, status: 'uploading',
  });

  // Refs
  const mountedRef = useRef(true);
  const entryOpacity = useRef(new Animated.Value(0)).current;

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Entry animation
  useEffect(() => {
    if (visible) {
      entryOpacity.setValue(0);
      Animated.timing(entryOpacity, {
        toValue: 1,
        duration: FADE_COMPOSER_ENTRY,
        easing: EASE_CINEMATIC,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // Update coverage when photos change
  useEffect(() => {
    setCoverage(computeCoverage(photos));
  }, [photos]);

  // ── Photo selection ──

  const pickPhotos = useCallback(async () => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Maximum reached', `You can select up to ${MAX_PHOTOS} photos.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.95,
    });

    if (result.canceled || !result.assets) return;

    
    const newPhotos: SelectedPhoto[] = result.assets.map(asset => ({
      uri: asset.uri,
      width: asset.width || 0,
      height: asset.height || 0,
      qualityEstimate: estimatePhotoQuality({ width: asset.width || 0, height: asset.height || 0 }),
    }));

    setPhotos(prev => [...prev, ...newPhotos].slice(0, MAX_PHOTOS));
  }, [photos.length]);

  const removePhoto = useCallback((uri: string) => {
        setPhotos(prev => prev.filter(p => p.uri !== uri));
  }, []);

  // ── Upload and activate identity ──

  const startTraining = useCallback(async () => {
    if (photos.length < MIN_PHOTOS) {
      Alert.alert(
        'More photos needed',
        `Select at least ${MIN_PHOTOS} photos for the best results. You have ${photos.length}.`
      );
      return;
    }

        setWizardState('uploading');

    const identityService = getFaceIdentityService();

    try {
      const photoUris = photos.map(p => p.uri);
      const uploaded = await identityService.uploadReferencePhotos(
        userId,
        photoUris,
        (progress) => {
          if (mountedRef.current) setTrainingProgress(progress);
        }
      );

      if (!mountedRef.current) return;

      if (uploaded >= MIN_PHOTOS) {
        // Identity is ready immediately (no training wait)
                setWizardState('completed');
      } else if (uploaded > 0) {
        setWizardState('failed');
        setTrainingProgress({
          step: `Only ${uploaded} photos uploaded. Need at least ${MIN_PHOTOS}.`,
          percent: 0,
          status: 'failed',
        });
      } else {
        setWizardState('failed');
        setTrainingProgress({
          step: 'Could not upload photos. Please try again.',
          percent: 0,
          status: 'failed',
        });
      }
    } catch (err: any) {
      console.error('[TrainingWizard] Upload failed:', err);
      if (mountedRef.current) {
        setWizardState('failed');
        setTrainingProgress({
          step: err?.message || 'Something went wrong. Your photos are safe.',
          percent: 0,
          status: 'failed',
        });
      }
    }
  }, [photos, userId]);

  const retryTraining = useCallback(() => {
    setWizardState('selecting');
    setTrainingProgress({ step: '', percent: 0, status: 'uploading' });
  }, []);

  // ── Derived state ──

  const isReady = photos.length >= MIN_PHOTOS && coverage.overall >= READY_THRESHOLD;
  const isProcessing = wizardState === 'uploading';
  const guidance = generateGuidance(photos, coverage);

  const readinessLabel = coverage.overall >= 0.8
    ? 'Excellent coverage'
    : coverage.overall >= READY_THRESHOLD
      ? 'Good to go'
      : coverage.overall >= 0.4
        ? 'Getting there'
        : 'Add more variety';

  const readinessColor = coverage.overall >= 0.8
    ? cinema.successText
    : coverage.overall >= READY_THRESHOLD
      ? cinema.accentPlatinum
      : cinema.warnText;

  if (!visible) return null;

  // ── RENDER ──

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <Animated.View style={[st.root, { opacity: entryOpacity }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: cinema.bgDeep }]} />

        {/* Header */}
        <View style={[st.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <TouchableOpacity style={st.headerBtn} onPress={onClose} activeOpacity={0.7} disabled={isProcessing}>
            <Feather name="x" size={20} color={isProcessing ? cinema.textWhisper : cinema.textCalm} />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.headerTitle}>
              {wizardState === 'completed' ? 'Ready' : 'Your Best Look'}
            </Text>
          </View>
          <View style={st.headerBtn} />
        </View>

        {/* ── SELECTING STATE ── */}
        {wizardState === 'selecting' && (
          <ScrollView style={st.content} contentContainerStyle={st.contentInner} showsVerticalScrollIndicator={false}>
            {/* Hero message */}
            <View style={st.heroSection}>
              <Text style={st.heroTitle}>Show us your best moments</Text>
              <Text style={st.heroSubtitle}>
                Pick {MIN_PHOTOS}-{MAX_PHOTOS} photos where you love how you look.{'\n'}
                Different angles, expressions, and lighting work best.
              </Text>
            </View>

            {/* Coverage meters */}
            {photos.length >= 3 && (
              <View style={st.coverageSection}>
                <View style={st.coverageHeader}>
                  <Text style={st.coverageTitle}>Identity readiness</Text>
                  <Text style={[st.coverageLabel, { color: readinessColor }]}>{readinessLabel}</Text>
                </View>
                <View style={st.coverageBars}>
                  <CoverageBar label="Angles" value={coverage.angles} />
                  <CoverageBar label="Expressions" value={coverage.expressions} />
                  <CoverageBar label="Lighting" value={coverage.lighting} />
                  <CoverageBar label="Sharpness" value={coverage.sharpness} />
                </View>
              </View>
            )}

            {/* Guidance tips */}
            {guidance.length > 0 && (
              <View style={st.guidanceSection}>
                {guidance.map((tip, i) => (
                  <View key={i} style={st.guidanceTip}>
                    <Feather name={tip.icon as any} size={14} color={cinema.accentPlatinum} />
                    <Text style={st.guidanceTipText}>{tip.message}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Photo grid */}
            <View style={st.gridSection}>
              <View style={st.grid}>
                {photos.map((photo, i) => (
                  <View key={photo.uri} style={st.gridCell}>
                    <Image source={{ uri: photo.uri }} style={st.gridImage} resizeMode="cover" />
                    <TouchableOpacity style={st.gridRemove} onPress={() => removePhoto(photo.uri)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={12} color="#FFF" />
                    </TouchableOpacity>
                    {photo.qualityEstimate < 0.5 && (
                      <View style={st.gridWarning}>
                        <Feather name="alert-circle" size={10} color={cinema.warnText} />
                      </View>
                    )}
                  </View>
                ))}

                {/* Add button */}
                {photos.length < MAX_PHOTOS && (
                  <TouchableOpacity style={st.addCell} onPress={pickPhotos} activeOpacity={0.7}>
                    <Feather name="plus" size={24} color={cinema.accentPlatinumSoft} />
                    <Text style={st.addCellText}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Counter */}
            <Text style={st.counter}>
              {photos.length} photo{photos.length !== 1 ? 's' : ''} selected
              {photos.length < MIN_PHOTOS ? ` (${MIN_PHOTOS} minimum)` : ''}
            </Text>
          </ScrollView>
        )}

        {/* ── PROCESSING STATE ── */}
        {isProcessing && (
          <View style={st.processingContainer}>
            <View style={st.processingContent}>
              <ActivityIndicator size="large" color={cinema.accentPlatinum} />
              <Text style={st.processingStep}>{trainingProgress.step}</Text>
              {trainingProgress.percent > 0 && (
                <View style={st.progressBarWrap}>
                  <View style={[st.progressBarFill, { width: `${trainingProgress.percent}%` }]} />
                </View>
              )}
              <Text style={st.processingHint}>
                Building your cinematic identity...
              </Text>
            </View>
          </View>
        )}

        {/* ── COMPLETED STATE ── */}
        {wizardState === 'completed' && (
          <View style={st.completedContainer}>
            <View style={st.completedIcon}>
              <Feather name="check" size={32} color={cinema.successText} />
            </View>
            <Text style={st.completedTitle}>PlatinumCircles now knows your best look</Text>
            <Text style={st.completedSubtitle}>Your moments are about to get even better.</Text>
            <TouchableOpacity
              style={st.completedBtn}
              onPress={() => {
                                onComplete();
              }}
              activeOpacity={0.85}
            >
              <Text style={st.completedBtnText}>Start enhancing</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── FAILED STATE ── */}
        {wizardState === 'failed' && (
          <View style={st.failedContainer}>
            <Feather name="alert-circle" size={28} color={cinema.warnText} />
            <Text style={st.failedTitle}>Something went wrong</Text>
            <Text style={st.failedSubtitle}>{trainingProgress.step || 'Please try again.'}</Text>
            <View style={st.failedActions}>
              <TouchableOpacity style={st.failedRetryBtn} onPress={retryTraining} activeOpacity={0.7}>
                <Text style={st.failedRetryText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.failedSkipBtn} onPress={onSkip} activeOpacity={0.7}>
                <Text style={st.failedSkipText}>Use Quick Enhance instead</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── BOTTOM ACTIONS (selecting state only) ── */}
        {wizardState === 'selecting' && (
          <View style={[st.bottomActions, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <TouchableOpacity style={st.skipBtn} onPress={onSkip} activeOpacity={0.7}>
              <Text style={st.skipBtnText}>Use Quick Enhance for now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.trainBtn, !isReady && st.trainBtnDisabled]}
              onPress={startTraining}
              disabled={!isReady || isProcessing}
              activeOpacity={0.85}
            >
              <Text style={[st.trainBtnText, !isReady && st.trainBtnTextDisabled]}>
                {isReady ? 'Start learning my look' : `Add ${Math.max(0, MIN_PHOTOS - photos.length)} more`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

// ── Coverage bar component ──

function CoverageBar({ label, value }: { label: string; value: number }) {
  const barColor = value >= 0.7
    ? cinema.successText
    : value >= 0.4
      ? cinema.accentPlatinum
      : cinema.warnText;

  return (
    <View style={st.coverageBarRow}>
      <Text style={st.coverageBarLabel}>{label}</Text>
      <View style={st.coverageBarTrack}>
        <View style={[st.coverageBarFill, { width: `${Math.round(value * 100)}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

// ── Styles ──

const GRID_GAP = 6;
const GRID_COLS = 4;
const GRID_CELL = Math.floor((SCREEN_W - 40 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);

const st = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingBottom: 8, zIndex: 10 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: cinema.textHero, fontSize: typeSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },

  // Content
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 20, paddingBottom: 120 },

  // Hero
  heroSection: { alignItems: 'center', paddingTop: 12, paddingBottom: 20 },
  heroTitle: { color: cinema.textHero, fontSize: 22, fontWeight: fontWeight.bold, letterSpacing: 0.3, textAlign: 'center' },
  heroSubtitle: { color: cinema.textCalm, fontSize: typeSize.caption, fontWeight: fontWeight.medium, textAlign: 'center', lineHeight: 20, marginTop: 10 },

  // Coverage
  coverageSection: { backgroundColor: cinema.surfaceGlass, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 0.5, borderColor: cinema.borderSubtle },
  coverageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  coverageTitle: { color: cinema.textCalm, fontSize: typeSize.micro, fontWeight: fontWeight.semibold, letterSpacing: 0.5, textTransform: 'uppercase' as any },
  coverageLabel: { fontSize: typeSize.micro, fontWeight: fontWeight.bold },
  coverageBars: { gap: 8 },
  coverageBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverageBarLabel: { color: cinema.textWhisper, fontSize: 11, fontWeight: fontWeight.medium, width: 72 },
  coverageBarTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)' },
  coverageBarFill: { height: 4, borderRadius: 2 },

  // Guidance
  guidanceSection: { marginBottom: 16, gap: 8 },
  guidanceTip: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cinema.surfaceGlass, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 0.5, borderColor: cinema.borderSubtle },
  guidanceTipText: { color: cinema.textCalm, fontSize: typeSize.micro, fontWeight: fontWeight.medium, flex: 1 },

  // Grid
  gridSection: { marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { width: GRID_CELL, height: GRID_CELL, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  gridImage: { width: '100%', height: '100%' },
  gridRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  gridWarning: { position: 'absolute', bottom: 4, left: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: cinema.warnSoft, alignItems: 'center', justifyContent: 'center' },
  addCell: { width: GRID_CELL, height: GRID_CELL, borderRadius: 12, borderWidth: 1.5, borderColor: cinema.borderSubtle, borderStyle: 'dashed' as any, alignItems: 'center', justifyContent: 'center', gap: 4 },
  addCellText: { color: cinema.textWhisper, fontSize: 11, fontWeight: fontWeight.medium },

  // Counter
  counter: { color: cinema.textWhisper, fontSize: typeSize.micro, fontWeight: fontWeight.medium, textAlign: 'center', marginTop: 4 },

  // Processing
  processingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  processingContent: { alignItems: 'center', gap: 20 },
  processingStep: { color: cinema.textHero, fontSize: typeSize.body, fontWeight: fontWeight.medium, textAlign: 'center', letterSpacing: 0.3 },
  progressBarWrap: { width: 200, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.08)' },
  progressBarFill: { height: 3, borderRadius: 1.5, backgroundColor: cinema.accentPlatinum },
  processingHint: { color: cinema.textWhisper, fontSize: typeSize.micro, fontWeight: fontWeight.medium, textAlign: 'center', lineHeight: 18 },

  // Completed
  completedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  completedIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: cinema.successSoft, alignItems: 'center', justifyContent: 'center' },
  completedTitle: { color: cinema.textHero, fontSize: 20, fontWeight: fontWeight.bold, textAlign: 'center', letterSpacing: 0.3 },
  completedSubtitle: { color: cinema.textCalm, fontSize: typeSize.caption, fontWeight: fontWeight.medium, textAlign: 'center' },
  completedBtn: { marginTop: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24, backgroundColor: accent.warm },
  completedBtnText: { color: '#FFF', fontSize: typeSize.caption, fontWeight: fontWeight.bold, letterSpacing: 0.3 },

  // Failed
  failedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  failedTitle: { color: cinema.textHero, fontSize: typeSize.body, fontWeight: fontWeight.semibold },
  failedSubtitle: { color: cinema.textCalm, fontSize: typeSize.caption, fontWeight: fontWeight.medium, textAlign: 'center', lineHeight: 20 },
  failedActions: { marginTop: 8, gap: 10, width: '100%' },
  failedRetryBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 24, backgroundColor: cinema.surfaceGlass, borderWidth: 0.5, borderColor: cinema.borderSubtle },
  failedRetryText: { color: cinema.textCalm, fontSize: typeSize.caption, fontWeight: fontWeight.medium },
  failedSkipBtn: { alignItems: 'center', paddingVertical: 10 },
  failedSkipText: { color: cinema.textWhisper, fontSize: typeSize.micro, fontWeight: fontWeight.medium },

  // Bottom actions
  bottomActions: { paddingHorizontal: 20, gap: 10 },
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipBtnText: { color: cinema.textWhisper, fontSize: typeSize.micro, fontWeight: fontWeight.medium },
  trainBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 24, backgroundColor: cinema.accentPlatinumSoft },
  trainBtnDisabled: { backgroundColor: cinema.surfaceGlass, borderWidth: 0.5, borderColor: cinema.borderSubtle },
  trainBtnText: { color: cinema.bgDeep, fontSize: typeSize.caption, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  trainBtnTextDisabled: { color: cinema.textWhisper },
});
