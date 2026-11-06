import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, ColorMatrix, Image as SkiaImage, Skia, type SkImage } from '@shopify/react-native-skia';
import { hasStoryPhotoLook, storyPhotoColorMatrix, type StoryPhotoLook } from '../../../shared/storyColorMatrix';
import { privateImageCachePolicy } from '../../../shared/mediaDelivery';
import { imageDisplayIdentity } from '../../lib/imageDisplayIdentity';
import { navigationScope, subscribeNavigationScope } from '../../lib/navigationCache';
import { SUPABASE_URL } from '../../services/supabase';

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
  const images = useRef(new Set<SkImage>());
  const errorRef = useRef(onError); errorRef.current = onError;
  // Release the replaced bitmap only after the committed canvas uses its
  // replacement. A renewed grant must not remove the already graded pixels.
  useLayoutEffect(() => {
    images.current.forEach(held => { if (held !== image) { held.dispose(); images.current.delete(held); } });
  }, [image]);
  useEffect(() => () => { images.current.forEach(held => held.dispose()); images.current.clear(); }, []);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    // Catch download failures as well as decode failures. useImage in the
    // installed Skia version only reports decode errors to its callback.
    void Skia.Data.fromURI(uri).then(data => {
      const decoded = Skia.Image.MakeImageFromEncoded(data);
      if (!decoded) throw new Error('The photo could not be decoded.');
      if (cancelled) { decoded.dispose(); return; }
      images.current.add(decoded);
      setImage(decoded);
    }).catch(() => { if (!cancelled) { setImage(null); setError(true); errorRef.current?.(); } });
    return () => { cancelled = true; };
  }, [uri]);
  const matrix = useMemo(() => storyPhotoColorMatrix(look), [look]);
  useEffect(() => { if (image && size.width > 0 && size.height > 0) onLoad?.(); }, [image, size, onLoad]);
  return <View style={style} onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}>
    {image && size.width > 0 && size.height > 0 ? <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      <SkiaImage image={image} x={0} y={0} width={size.width} height={size.height} fit={fit}><ColorMatrix matrix={matrix} /></SkiaImage>
    </Canvas> : null}
    {error ? <View style={[StyleSheet.absoluteFill, styles.error]}><Text style={styles.errorText}>The edited photo could not load.</Text></View> : null}
  </View>;
}

/** The same saved grade is used by the editor, shared cards and story playback. */
export default function StoryPixelImage(props: StoryPixelImageProps) {
  const inherited = useContext(StoryPhotoLookContext);
  const look = props.look === undefined ? inherited : props.look;
  const report = useContext(StoryPhotoReadinessContext), id = useId();
  const graded = hasStoryPhotoLook(look);
  const scope = useSyncExternalStore(subscribeNavigationScope, navigationScope, navigationScope);
  const grant = useRef({ uri: props.uri, scope });
  if (grant.current.uri !== props.uri) grant.current = { uri: props.uri, scope };
  const allowed = privateImageCachePolicy(props.uri) !== 'none' || (!!scope && grant.current.scope === scope);
  const [retry, setRetry] = useState(0);
  const identity = useMemo(() => ({}), [props.uri, graded, retry, scope, allowed]);
  const [failed, setFailed] = useState<typeof identity | null>(null);
  const displayKey = JSON.stringify([scope, imageDisplayIdentity(props.uri, SUPABASE_URL), graded, retry]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const mounted = useRef(true), failedIdentity = useRef<typeof identity | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { report?.(id, 'loading'); return () => report?.(id, 'removed'); }, [identity, report, id]);
  const loaded = useCallback(() => { if (!mounted.current || !allowed || navigationScope() !== scope || currentIdentity.current !== identity || failedIdentity.current === identity) return; report?.(id, 'ready'); callbacks.current.onLoad?.(); }, [id, report, identity, scope, allowed]);
  const errored = useCallback(() => { if (!mounted.current || !allowed || navigationScope() !== scope || currentIdentity.current !== identity || failedIdentity.current === identity) return; failedIdentity.current = identity; setFailed(identity); report?.(id, 'error'); callbacks.current.onError?.(); }, [id, report, identity, scope, allowed]);
  // onLoad is the viewing-clock boundary, so decoded pixels must already be at
  // full opacity instead of spending another 300 ms in Android's default fade.
  const fadeDuration = 0;
  return <View style={props.style}>
    {allowed && failed !== identity ? graded ? <GradedPhoto key={displayKey} {...props} style={StyleSheet.absoluteFill} look={look} onLoad={loaded} onError={errored} /> : <Image key={displayKey} source={{ uri: props.uri }} resizeMode={props.fit || 'cover'} style={StyleSheet.absoluteFill} fadeDuration={fadeDuration} onLoad={loaded} onError={errored} /> : null}
    {failed === identity ? <View style={[StyleSheet.absoluteFill, styles.error]}><Text style={styles.errorText}>This photo could not load.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry photo" style={styles.retry} onPress={() => { setFailed(null); setRetry(value => value+1); }}><Text style={styles.errorText}>Retry</Text></TouchableOpacity></View> : null}
  </View>;
}
const styles = StyleSheet.create({ error: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#15191dcc', padding: 20 }, errorText: { color: '#fff', fontSize: 13, textAlign: 'center' }, retry: { alignSelf: 'center', marginTop: 12, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center', borderWidth: 1, borderColor: '#fff8', borderRadius: 22, backgroundColor: '#15191d' } });
