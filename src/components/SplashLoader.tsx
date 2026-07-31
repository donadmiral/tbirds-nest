/**
 * SplashLoader - the in-app continuation of the native launch screen.
 * Identical white field, identical lockup, so from tap to feed the
 * launch reads as ONE screen with a quiet pulse while things load.
 */
import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, StyleSheet } from 'react-native';

export default function SplashLoader() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={s.wrap}>
      <Animated.View style={{ opacity: pulse }}>
        <Image source={require('../../assets/splash.png')} style={s.art} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  art: { width: '78%', height: '60%' },
});