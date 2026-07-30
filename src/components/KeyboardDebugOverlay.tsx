/**
 * KeyboardDebugOverlay - drop <KeyboardDebugOverlay /> into any screen
 * while investigating. Shows live keyboard height, window size and safe
 * insets in a corner chip. Remove after diagnosing.
 */
import React, { useEffect, useState } from 'react';
import { Keyboard, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function KeyboardDebugOverlay() {
  const [kb, setKb] = useState(0);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillChangeFrame' as any, (e: any) => {
      const top = e?.endCoordinates?.screenY ?? height;
      setKb(Math.max(0, Math.round(height - top)));
    });
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    const c = Keyboard.addListener('keyboardDidShow', (e: any) => setKb(Math.round(e?.endCoordinates?.height ?? 0)));
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [height]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 6, right: 6, zIndex: 9999, backgroundColor: 'rgba(11,30,61,0.85)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}>
      <Text style={{ color: '#7CFFB2', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        kb {kb}  win {Math.round(width)}x{Math.round(height)}  ins t{insets.top} b{insets.bottom}
      </Text>
    </View>
  );
}