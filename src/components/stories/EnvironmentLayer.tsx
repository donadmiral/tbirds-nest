/**
 * EnvironmentLayer.tsx
 * 
 * Atmospheric depth engine. Creates environmental territory without
 * overpowering media. Media dominance is the priority.
 * 
 * Design rule: the environment SUPPORTS the media. Never darkens it
 * more than necessary for text legibility in the chrome zones.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing as REasing,
  cancelAnimation,
} from 'react-native-reanimated';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type EnvironmentLayerProps = {
  chromeOpacity: ReAnimated.SharedValue<number>;
  isPaused: boolean;
  isOwn: boolean;
};

const EnvironmentLayer = React.memo(function EnvironmentLayer({
  chromeOpacity,
  isPaused,
}: EnvironmentLayerProps) {
  const breathSV = useSharedValue(0);

  useEffect(() => {
    if (isPaused) {
      cancelAnimation(breathSV);
      breathSV.value = withTiming(0.5, { duration: 600, easing: REasing.out(REasing.ease) });
    } else {
      breathSV.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 4500, easing: REasing.inOut(REasing.ease) }),
          withTiming(0, { duration: 5500, easing: REasing.inOut(REasing.ease) }),
        ),
        -1, false,
      );
    }
    return () => cancelAnimation(breathSV);
  }, [isPaused]);

  // Territory: responds to chrome. Lighter when chrome is full (media dominates).
  const territoryStyle = useAnimatedStyle(() => {
    const chromeInfluence = 1 - chromeOpacity.value;
    // Full chrome (1.0): territory at 0.30. Dimmed chrome (0.45): territory at 0.42.
    const baseOpacity = 0.30 + (chromeInfluence * 0.12);
    return { opacity: baseOpacity };
  });

  const ceilingStyle = useAnimatedStyle(() => {
    const chromeInfluence = 1 - chromeOpacity.value;
    // Full chrome: 0.25. Dimmed: 0.33.
    const baseOpacity = 0.25 + (chromeInfluence * 0.08);
    return { opacity: baseOpacity };
  });

  // Breathing vignette: very subtle edge darkening
  const vignetteStyle = useAnimatedStyle(() => {
    const breathInfluence = breathSV.value;
    // Oscillates between 0.08 and 0.14 — barely perceptible
    const opacity = 0.08 + (breathInfluence * 0.06);
    return { opacity };
  });

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Layer 1: Subtle corner vignettes — REDUCED, no center overlap */}
      <ReAnimated.View style={[styles.vignetteLayer, vignetteStyle]}>
        <LinearGradient
          colors={['rgba(2,4,8,0.5)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.35, y: 0.35 }}
          style={styles.cornerTL}
        />
        <LinearGradient
          colors={['rgba(2,4,8,0.5)', 'transparent']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.65, y: 0.35 }}
          style={styles.cornerTR}
        />
        <LinearGradient
          colors={['rgba(2,4,8,0.4)', 'transparent']}
          start={{ x: 0, y: 1 }}
          end={{ x: 0.35, y: 0.65 }}
          style={styles.cornerBL}
        />
        <LinearGradient
          colors={['rgba(2,4,8,0.4)', 'transparent']}
          start={{ x: 1, y: 1 }}
          end={{ x: 0.65, y: 0.65 }}
          style={styles.cornerBR}
        />
      </ReAnimated.View>

      {/* Layer 2: Ceiling — for top chrome legibility only */}
      <ReAnimated.View style={[styles.ceilingLayer, ceilingStyle]}>
        <LinearGradient
          colors={['rgba(3,6,16,0.50)', 'rgba(3,6,16,0.25)', 'rgba(3,6,16,0.08)', 'transparent']}
          locations={[0, 0.2, 0.5, 1]}
          style={styles.ceiling}
        />
      </ReAnimated.View>

      {/* Layer 3: Territory — bottom zone for identity/reply legibility */}
      <ReAnimated.View style={[styles.territoryLayer, territoryStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(3,6,16,0.05)', 'rgba(3,6,16,0.18)', 'rgba(4,8,18,0.38)', 'rgba(4,8,18,0.50)']}
          locations={[0, 0.15, 0.4, 0.7, 1]}
          style={styles.territory}
        />
      </ReAnimated.View>
    </View>
  );
});

export default EnvironmentLayer;

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, zIndex: 3 },
  vignetteLayer: { ...StyleSheet.absoluteFillObject },
  // Corners: SMALLER, no overlap. Each covers only its quadrant corner.
  cornerTL: { position: 'absolute', top: 0, left: 0, width: SCREEN_W * 0.4, height: SCREEN_H * 0.3 },
  cornerTR: { position: 'absolute', top: 0, right: 0, width: SCREEN_W * 0.4, height: SCREEN_H * 0.3 },
  cornerBL: { position: 'absolute', bottom: 0, left: 0, width: SCREEN_W * 0.4, height: SCREEN_H * 0.35 },
  cornerBR: { position: 'absolute', bottom: 0, right: 0, width: SCREEN_W * 0.4, height: SCREEN_H * 0.35 },
  // Ceiling: shorter, lighter
  ceilingLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: SCREEN_H * 0.22 },
  ceiling: { flex: 1 },
  // Territory: shorter, lighter
  territoryLayer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: SCREEN_H * 0.38 },
  territory: { flex: 1 },
  // Focus wells REMOVED — they added opacity to the media center zone
});