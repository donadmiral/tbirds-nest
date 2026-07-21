import React, { useRef, useState } from 'react';
import { View, Image, PanResponder, StyleSheet, Text } from 'react-native';

interface CompareSliderProps {
  originalUri: string;
  enhancedUri: string;
  height: number;
}

export function CompareSlider({ originalUri, enhancedUri, height }: CompareSliderProps) {
  const [position, setPosition] = useState(0.5);
  const containerWidth = useRef(0);
  const containerX = useRef(0);
  const containerRef = useRef(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.pageX - containerX.current;
        if (containerWidth.current > 0) {
          setPosition(Math.max(0.02, Math.min(0.98, x / containerWidth.current)));
        }
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.pageX - containerX.current;
        if (containerWidth.current > 0) {
          setPosition(Math.max(0.02, Math.min(0.98, x / containerWidth.current)));
        }
      },
    })
  ).current;

  return (
    <View
      ref={containerRef}
      style={[styles.container, { height }]}
      onLayout={(e) => {
        containerWidth.current = e.nativeEvent.layout.width;
        containerRef.current?.measure((x, y, w, h, px) => {
          containerX.current = px;
        });
      }}
      {...panResponder.panHandlers}
    >
      <Image source={{ uri: enhancedUri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFillObject, { width: position * 100 + '%', overflow: 'hidden' }]}>
        <Image source={{ uri: originalUri }} style={{ width: containerWidth.current || 400, height: '100%' }} resizeMode="cover" />
      </View>
      <View style={styles.labelLeft}><Text style={styles.labelText}>Original</Text></View>
      <View style={styles.labelRight}><Text style={styles.labelText}>Enhanced</Text></View>
      <View style={[styles.sliderLine, { left: position * 100 + '%' }]}>
        <View style={styles.line} />
        <View style={styles.handle} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', overflow: 'hidden', borderRadius: 12, backgroundColor: '#000' },
  labelLeft: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  labelRight: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  sliderLine: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 3 },
  handle: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: '#C4A96C', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 },
});