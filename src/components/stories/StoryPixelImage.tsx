import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, ColorMatrix, Image as SkiaImage, Skia, type SkImage } from '@shopify/react-native-skia';
import { hasStoryPhotoLook, storyPhotoColorMatrix, type StoryPhotoLook } from '../../../shared/storyColorMatrix';

export const StoryPhotoLookContext = createContext<StoryPhotoLook | null>(null);
export type StoryPhotoReadiness = 'loading' | 'ready' | 'error' | 'removed';
export const StoryPhotoReadinessContext = createContext<((id: string, status: StoryPhotoReadiness) => void) | null>(null);
export type StoryPixelImageProps = {
  uri: string; fit?: 'contain' | 'cover'; style?: StyleProp<ViewStyle>; look?: StoryPhotoLook | null;
  onLoad?: () => void; onError?: () => void;
};

function GradedPhoto({ uri, fit = 'cover', style, look, onLoad, onError }: StoryPixelImageProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const [image, setImage] = useState<SkImage | null>(null);
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    let cancelled = false;
    let decodedImage: SkImage | null = null;
    setImage(null); setError(false);
    // Catch download failures as well as decode failures. useImage in the
    // installed Skia version only reports decode errors to its callback.
    void Skia.Data.fromURI(uri).then(data => {
      const decoded = Skia.Image.MakeImageFromEncoded(data);
      if (!decoded) throw new Error('The photo could not be decoded.');
      if (cancelled) { decoded.dispose(); return; }
      decodedImage = decoded;
      setImage(decoded);
    }).catch(() => { if (!cancelled) { setError(true); errorRef.current?.(); } });
    return () => { cancelled = true; decodedImage?.dispose(); };
  }, [uri]);
  const matrix = useMemo(() => storyPhotoColorMatrix(look), [look]);
  useEffect(() => { if (image && size.width > 0 && size.height > 0) onLoad?.(); }, [image, size, onLoad]);
  return <View style={style} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}>
    {image && size.width > 0 && size.height > 0 ? <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit={fit}><ColorMatrix matrix={matrix} /></SkiaImage>
    </Canvas> : <Image source={{ uri }} resizeMode={fit} style={StyleSheet.absoluteFill} />}
    {error ? <View style={[StyleSheet.absoluteFill, styles.error]}><Text style={styles.errorText}>The edited photo could not load.</Text></View> : null}
  </View>;
}

/** The same saved grade is used by the editor, shared cards and story playback. */
export default function StoryPixelImage(props: StoryPixelImageProps) {
  const inherited = useContext(StoryPhotoLookContext);
  const look = props.look === undefined ? inherited : props.look;
  const report = useContext(StoryPhotoReadinessContext), id = useId();
  const graded = hasStoryPhotoLook(look);
  const [retry, setRetry] = useState(0), [failed, setFailed] = useState(false);
  const callbacks = useRef(props); callbacks.current = props;
  useEffect(() => { setFailed(false); report?.(id, 'loading'); return () => report?.(id, 'removed'); }, [props.uri, graded, retry, report, id]);
  const loaded = useCallback(() => { report?.(id, 'ready'); callbacks.current.onLoad?.(); }, [id, report]);
  const errored = useCallback(() => { setFailed(true); report?.(id, 'error'); callbacks.current.onError?.(); }, [id, report]);
  // Android fades file images for 300 ms after onLoad. A capture needs the
  // decoded pixels at full opacity; ordinary playback keeps its native default.
  const fadeDuration = report ? 0 : undefined;
  return <View style={props.style}>
    {graded ? <GradedPhoto key={props.uri + ':' + retry} {...props} style={StyleSheet.absoluteFill} look={look} onLoad={loaded} onError={errored} /> : <Image key={props.uri + ':' + retry} source={{ uri: props.uri }} resizeMode={props.fit || 'cover'} style={StyleSheet.absoluteFill} fadeDuration={fadeDuration} onLoad={loaded} onError={errored} />}
    {failed ? <View style={[StyleSheet.absoluteFill, styles.error]}><Text style={styles.errorText}>This photo could not load.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry photo" style={styles.retry} onPress={() => { setFailed(false); setRetry(value => value+1); }}><Text style={styles.errorText}>Retry</Text></TouchableOpacity></View> : null}
  </View>;
}
const styles = StyleSheet.create({ error: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#15191dcc', padding: 20 }, errorText: { color: '#fff', fontSize: 13, textAlign: 'center' }, retry: { alignSelf: 'center', marginTop: 12, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center', borderWidth: 1, borderColor: '#fff8', borderRadius: 22, backgroundColor: '#15191d' } });
