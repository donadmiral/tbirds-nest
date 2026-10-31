import {memoryPageSoundtrack} from '../../../shared/memoryFilm';
import SoundtrackPicker from '../../components/SoundtrackPicker';
import { themedSheet, useTheme } from '../../theme/useTheme';
import VideoThumb from '../../components/VideoThumb';
import StoryPixelImage from '../../components/stories/StoryPixelImage';
import MemoryPageImage from '../../components/memory/MemoryPageImage';
import MemoryFilm from '../../components/memory/MemoryFilm';
import MemoryStoryFrame, { type MemoryStoryPage } from '../../components/memory/MemoryStoryFrame';
import { memoryAlbumStoryLayers, memoryStoryRecipe, memoryStorySeek, memoryStoryStickers } from '../../../shared/memoryStoryPresentation';
import MemoryPageTurn,{MemoryTurnPreview,type MemoryPageTurnHandle} from '../../components/memory/MemoryPageTurn';
/**
 * MemoryAlbumScreen — the memory book.
 * Closed: an editorial photo cover in the chosen book design. Tap to open.
 * Open: cream-paper pages, safe page-turn controls, a page grid, and captions.
 * Owner: add from own stories, edit captions, remove pages, settings.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, FlatList,
  ActivityIndicator, Alert, StatusBar, ScrollView, Animated,
  Easing, KeyboardAvoidingView, Platform, AppState, useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { StoryVideoView as VideoView, useStoryVideoPlayer as useVideoPlayer } from '../../../modules/boomerang/storyVideo';
import { hydrateMemoryAlbumMedia, hydrateStoryMedia } from '../../services/contentMedia';
import { supabase } from '../../services/supabase';
import { COVER_COLORS } from '../../components/MemoryAlbumCard';

import { useCallContext } from '../../contexts/CallContext';
import { useIsFocused,type ParamListBase } from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import MemoryBookCover from '../../components/memory/MemoryBookCover';
import {MemoryCoverControls,MemoryFilmControls} from '../../components/memory/MemoryCreativeControls';
import {memoryCoverArtwork,memoryFilmSettings,memoryCreativeSaveError} from '../../../shared/memoryBookCreative';
import {saveMemoryCreativeBook} from '../../../shared/memoryBookPersistence';
import type {MemoryBook,MemoryBookPage,MemoryBookshelf} from '../../../shared/memoryBookModels';
import { MemoryStoryTile,type MemoryDesignerStory } from '../../components/memory/MemoryBookDesigner';
import MemoryAudienceEditor from '../../components/memory/MemoryAudienceEditor';
import { memoryArtwork, memoryCoverMedia, memoryCoverPage, MEMORY_FEATURED_DESIGNS as MEMORY_DESIGNS } from '../../../shared/memoryBookDesign';
import { memoryPhotoDuration } from '../../../shared/memoryPlayback';
import { useMemoryPlayback } from '../../hooks/useMemoryPlayback';
import { useSoundtrackPlayer } from '../../hooks/useSoundtrackPlayer';
import { createMemorySoundtrackSaveHook } from '../../../shared/useMemorySoundtrackSave';
const useMemorySoundtrackSave = createMemorySoundtrackSaveHook({ useEffect, useRef, useState });
const PAGE_CREAM = '#FBF6EC';

const AUDIENCES = [
  { key: 'profile', label: 'Everyone who can view my profile' },
  { key: 'followers', label: 'Followers only' },
  { key: 'custom', label: 'Only people I choose' },
  { key: 'only_me', label: 'Only me' },
];

function emptyReactionScope() {
  return { revision: 0, readRevision: 0, changes: new Map<string, { revision: number; reacted: boolean }>() };
}

export default function MemoryAlbumScreen({ route, navigation }: NativeStackScreenProps<ParamListBase,'MemoryAlbum'>) {
  const { t, isDark } = useTheme();
  const focused = useIsFocused();
  const { callState } = useCallContext();
  const [playMode, setPlayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [filmVisible, setFilmVisible] = useState(false);
  const [playRun] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [readyPage, setReadyPage] = useState('');
  const [videoProgress, setVideoProgress] = useState(0);
  const motionScale = useRef(new Animated.Value(1)).current;
  useEffect(() => { const app = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => app.remove(); }, []);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [design, setDesign] = useState('keepsake');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [nextBook, setNextBook] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState('');
  const [pageActions,setPageActions]=useState<{text:string;style?:'cancel'|'destructive';onPress?:()=>void|Promise<void>}[]|null>(null);
  const pendingPageAction=useRef<(()=>void|Promise<void>)|null>(null);
  const saveLock = useRef(false);
  const reactionLock=useRef(false);
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion); return()=>sub.remove(); }, []);
  const params=route.params as {ownerId?:unknown;albumId?:unknown}|undefined;
  const ownerId=typeof params?.ownerId==='string'?params.ownerId:'';
  const albumIdParam=typeof params?.albumId==='string'?params.albumId:null;
  // Who is looking, and who owns the album: the Message button on a video memory DMs the owner.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [ownerProfile, setOwnerProfile] = useState<{ full_name: string | null; username: string | null; avatar_url: string | null } | null>(null);
  const viewerRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const reactionScope = useRef(emptyReactionScope());
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, authVersion = 0;
    setLoadError(null);
    const apply = (next: string | null) => {
      if (!alive) return;
      if (viewerRef.current !== next) {
        reactionScope.current = emptyReactionScope();
        setReactionRead({ known: new Set(), pending: !!next });
        loadGeneration.current++; setAlbum(null); setMyStories([]); setPlayingUrl(null); setPicker(false); setSettings(false); setPageActions(null); pendingPageAction.current=null; setCaptionFor(null); setLikedPages(new Set());
      }
      viewerRef.current = next; setViewerId(next); setAuthReady(true);
      if(!next){setLoadError('Sign in to view this album.');setLoading(false);}
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { authVersion++; apply(session?.user.id ?? null); });
    const initial = authVersion;
    void supabase.auth.getSession().then(({ data }) => { if (initial === authVersion) apply(data.session?.user.id ?? null); }).catch(() => { if (alive) setLoadError('Your account could not load. Please retry.'); });
    return () => { alive = false; loadGeneration.current++; reactionScope.current = emptyReactionScope(); subscription.unsubscribe(); };
  }, [authAttempt]);
  useEffect(() => { if (!ownerId) return; (async () => { try { const { data } = await supabase.from('profiles').select('full_name, username, avatar_url').eq('id', ownerId).maybeSingle(); if (data) setOwnerProfile(data); } catch {} })(); }, [ownerId]);
  const ownerName = ownerProfile?.full_name ?? null; const ownerUsername = ownerProfile?.username ?? null; const ownerAvatar = ownerProfile?.avatar_url ?? null;
  const [bookId, setBookId] = useState<string | null>(albumIdParam);
  const insets = useSafeAreaInsets();
  const [album, setAlbum] = useState<MemoryBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);
  const [grid, setGrid] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [coverStoryId, setCoverStoryId] = useState<string|null>(null);
  const [idx, setIdx] = useState(0);
  const [picker, setPicker] = useState(false);
  const [myStories, setMyStories] = useState<(MemoryDesignerStory & {_in:boolean})[]>([]);
  const [storiesLoading,setStoriesLoading]=useState(false);
  const [storiesError,setStoriesError]=useState('');
  const [failedStoryPreviews,setFailedStoryPreviews]=useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false),[settingsBusy,setSettingsBusy]=useState(false),[framing,setFraming]=useState(false);
  const settingsOpen=useRef(false);settingsOpen.current=settings;
  const [coverArtwork,setCoverArtwork]=useState(()=>memoryCoverArtwork()),[filmSettings,setFilmSettings]=useState(()=>memoryFilmSettings()),[presentationRevision,setPresentationRevision]=useState<number|undefined>();
  const [musicOpen,setMusicOpen]=useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('blush');
  const [aud, setAud] = useState('profile');
  const [captionFor, setCaptionFor] = useState<MemoryBookPage | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [likedPages, setLikedPages] = useState<Set<string>>(new Set());
  const [reactionRead, setReactionRead] = useState(() => ({ known: new Set<string>(), pending: true }));

  const coverAnim = useRef(new Animated.Value(0)).current;
  const pageTurn=useRef<MemoryPageTurnHandle>(null);
  const [turning,setTurning]=useState(false);
  const bookGeneration = useRef(0);
  const idxRef = useRef(0);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  const soundtrackSave = useMemorySoundtrackSave({ client: supabase, owner: viewerId, book: bookId,
    route: `${ownerId}:${albumIdParam ?? 'default'}`, canEdit: album?.is_owner === true,
    onConfirmed: (id, selection) => {
      loadGeneration.current += 1;
      setAlbum((previous) => previous?.id === id && previous.is_owner ? { ...previous, soundtrack: selection } : previous);
    },
  });

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const scope = reactionScope.current;
    const readRevision = ++scope.readRevision;
    // A new required read retires the old optional request. If a confirmed
    // soundtrack edit later supersedes this refresh, unknown reactions must
    // remain unavailable rather than wait forever for a discarded response.
    setReactionRead(previous => previous.pending ? { ...previous, pending: false } : previous);
    if (!ownerId || !viewerId) { setAlbum(null); setLoading(!authReady); if(authReady)setLoadError(!ownerId?'This album is unavailable.':'Sign in to view this album.'); return; }
    try {
      const { data, error } = albumIdParam
        ? await supabase.rpc('get_memory_book', { p_album: albumIdParam })
        : await supabase.rpc('get_memory_album', { p_owner: ownerId });
      if (error) throw error;
      const [hydrated] = data ? await hydrateMemoryAlbumMedia([memoryAlbumStoryLayers(data)]) : [];
      if (generation !== loadGeneration.current || viewerRef.current !== viewerId || reactionScope.current !== scope) return;
      setAlbum(hydrated ?? null); setLoadError(null);
      // A successful refresh may remove a page or revoke its source. Do not
      // keep its former signed URL alive in the expanded player.
      setPlayingUrl(current=>current&&(hydrated?.pages??[]).some((page:MemoryBookPage)=>page.media_url===current||memoryStoryStickers(page.stickers).some(sticker=>sticker.kind==='post'&&sticker.postMediaUrl===current))?current:null);
      if (data) {
       if(!settingsOpen.current){
        setDesign(data.cover_design||'keepsake');setCoverArtwork(memoryCoverArtwork(data.cover_artwork));setFilmSettings(memoryFilmSettings(data.film_settings));setPresentationRevision(data.presentation_revision);
        setTitle(data.title || 'Memories'); setSubtitle(data.subtitle || ''); setCoverStoryId(data.cover_story_id || null); setColor(data.cover_color || 'blush'); setAud(data.audience || 'profile');
       }
        if (data.id) setBookId(data.id);
      }
      const ids = ((data?.pages ?? []) as MemoryBookPage[]).map((pg:MemoryBookPage) => pg.story_id).filter((id):id is string=>!!id);
      const validIds = new Set(ids);
      for (const id of scope.changes.keys()) if (!validIds.has(id)) scope.changes.delete(id);
      setLikedPages(previous => new Set([...previous].filter(id => validIds.has(id))));
      setReactionRead(previous => ({ known: new Set([...previous.known].filter(id => validIds.has(id))), pending: ids.length > 0 }));
      if (ids.length) {
        // Reactions decorate an already authorized book. They must not hold its
        // reader behind a spinner or turn an optional failure into lost content.
        const revision = scope.revision;
        // A soundtrack confirmation invalidates full-book reads but does not
        // change reaction membership. Optional reads own a separate ticket.
        const current = () => readRevision === scope.readRevision && viewerRef.current === viewerId && reactionScope.current === scope;
        void (async () => {
          try {
            const { data: mine, error } = await supabase.from('story_reactions').select('story_id').eq('user_id', viewerId).in('story_id', ids);
            if (!current()) return;
            if (error || !Array.isArray(mine)) { setReactionRead(previous => ({ ...previous, pending: false })); return; }
            const next = new Set(mine.map(row => String(row.story_id)).filter(id => validIds.has(id)));
            // A successful toggle after this read began remains authoritative;
            // other pages still receive their independently fetched membership.
            for (const [id, change] of scope.changes) if (change.revision > revision && validIds.has(id)) {
              if (change.reacted) next.add(id); else next.delete(id);
            }
            setLikedPages(next);
            setReactionRead({ known: validIds, pending: false });
          } catch {
            if (current()) setReactionRead(previous => ({ ...previous, pending: false }));
          }
        })();
      }
    } catch {
      if (generation === loadGeneration.current) { setAlbum(null); setPlayingUrl(null); setLoadError('The album could not load. Please retry.'); }
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [ownerId, albumIdParam, viewerId, authReady]);

  useEffect(() => {
    // A route/account change invalidates pending flips and picker responses.
    bookGeneration.current++; loadGeneration.current++;
    reactionScope.current = emptyReactionScope();
    setLikedPages(new Set()); setReactionRead({ known: new Set(), pending: true });
    coverAnim.stopAnimation(); pageTurn.current?.cancel();
    coverAnim.setValue(0); idxRef.current=0;
    setOpened(false); setGrid(false); setPlayMode(false); setPlaying(false); setFilmVisible(false); setIdx(0); setAlbum(null); setBookId(albumIdParam);
    setPlayingUrl(null); setPicker(false); setSettings(false); setPageActions(null); pendingPageAction.current=null; setCaptionFor(null);
    setMyStories([]); setChosen(new Set()); setAdding(false); setStoriesLoading(false); setMutationError(''); setLoadError(null); setLoading(true);
    const invalidate=()=>{bookGeneration.current++;reactionScope.current=emptyReactionScope();coverAnim.stopAnimation();pageTurn.current?.cancel();};
    return invalidate;
  }, [ownerId, albumIdParam, viewerId, coverAnim]);

  useEffect(() => {
    void load();
    const refresh = () => { if (AppState.currentState === 'active') void load(); };
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const timer = setInterval(refresh, 240000);
    return () => { loadGeneration.current++; clearInterval(timer); sub.remove(); };
  }, [load]);

  const openSettings=useCallback(()=>{if(!album?.is_owner)return;setTitle(album.title);setSubtitle(album.subtitle??'');setColor(album.cover_color);setDesign(album.cover_design??'keepsake');setCoverStoryId(album.cover_story_id??null);setAud(album.audience);setCoverArtwork(memoryCoverArtwork(album.cover_artwork));setFilmSettings(memoryFilmSettings(album.film_settings));setPresentationRevision(album.presentation_revision);setMutationError('');setSettings(true);},[album]);
  useEffect(() => { let alive=true; setNextBook(null); if (!viewerId || !bookId) return; void supabase.rpc('get_memory_albums',{p_owner:ownerId}).then(({data,error})=>{if(!alive||error)return;const list=((data as MemoryBookshelf|null)?.books??[]).filter((b)=>data?.is_owner||b.count>0);const index=list.findIndex((b)=>b.id===bookId);if(index>=0&&index+1<list.length)setNextBook(list[index+1].id);});return()=>{alive=false;};},[ownerId,bookId,viewerId]);
  const music = useSoundtrackPlayer({ selection: album?.soundtrack ?? null, use: 'memory_album', active: focused && foreground && callState === 'idle' && opened && !filmVisible && (!playMode || playing) && !grid && !pageActions && !settings && !musicOpen && !picker && !captionFor && !playingUrl });

  const artwork = memoryArtwork(album?.cover_design, album?.cover_color);
  const pages: MemoryBookPage[] = useMemo(
    () => [...(album?.pages ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [album],
  );
  const draftCoverMedia = memoryCoverMedia(memoryCoverPage(pages, coverStoryId));

  useEffect(() => { if (idx > 0 && idx >= pages.length) setIdx(Math.max(0, pages.length - 1)); }, [pages.length, idx]);
  const pageAudio = useSoundtrackPlayer({selection:memoryPageSoundtrack(pages[idx]),use:'memory_album',playbackKey:pages[idx]?.id,active:focused && foreground && callState === 'idle' && opened && !filmVisible && (!playMode || playing) && !grid && !pageActions && !settings && !musicOpen && !picker && !captionFor && !playingUrl});
  const playbackPage = pages[idx];
  const movieActive = focused && foreground && callState === 'idle' && opened && !filmVisible && playMode && playing && !turning && !grid && !pageActions && !settings && !musicOpen && !picker && !captionFor && !playingUrl;
  const finishPage = useCallback(() => { if (idxRef.current >= pages.length - 1) setPlaying(false); else pageTurn.current?.turn(1); }, [pages.length]);
  const photoProgress = useMemoryPlayback(`${bookId}:${playbackPage?.id}:${playRun}`, movieActive && playbackPage?.media_type !== 'video' && (!playbackPage?.media_url || readyPage === playbackPage?.id), memoryPhotoDuration(playbackPage), finishPage);
  useEffect(() => { setReadyPage(''); setVideoProgress(0); }, [playbackPage?.id, playRun]);
  useEffect(() => { const animation = Animated.timing(motionScale, { toValue: playMode && !reduceMotion ? 1 + photoProgress * .06 : 1, duration: reduceMotion ? 0 : 120, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [motionScale, playMode, reduceMotion, photoProgress]);

  const openBook = useCallback(() => {
    const generation=bookGeneration.current;
    Animated.timing(coverAnim, { toValue: 1, duration: reduceMotion ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({finished}) => {if(finished&&generation===bookGeneration.current)setOpened(true);});
  }, [coverAnim, reduceMotion]);

  const closeBook = useCallback(() => {
    bookGeneration.current++;
    pageTurn.current?.cancel();
    setOpened(false); setGrid(false); setPlayMode(false); setPlaying(false);
    Animated.timing(coverAnim, { toValue: 0, duration: reduceMotion ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [coverAnim, reduceMotion]);

  const playBook = useCallback(() => { setPlaying(false); setPlayMode(false); setFilmVisible(true); }, []);

  const flipTo = useCallback((dir:1|-1)=>{pageTurn.current?.turn(dir);},[]);

  const openPicker = useCallback(async () => {
    setChosen(new Set()); setPicker(true); setStoriesLoading(true); setStoriesError(''); setMyStories([]); setFailedStoryPreviews(new Set());
    const expectedViewer=viewerRef.current, expectedBook=bookGeneration.current;
    try {
      const {data:sess,error:authError}=await supabase.auth.getSession();
      const uid=sess.session?.user.id;
      if(authError||!uid||uid!==expectedViewer)throw Error();
      const inAlbum=new Set(pages.map(p=>p.story_id).filter(Boolean));
      const {data,error}=await supabase.from('stories').select('id, media_url, media_type, thumbnail_url, caption, created_at, text_background, stickers_json').eq('user_id',uid).order('created_at',{ascending:false}).limit(120);
      if(error)throw error;
      const stories=await hydrateStoryMedia(data??[]);
      if(viewerRef.current===uid&&bookGeneration.current===expectedBook)setMyStories(stories.map((story)=>({...story,_in:inAlbum.has(story.id)})));
    } catch { if(viewerRef.current===expectedViewer&&bookGeneration.current===expectedBook)setStoriesError('Your stories could not load. Tap to retry.'); }
    finally { if(viewerRef.current===expectedViewer&&bookGeneration.current===expectedBook)setStoriesLoading(false); }
  }, [pages]);

  const addChosen = useCallback(async () => {
    if (!chosen.size || !bookId || saveLock.current) return;
    const generation=bookGeneration.current, viewer=viewerRef.current;
    saveLock.current=true; setAdding(true); setMutationError('');
    try {
      for (const id of chosen) {
        if(generation!==bookGeneration.current||viewer!==viewerRef.current)return;
        const {error}=await supabase.rpc('add_memory_page',{p_story_id:id,p_album_id:bookId});
        if(error)throw error;
      }
      if(generation===bookGeneration.current&&viewer===viewerRef.current){setPicker(false); await load();}
    }
    catch { if(generation===bookGeneration.current)setMutationError('Some memories could not save. Retry; existing pages will not duplicate.'); }
    finally { saveLock.current=false; if(generation===bookGeneration.current)setAdding(false); }
  }, [chosen, bookId, load]);

  const pageMenu = useCallback(() => {
    const p = pages[idxRef.current];
    if (!album?.is_owner) return;
    if (!p) {setSettings(true);return;}
    setPageActions([
      { text: 'Edit caption', onPress: () => { setCaptionFor(p); setCaptionText(p.caption || ''); } },
      ...([-1,1] as const).filter(d=>pages[idxRef.current+d]).map(d=>({text:d<0?'Move earlier':'Move later',onPress:async()=>{if(saveLock.current)return;saveLock.current=true;const at=idxRef.current;try{const {error}=await supabase.rpc('swap_memory_pages',{p_first:p.id,p_second:pages[at+d].id});if(error)throw error;idxRef.current=at+d;setIdx(at+d);await load();}catch{setMutationError('Page order could not save. Retry.');}finally{saveLock.current=false;}}})),
      { text: p.style==='full'?'Use framed page':'Use full page', onPress:async()=>{const {data,error}=await supabase.from('memory_pages').update({style:p.style==='full'?'polaroid':'full'}).eq('id',p.id).select('id');if(error||!data?.length){setMutationError('Page layout could not save. Retry.');return;}void load();} },
      { text: 'Remove from album', style: 'destructive', onPress: async () => {
        const {data,error}=await supabase.from('memory_pages').delete().eq('id',p.id).select('id');
        if(error||!data?.length){setMutationError('This memory could not be removed. Retry.');return;}
        void load();
      } },
      { text: 'Album settings', onPress: openSettings },
      ...(album?.is_default === false ? [{ text: 'Delete this book', style: 'destructive' as const, onPress: () => {
        Alert.alert('Delete this book?', 'Its memories leave the book too. Stories are not deleted.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => {
            try {const {error}=await supabase.rpc('delete_memory_book',{p_album:bookId});if(error)throw error;navigation.goBack();} catch {setMutationError('The book could not be deleted. Retry.');}
          } },
        ]);
      } }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [album, pages, load, bookId, navigation, openSettings]);

  const saveCaption = useCallback(async () => {
    if(!captionFor||saveLock.current)return;saveLock.current=true;setMutationError('');
    try {const {data,error}=await supabase.from('memory_pages').update({caption:captionText.trim()||null}).eq('id',captionFor.id).select('id');if(error||!data?.length)throw Error();setCaptionFor(null);await load();}
    catch {setMutationError('The caption could not save. Your text is kept.');}
    finally {saveLock.current=false;}
  }, [captionFor, captionText, load]);

  const saveSettings = async () => {
    if (!bookId || !album?.is_owner || saveLock.current) return;
    const generation=bookGeneration.current,viewer=viewerRef.current;
    const current=()=>generation===bookGeneration.current&&viewer===viewerRef.current&&viewer===ownerId;
    saveLock.current=true;setSettingsBusy(true);setMutationError('');
    try {
      await saveMemoryCreativeBook(supabase,{ownerId,albumId:bookId,revision:presentationRevision??-1,audience:aud,draft:{title:title.trim()||'Memories',subtitle,color,design,coverStoryId,artwork:coverArtwork,film:filmSettings},isCurrent:current});
      if(current()){setSettings(false);await load();}
    } catch(error) {if(current())setMutationError(memoryCreativeSaveError(error));}
    finally {saveLock.current=false;setSettingsBusy(false);}
  };

  const fmtDate = (d?: string | null) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
  };

  const retryMedia = () => { setMediaAttempt(value=>value+1); void load(); };

  if (loadError) return <SafeAreaView style={[st.safe, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}><Text style={{color:t.ink.primary,textAlign:'center'}}>{loadError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => {if(!viewerId)setAuthAttempt(value=>value+1);else void load();}} style={{ padding:16 }}><Text style={{color:t.ink.primary,fontWeight:'700'}}>Retry</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={()=>navigation.goBack()} style={{padding:12}}><Text style={{color:t.ink.secondary}}>Back to profile</Text></TouchableOpacity></SafeAreaView>;

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ink.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!album || (!album.is_owner && (!album.can_view || album.count === 0))) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={st.topBar}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to profile" onPress={() => navigation.goBack()} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}>
            <Feather name="chevron-left" size={26} color={t.ink.primary} />
          </TouchableOpacity>
          <Text style={st.topTitle}>Memory album</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Feather name="lock" size={22} color={t.ink.muted} />
          <Text style={{ marginTop: 10, fontSize: 13.5, color: t.ink.secondary, textAlign: 'center' }}>This album is private.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bookW = Math.min(screenWidth - 56, 340, (screenHeight-240)/1.31);
  const bookH = bookW * 1.31;
  const pageHeight = Math.max(160, Math.min(screenHeight*.64, screenHeight-Math.max(insets.top,12)-insets.bottom-160-(nextBook?44:0)));
  const page = pages[Math.min(idx, Math.max(pages.length - 1, 0))];
  const renderedReactionScope = reactionScope.current;
  const reactionKnown = !!page?.story_id && reactionRead.known.has(page.story_id);
  const reactionStatus = reactionRead.pending ? 'Loading reaction status' : 'Reaction status unavailable';
  const pageWidth=Math.min(screenWidth-40,440,pageHeight*.78);
  const coverScale = coverAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const coverFade = coverAnim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0, 0] });

  return (
    <View style={[st.safe, { paddingTop: Math.max(insets.top, 12), backgroundColor: t.surface.canvas }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <View style={st.topBar}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={opened ? 'Close memory book' : 'Back to profile'} onPress={() => (opened ? closeBook() : navigation.goBack())} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}>
          <Feather name="chevron-left" size={26} color={t.ink.primary} />
        </TouchableOpacity>
        <Text numberOfLines={1} style={[st.topTitle,{flex:1,textAlign:'center',marginHorizontal:12}]}>{album.title}</Text>
        {opened ? <View style={{flexDirection:'row',alignItems:'center',gap:12}}><TouchableOpacity accessibilityLabel={grid?'Read book':'View all pages'} onPress={()=>setGrid(v=>!v)} style={{minWidth:36,minHeight:44,alignItems:'center',justifyContent:'center'}}><Feather name={grid?'book-open':'grid'} size={20} color={t.ink.primary}/></TouchableOpacity>{album.is_owner&&<TouchableOpacity accessibilityLabel="Page options" onPress={pageMenu} style={{minWidth:30,minHeight:44,alignItems:'center',justifyContent:'center'}}><Feather name="more-horizontal" size={22} color={t.ink.primary}/></TouchableOpacity>}</View> : album.is_owner ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit memory book" onPress={openSettings} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}>
            <Feather name="settings" size={19} color={t.ink.primary} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
      </View>

      {album.is_owner&&viewerId&&<><TouchableOpacity accessibilityRole="button" accessibilityLabel="Book soundtrack" disabled={soundtrackSave.busy || soundtrackSave.needsConfirmation} onPress={()=>setMusicOpen(true)} style={{minHeight:44,alignSelf:'center',justifyContent:'center',paddingHorizontal:20}}><Text style={{color:t.ink.primary,fontWeight:'600'}}>Music</Text></TouchableOpacity><SoundtrackPicker visible={musicOpen} value={soundtrackSave.draft ? soundtrackSave.draft.selection : album.soundtrack??null} use="memory_album" ownerId={viewerId} originalAudio={false} onClose={()=>setMusicOpen(false)} onChange={selection=>{void soundtrackSave.save(selection);}}/></>}
      {soundtrackSave.busy ? <Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,paddingHorizontal:16}}>{soundtrackSave.draft?.retry === 'check' ? 'Checking saved soundtrack…' : 'Saving soundtrack…'}</Text> : soundtrackSave.error ? <View style={{paddingHorizontal:16,gap:6}}><Text accessibilityRole="alert" style={{color:t.ink.secondary}}>{soundtrackSave.error}</Text><TouchableOpacity accessibilityRole="button" style={{minHeight:44,justifyContent:'center'}} onPress={()=>void soundtrackSave.retry()}><Text style={{color:t.ink.primary,fontWeight:'600'}}>{soundtrackSave.needsConfirmation ? 'Check saved music' : 'Retry soundtrack save'}</Text></TouchableOpacity></View> : soundtrackSave.notice ? <Text accessibilityLiveRegion="polite" style={{color:t.ink.secondary,paddingHorizontal:16}}>{soundtrackSave.notice}</Text> : null}
      {!!mutationError&&!settings&&<Text style={{color:t.ink.secondary,paddingHorizontal:16}}>{mutationError}</Text>}
      {!!(music.error||pageAudio.error)&&opened&&<TouchableOpacity onPress={()=>{music.retry();pageAudio.retry();}}><Text style={{color:t.ink.secondary,paddingHorizontal:16}}>Soundtrack could not play. Tap to retry.</Text></TouchableOpacity>}
      {!opened ? (
        <ScrollView style={{flex:1}} contentContainerStyle={{flexGrow:1,alignItems:'center',justifyContent:'center',paddingTop:16,paddingBottom:24}}>
          <Animated.View style={{ transform: [{ scale: coverScale }], opacity: coverFade }}>
            <TouchableOpacity activeOpacity={0.92} onPress={openBook}>
              <MemoryBookCover artwork={album.cover_artwork} title={album.title} subtitle={album.subtitle} color={album.cover_color} design={album.cover_design} {...memoryCoverMedia(album.cover_page??memoryCoverPage(pages,album.cover_story_id))} width={bookW} height={bookH} />
            </TouchableOpacity>
          </Animated.View>
          <Text style={{fontFamily:Platform.OS==='ios'?'Georgia':'serif',fontSize:21,color:t.ink.primary,marginTop:22}}>{ownerName?'By '+ownerName:album.subtitle||album.title}</Text><Text style={{color:t.ink.secondary,fontSize:13,marginTop:7}}>{pages.length} {pages.length===1?'memory':'memories'}</Text><TouchableOpacity accessibilityRole="button" onPress={openBook} style={{width:bookW,marginTop:22,backgroundColor:'#142642',borderRadius:18,alignItems:'center',padding:15}}><Text style={{color:'#FFF',fontFamily:Platform.OS==='ios'?'Georgia':'serif',fontSize:20}}>Open book</Text></TouchableOpacity>
          {pages.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Play continuous memory film with original music" onPress={playBook} style={{width:bookW,marginTop:10,borderWidth:1,borderColor:t.surface.hairline,borderRadius:18,alignItems:'center',padding:15,flexDirection:'row',justifyContent:'center',gap:8}}><Feather name="play" size={18} color={t.ink.primary}/><Text style={{color:t.ink.primary,fontWeight:'700'}}>Play memories</Text></TouchableOpacity>}
          {album.is_owner ? (
            <TouchableOpacity onPress={openPicker} activeOpacity={0.9} style={[st.fab, { position: 'relative', bottom: 0, marginTop: 10, width:bookW, borderRadius:18, justifyContent:'center' }]}>
              <Feather name="plus" size={18} color={t.ink.inverse} />
              <Text style={st.fabTxt}>Add memories</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      ) : grid ? <ScrollView contentContainerStyle={{padding:18,paddingBottom:40}}><Text style={{fontSize:13,color:t.ink.secondary,textAlign:'center',marginBottom:20}}>{pages.length} pages · Select a page to read or edit</Text><View style={{flexDirection:'row',flexWrap:'wrap',gap:14}}>{pages.map((pg,i)=><TouchableOpacity key={pg.id} accessibilityLabel={'Open memory '+(i+1)} onPress={()=>{idxRef.current=i;setIdx(i);setGrid(false);}} style={{width:(screenWidth-50)/2,backgroundColor:PAGE_CREAM,borderLeftWidth:6,borderColor:artwork.spine,padding:10,shadowColor:'#000',shadowOpacity:.1,shadowRadius:5,shadowOffset:{width:0,height:3}}}><Text style={{fontFamily:Platform.OS==='ios'?'Georgia':'serif',color:'#142642',textAlign:'center',fontSize:10,marginBottom:10}}>{String(i+1).padStart(2,'0')}</Text><View style={{height:(screenWidth-50)/2*1.15,overflow:'hidden'}}><MemoryStoryTile story={pg}/></View><Text numberOfLines={2} style={{fontFamily:Platform.OS==='ios'?'Georgia':'serif',fontSize:13,color:'#142642',marginTop:10}}>{pg.caption||fmtDate(pg.taken_at)}</Text></TouchableOpacity>)}</View>{album.is_owner&&<TouchableOpacity onPress={openPicker} style={{padding:16,alignItems:'center',marginTop:20,borderWidth:1,borderStyle:'dashed',borderRadius:14,borderColor:t.surface.hairline}}><Text style={{color:t.ink.primary}}>+ Add memories</Text></TouchableOpacity>}</ScrollView> : (
        <View style={{ flex: 1, alignItems: 'center',overflow:'hidden' }}>
          <MemoryPageTurn ref={pageTurn} key={bookId} pageIds={pages.map(p=>p.id)} index={idx} width={pageWidth} height={pageHeight} active={focused&&!filmVisible&&!pageActions&&!settings&&!picker&&!captionFor&&!playingUrl} reduceMotion={reduceMotion} spine={artwork.spine} title={album.title} onCommit={i=>{idxRef.current=i;setIdx(i);}} onTurningChange={setTurning} renderPreview={i=><MemoryTurnPreview page={pages[i]??{}} index={i}/>}>
              <Text style={{textAlign:'center',fontFamily:Platform.OS==='ios'?'Georgia':'serif',fontSize:10,color:'#6F614A',marginBottom:12}}>{String(idx+1).padStart(2,'0')} ─</Text>
              {pages.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 }}>
                  <Text style={st.emptyTxt}>{album.is_owner ? 'This book is empty.\nAdd your first memory.' : 'No memories yet.'}</Text>
                  {album.is_owner ? (
                    <TouchableOpacity onPress={openPicker} style={[st.fab, { position: 'relative', bottom: 0, marginTop: 18 }]}>
                      <Feather name="plus" size={16} color={t.ink.inverse} /><Text style={st.fabTxt}>Add memories</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <View style={{flex:1,minHeight:0}}>
                  <View style={[st.polaroid, page?.style==='full'&&{padding:0,borderWidth:0}]}>
                    <View style={st.polImgWrap}>
                      {(() => { const stks = memoryStoryStickers(page?.stickers); const pk = stks.find((k) => k && k.kind === 'post'); if (pk) return (
                        <MemoryStoryFrame page={page}>{()=> <View style={{ flex: 1, backgroundColor: '#0E1B33', borderRadius: 6, padding: 12 }}>
                          <Text style={{ color: '#C9BFB0', fontSize: 11.5, fontWeight: '700', marginBottom: 6 }} numberOfLines={1}>{pk.postAuthorName || 'Shared post'}</Text>
                          {pk.postText ? <Text style={{ color: '#F5F0EB', fontSize: 13.5, lineHeight: 19 }} numberOfLines={4}>{pk.postText}</Text> : null}
                          {pk.postMediaUrl ? (pk.postMediaType === 'video' ? (
                            <TouchableOpacity activeOpacity={0.9} onPress={() => setPlayingUrl(pk.postMediaUrl)} style={{ marginTop: 8, flex: 1, minHeight: 150, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}><VideoThumb uri={pk.postMediaUrl} fill chip={false} /><View style={{ position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Feather name="play" size={19} color="#FFFFFF" /></View></TouchableOpacity>
                          ) : (
                            <StoryPixelImage uri={pk.postMediaUrl} style={{ marginTop: 8, flex: 1, minHeight: 150, borderRadius: 8 }} fit="contain" />
                          )) : null}
                          <TouchableOpacity disabled={!pk.postId} onPress={()=>navigation.push('PostTop',{postId:pk.postId})}><Text style={{ color: '#D8E2F0', fontSize: 12, marginTop: 8 }}>View full post →</Text></TouchableOpacity>
                        </View>}</MemoryStoryFrame>
                      ); if (page?.media_type === 'video') return (<View style={{ flex: 1 }}><PageVideo key={[page.id,page.media_url,mediaAttempt,playRun].join(':')} url={page.media_url??''} page={page} active={focused&&foreground&&!filmVisible&&(!playMode||playing)&&!turning&&!pageActions&&!settings&&!picker&&!captionFor&&!playingUrl} onRetry={retryMedia} onEnd={playMode ? finishPage : undefined} onProgress={setVideoProgress} /><TouchableOpacity accessibilityRole="button" accessibilityLabel="Open memory video full screen" hitSlop={6} disabled={!page.media_url} onPress={() => setPlayingUrl(page.media_url??null)} style={{ position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Feather name="maximize-2" size={15} color="#FFFFFF" /></TouchableOpacity></View>); if (page?.media_type === 'image' || page?.media_url || page?.thumbnail_url) return (
                        <MemoryStoryFrame key={[page.id,page.media_url,page.thumbnail_url,mediaAttempt,playRun].join(':')} page={page}>{({fit,style})=><Animated.View style={[style,{transform:[...(Array.isArray(style.transform)?style.transform:[]),{scale:motionScale}]}]}><MemoryPageImage uri={page.media_url} thumbnail={page.thumbnail_url} fit={fit} onRetry={retryMedia} onReady={()=>setReadyPage(page.id)} /></Animated.View>}</MemoryStoryFrame>
                      ); return (
                        <MemoryStoryFrame page={page}>{()=> <View style={{ flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', padding: 14 }}>
                          <Text style={{ color: '#F5F0EB', fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 }} numberOfLines={6}>{page?.story_caption || page?.caption || (memoryStoryStickers(page?.stickers).length ? '' : 'A moment')}</Text>
                        </View>}</MemoryStoryFrame>
                      ); })()}
                    </View>
                    <Text numberOfLines={2} style={st.handCaption}>{page?.caption || ' '}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                      <Text style={st.handDate}>{fmtDate(page?.taken_at)}</Text>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={reactionKnown ? undefined : reactionStatus} disabled={!reactionKnown} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.8} onPress={async () => {
                        if(!page?.story_id||!reactionKnown||reactionLock.current||reactionScope.current!==renderedReactionScope)return;
                        reactionLock.current=true;
                        const sid=page.story_id,viewer=viewerRef.current;
                        const current=()=>viewerRef.current===viewer&&reactionScope.current===renderedReactionScope;
                        try {
                          const {data,error}=await supabase.rpc('toggle_story_reaction',{p_story_id:sid,p_emoji:'❤️'});
                          if(error)throw error;
                          if(current()) {
                            renderedReactionScope.changes.set(sid,{revision:++renderedReactionScope.revision,reacted:!!data?.reacted});
                            setLikedPages(prev=>{const next=new Set(prev);if(data?.reacted)next.add(sid);else next.delete(sid);return next;});
                          }
                        } catch { if(current())setMutationError('Your reaction could not save. Try again.'); }
                        finally { reactionLock.current=false; }
                      }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: likedPages.has(page?.story_id??'') ? 'rgba(224,36,94,0.14)' : 'rgba(11,30,61,0.06)' }}><Feather name="heart" size={15} color={likedPages.has(page?.story_id??'') ? '#E0245E' : 'rgba(11,30,61,0.7)'} /><Text style={{ fontSize: 12, fontWeight: '700', color: likedPages.has(page?.story_id??'') ? '#E0245E' : 'rgba(11,30,61,0.7)' }}>{reactionKnown ? likedPages.has(page?.story_id??'') ? 'Liked' : 'Like' : reactionRead.pending ? 'Loading…' : 'Unavailable'}</Text></TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
          </MemoryPageTurn>

          {playMode && <View style={{width:pageWidth,marginTop:10}}><View accessibilityRole="progressbar" accessibilityLabel="Memory playback" accessibilityValue={{min:0,max:100,now:Math.round((playbackPage?.media_type==='video'?videoProgress:photoProgress)*100)}} style={{height:3,backgroundColor:t.surface.hairline,borderRadius:2,overflow:'hidden'}}><View style={{height:3,width:`${(playbackPage?.media_type==='video'?videoProgress:photoProgress)*100}%`,backgroundColor:t.ink.primary}}/></View></View>}
          {!!nextBook && idx>=pages.length-1 && <TouchableOpacity onPress={()=>navigation.replace('MemoryAlbum',{ownerId,albumId:nextBook})}><Text style={{color:t.ink.primary,padding:12,fontWeight:'700'}}>Next book →</Text></TouchableOpacity>}
          {pages.length > 0 ? (
            <View style={st.pagerRow}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous memory" onPress={() => flipTo(-1)} disabled={turning||idx === 0} style={[st.pagerBtn, idx === 0 && { opacity: 0.35 }]}>
                <Feather name="chevron-left" size={17} color={t.ink.primary} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Play continuous memory film" onPress={playBook} style={st.pagerBtn}><Feather name={playMode&&playing?'pause':'play'} size={17} color={t.ink.primary}/></TouchableOpacity>
              <View style={st.pagerPill}><Text accessibilityLiveRegion="polite" accessibilityLabel={`Page ${idx+1} of ${pages.length}`} style={st.pagerTxt}>{idx + 1} / {pages.length}</Text></View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next memory" onPress={() => flipTo(1)} disabled={turning||idx >= pages.length - 1} style={[st.pagerBtn, idx >= pages.length - 1 && { opacity: 0.35 }]}>
                <Feather name="chevron-right" size={17} color={t.ink.primary} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}

      {filmVisible && pages.length > 0 && <MemoryFilm key={`${bookId}:${viewerId}`} bookId={bookId??undefined} revision={album.presentation_revision} filmSettings={album.film_settings} title={album.title} pages={pages} soundtrack={album.soundtrack} active={focused} reduceMotion={reduceMotion} onClose={() => setFilmVisible(false)} onReadBook={() => { setFilmVisible(false); openBook(); }} onRetry={retryMedia} onPost={postId => { setFilmVisible(false); navigation.push('PostTop', { postId }); }} />}

      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <View style={[st.safe, { paddingTop: Math.max(insets.top, 12) }]}>
          <View style={st.topBar}>
            <TouchableOpacity onPress={() => setPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={22} color={t.ink.primary} />
            </TouchableOpacity>
            <Text style={st.topTitle}>Add from your stories</Text>
            <TouchableOpacity disabled={chosen.size === 0 || adding} onPress={addChosen}>
              {adding ? <ActivityIndicator size={16} color={t.ink.primary} /> : (
                <Text style={{ fontSize: 14, fontWeight: '800', color: chosen.size === 0 ? t.ink.secondary : t.ink.primary }}>Add{chosen.size > 0 ? ' ' + chosen.size : ''}</Text>
              )}
            </TouchableOpacity>
          </View>
          {!!mutationError&&<Text style={{color:t.ink.secondary,padding:12}}>{mutationError}</Text>}
          {!!storiesError&&<TouchableOpacity onPress={openPicker}><Text style={{color:t.ink.primary,padding:12}}>{storiesError}</Text></TouchableOpacity>}
          <FlatList
            data={myStories}
            keyExtractor={(s) => s.id}
            numColumns={3}
            contentContainerStyle={{ padding: 10, gap: 6, paddingBottom: 40 }}
            columnWrapperStyle={{ gap: 6 }}
            renderItem={({ item }) => {
              const on = chosen.has(item.id);
              const preview=[item.thumbnail_url,item.media_type!=='video'?item.media_url:null].find(uri=>uri&&!failedStoryPreviews.has(uri));
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.caption?.trim() || ((item.media_type === 'video' ? 'Video' : item.media_type === 'image' ? 'Photo' : 'Story') + ' from ' + fmtDate(item.created_at))}. ${item._in ? 'Already in this book' : on ? 'Selected' : 'Not selected'}`}
                  accessibilityState={{ selected: on || item._in, disabled: !!item._in || adding }}
                  disabled={item._in || adding}
                  onPress={() => setChosen(prev => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}
                  style={{ width: (screenWidth - 20 - 12) / 3, aspectRatio: 0.75, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0B1E3D', opacity: item._in ? 0.35 : 1 }}
                >
                  {item.media_type === 'video' && item.media_url ? <VideoThumb uri={item.media_url} posterUri={item.thumbnail_url} fill/> : preview ? (
                    <ExpoImage source={{ uri: preview }} onError={()=>setFailedStoryPreviews(prev=>new Set(prev).add(preview))} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                  ) : <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:12}}><Text numberOfLines={6} style={{color:'#FFFFFF',fontSize:12,textAlign:'center'}}>{item.media_type==='text'||(!item.media_url&&!item.thumbnail_url&&item.media_type!=='image'&&item.media_type!=='video') ? item.caption || 'Text story' : 'Preview unavailable'}</Text></View>}
                  {item.media_type === 'video' ? (
                    <View style={st.vidBadge}><Feather name="video" size={10} color="#FFF" /></View>
                  ) : null}
                  {item._in ? (
                    <View style={st.inChip}><Text style={st.inChipTxt}>In album</Text></View>
                  ) : on ? (
                    <View style={st.checkWrap}><Feather name="check" size={13} color="#FFFFFF" /></View>
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={storiesLoading?<ActivityIndicator/>:!storiesError?<Text style={{textAlign:'center',marginTop:50,fontSize:13,color:t.ink.secondary}}>No stories yet. Post a story first.</Text>:null}
          />
        </View>
      </Modal>

      <Modal visible={!!pageActions} transparent animationType="fade" onRequestClose={()=>setPageActions(null)} onDismiss={()=>{const action=pendingPageAction.current;pendingPageAction.current=null;void action?.();}}>
        <View style={st.sheetWrap}>
          <TouchableOpacity accessibilityLabel="Close page options" onPress={()=>setPageActions(null)} style={StyleSheet.absoluteFill}/>
          <View style={st.sheet}><Text style={st.sheetTitle}>Page options</Text>
            <ScrollView style={{flexGrow:0}}>{(pageActions??[]).map((action,i)=><TouchableOpacity key={i} accessibilityRole="button" onPress={()=>{if(Platform.OS==='ios')pendingPageAction.current=action.onPress??null;setPageActions(null);if(Platform.OS!=='ios')void action.onPress?.();}} style={{minHeight:48,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:t.surface.hairline}}><Text style={{fontSize:16,color:action.style==='destructive'?t.status.danger:t.ink.primary,fontWeight:action.style==='cancel'?'700':'400'}}>{action.text}</Text></TouchableOpacity>)}</ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={settings} transparent animationType="fade" onRequestClose={() => {if(!saveLock.current)setSettings(false);}}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Book settings</Text>
            <ScrollView scrollEnabled={!framing} style={{ flexGrow: 0 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput accessibilityLabel="Book title" value={title} onChangeText={setTitle} placeholder="Memories" placeholderTextColor={t.ink.muted} keyboardAppearance={isDark ? "dark" : "light"} style={st.input} maxLength={30} />
              <TextInput accessibilityLabel="Book subtitle" value={subtitle} onChangeText={setSubtitle} placeholder="A small line to remember it by" placeholderTextColor={t.ink.muted} keyboardAppearance={isDark ? "dark" : "light"} style={st.input} maxLength={120} />
              <View style={{alignItems:'center',paddingVertical:18}}><MemoryBookCover artwork={coverArtwork} title={title||'Memories'} subtitle={subtitle} color={color} design={design} {...draftCoverMedia} width={168} height={220}/></View>
              <Text style={st.lbl}>Cover memory</Text>
              {pages.length ? <ScrollView horizontal contentContainerStyle={{gap:10,paddingVertical:6}}>{pages.map((pg,i)=><TouchableOpacity key={pg.id} accessibilityLabel={'Use memory '+(i+1)+' on the cover'} accessibilityState={{selected:coverStoryId===pg.story_id}} onPress={()=>setCoverStoryId(pg.story_id??null)} style={{width:68,height:86,borderWidth:coverStoryId===pg.story_id?3:1,borderColor:coverStoryId===pg.story_id?t.ink.primary:t.surface.hairline,borderRadius:8,overflow:'hidden'}}><MemoryStoryTile story={pg}/></TouchableOpacity>)}</ScrollView> : <Text style={{color:t.ink.secondary,fontSize:13}}>Add memories to choose a photo or video cover.</Text>}
              <Text style={st.lbl}>Paper tint</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {Object.keys(COVER_COLORS).map(k => (
                  <TouchableOpacity key={k} accessibilityRole="button" accessibilityLabel={`${k} cover color`} accessibilityState={{selected:color===k}} onPress={() => setColor(k)}
                    style={{ width: 30, height: 38, borderRadius: 5, backgroundColor: COVER_COLORS[k].cover, borderWidth: color === k ? 2.5 : 1, borderColor: color === k ? '#0B1E3D' : 'rgba(11,30,61,0.15)' }} />
                ))}
              </View>
              <Text style={st.lbl}>Who can open it</Text>
              {AUDIENCES.map(a => (
                <TouchableOpacity key={a.key} onPress={() => setAud(a.key)} style={[st.audRow, aud === a.key && st.audRowOn]}>
                  <Text style={[st.audTxt, aud === a.key && { fontWeight: '800' }]}>{a.label}</Text>
                  {aud === a.key ? <Feather name="check" size={15} color={t.ink.primary} /> : null}
                </TouchableOpacity>
              ))}
              <MemoryCoverControls value={coverArtwork} onChange={setCoverArtwork} hasPhoto={!!(draftCoverMedia.photoUrl||draftCoverMedia.videoUrl)} disabled={settingsBusy} onDragStateChange={setFraming}/><MemoryFilmControls value={filmSettings} onChange={setFilmSettings} disabled={settingsBusy}/>
              <MemoryAudienceEditor ownerId={ownerId} />
              <Text style={st.lbl}>Cover design</Text>
              <ScrollView horizontal contentContainerStyle={{gap:14,padding:7}}>{MEMORY_DESIGNS.map(d=><TouchableOpacity key={d.id} accessibilityRole="button" accessibilityLabel={`${d.label} cover design`} accessibilityState={{selected:design===d.id}} onPress={()=>setDesign(d.id)} style={{opacity:design===d.id?1:.45}}><MemoryBookCover artwork={coverArtwork} title={title||'Memories'} subtitle={subtitle} color={color} design={d.id} {...draftCoverMedia} width={70} height={92}/><Text style={{color:t.ink.primary,fontSize:10,marginTop:6}}>{d.label}</Text></TouchableOpacity>)}</ScrollView>
              {!!mutationError&&<Text style={{color:t.ink.secondary,marginVertical:8}}>{mutationError}</Text>}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 14 }}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel memory book edits" disabled={settingsBusy} onPress={() => {if(!saveLock.current)setSettings(false);}} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text style={{ color: t.ink.secondary, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save memory book" disabled={settingsBusy} onPress={saveSettings} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text style={{ color: t.ink.primary, fontWeight: '800' }}>{settingsBusy?'Saving…':'Save'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      </Modal>

      {playingUrl ? (
        <MemoryVideo url={playingUrl} page={playingUrl===page?.media_url?page:null} topInset={Math.max(insets.top, 12)} onClose={() => setPlayingUrl(null)} onMessage={viewerId && ownerId && viewerId !== ownerId ? () => { setPlayingUrl(null); navigation.navigate('Chat', { userId: ownerId, userName: ownerName || undefined, otherUser: { id: ownerId, full_name: ownerName || '', username: ownerUsername || '', avatar_url: ownerAvatar || null } }); } : undefined} />
      ) : null}

      <Modal visible={!!captionFor} transparent animationType="fade" onRequestClose={() => setCaptionFor(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Caption</Text>
            {!!mutationError&&<Text style={{color:t.ink.secondary}}>{mutationError}</Text>}
            <TextInput value={captionText} onChangeText={setCaptionText} placeholder="Say something about this memory" placeholderTextColor={t.ink.muted} keyboardAppearance={isDark ? "dark" : "light"} style={[st.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline maxLength={140} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setCaptionFor(null)}><Text style={{ color: t.ink.secondary, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveCaption}><Text style={{ color: t.ink.primary, fontWeight: '800' }}>{settingsBusy?'Saving…':'Save'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function MemoryVideo({ url, page, topInset, onClose, onMessage }: { url: string; page?: MemoryStoryPage | null; topInset: number; onClose: () => void; onMessage?: () => void }) {
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <PageVideo url={url} page={page} active onRetry={onClose} controls />
        <View style={{ position: 'absolute', top: topInset + 6, right: 14, flexDirection: 'row', gap: 10 }}>
          {onMessage ? (
            <TouchableOpacity onPress={onMessage} style={{ height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: '#C9BFB0', flexDirection: 'row', alignItems: 'center', gap: 6 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Message">
              <Feather name="send" size={15} color="#0B1E3D" />
              <Text style={{ color: '#0B1E3D', fontSize: 13, fontWeight: '800' }}>Message</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity accessibilityLabel="Close memory video" onPress={onClose} style={{ position: 'absolute', top: topInset + 6, left: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const st = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { fontFamily:Platform.OS==='ios'?'Georgia':'serif', fontSize: 21, fontWeight: '500', color: t.ink.primary },
  polaroid: { flex: 1, backgroundColor: PAGE_CREAM, borderRadius: 0, padding: 4, paddingBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor:'#E3DAC8' },
  polImgWrap: { flex: 1, borderRadius: 4, overflow: 'hidden', backgroundColor: '#0B1E3D' },
  handCaption: { fontFamily:Platform.OS==='ios'?'Georgia':'serif', fontSize: 17, fontStyle: 'italic', fontWeight: '600', color: '#5a5140', marginTop: 12, minHeight: 20 },
  handDate: { fontSize: 11.5, fontStyle: 'italic', color: '#6F614A' },
  pagerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  pagerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface.canvas, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pagerPill: { backgroundColor: t.surface.canvas, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pagerTxt: { fontSize: 13, fontWeight: '800', color: t.ink.primary },
  emptyTxt: { fontSize: 13.5, color: '#5A5140', textAlign: 'center', lineHeight: 20 },
  fab: { position: 'absolute', bottom: 26, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: t.brand.base, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabTxt: { color: t.ink.inverse, fontSize: 13.5, fontWeight: '800' },
  vidBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2.5 },
  checkWrap: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#1D7A38', alignItems: 'center', justifyContent: 'center' },
  inChip: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
  inChipTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '700' },
  sheetWrap: { flex: 1, backgroundColor: t.surface.scrim, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  sheet: { alignSelf: 'stretch', backgroundColor: t.surface.canvas, borderRadius: 16, padding: 16, maxHeight: '82%' },
  sheetTitle: { fontFamily:Platform.OS==='ios'?'Georgia':'serif', fontSize: 23, fontWeight: '500', color: t.ink.primary, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: t.ink.primary, marginBottom: 12 },
  lbl: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: t.ink.secondary, marginBottom: 8, marginTop: 2 },
  audRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: t.surface.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  audRowOn: { borderColor: t.ink.primary, backgroundColor: t.brand.tintBg },
  audTxt: { fontSize: 13, color: t.ink.primary, flex: 1, marginRight: 8 },
  hint: { fontSize: 11.5, color: t.ink.secondary, marginBottom: 4 },
}));

function PageVideo({ url, page, active, onRetry, controls = false, onEnd, onProgress }: { url: string; page?: MemoryStoryPage | null; active:boolean; onRetry:()=>void; controls?:boolean; onEnd?:()=>void; onProgress?:(progress:number)=>void }) {
  // duration_sec can describe the selected excerpt; the player knows source duration.
  const recipe = useMemo(()=>memoryStoryRecipe(page?.media_transform),[page?.media_transform]);
  const pv = useVideoPlayer(url, pp => { pp.loop = true; pp.muted = true; pp.timeUpdateEventInterval = .05; });
  const [muted, setMuted] = React.useState(true);
  const [failed,setFailed]=useState(false);
  const [clock,setClock]=useState(recipe.start);
  const activeRef=useRef(active);activeRef.current=active;
  const completion=useRef({onEnd,onProgress,done:false});completion.current.onEnd=onEnd;completion.current.onProgress=onProgress;
  const advancesOnEnd=!!onEnd;
  useEffect(()=>{pv.loop=!advancesOnEnd;completion.current.done=false;},[pv,url,advancesOnEnd]);
  useEffect(()=>{
    let initialized=false;
    let window=recipe;
    const apply=()=>{try{window=memoryStoryRecipe({trimStart:recipe.start,trimEnd:recipe.end},pv.duration);pv.playbackRate=recipe.speed;pv.volume=recipe.volume;if(!initialized){pv.currentTime=window.start;setClock(window.start);initialized=pv.status==='readyToPlay';}}catch{}};
    apply();
    const status=pv.addListener('statusChange',({status})=>{setFailed(status==='error');if(status==='readyToPlay')apply();});
    const time=pv.addListener('timeUpdate',({currentTime})=>{
      if(!activeRef.current)return;
      if(window.end!=null)completion.current.onProgress?.(Math.max(0,Math.min(1,(currentTime-window.start)/(window.end-window.start))));
      if(completion.current.onEnd&&window.end!=null&&currentTime>=window.end-.025){try{pv.pause();}catch{}if(!completion.current.done){completion.current.done=true;completion.current.onEnd();}return;}
      const seek=memoryStorySeek(currentTime,window);
      try{if(seek!=null)pv.currentTime=seek;}catch{}
      setClock(seek??currentTime);
    });
    const ended=pv.addListener('playToEnd',()=>{if(activeRef.current&&completion.current.onEnd&&!completion.current.done){completion.current.done=true;completion.current.onProgress?.(1);completion.current.onEnd();}});
    setFailed(pv.status==='error');
    return()=>{status.remove();time.remove();ended.remove();};
  },[pv,recipe]);
  useEffect(()=>{try{pv.muted=muted||recipe.volume===0;pv.volume=recipe.volume;}catch{}},[pv,muted,recipe.volume]);
  useMemoryVideoLifecycle(pv,active);
  if(!url||failed)return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry memory video" onPress={onRetry} style={{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#0B1E3D',padding:16}}><Text style={{color:'#FFFFFF',textAlign:'center'}}>This memory video could not play. Tap to retry.</Text></TouchableOpacity>;
  return (
    <View style={{ width: '100%', height: '100%' }}>
      <MemoryStoryFrame page={page} clock={clock}>{({fit,style})=><VideoView player={pv} style={style} contentFit={fit} nativeControls={controls} />}</MemoryStoryFrame>
      {recipe.volume>0&&<TouchableOpacity onPress={() => setMuted(v=>!v)} style={{ position: 'absolute', left: 8, bottom: controls?54:8, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={muted ? 'Unmute original video sound' : 'Mute original video sound'}>
        <Feather name={muted ? 'volume-x' : 'volume-2'} size={15} color="#FFFFFF" />
      </TouchableOpacity>}
    </View>
  );
}

function useMemoryVideoLifecycle(player:ReturnType<typeof useVideoPlayer>,active:boolean){
  const {callState}=useCallContext();
  const intent=useRef({player,blocked:true,resume:true});
  if(intent.current.player!==player)intent.current={player,blocked:true,resume:true};
  useEffect(()=>{
    const sync=()=>{try{
      const allowed=active&&callState==='idle'&&AppState.currentState==='active';
      if(!allowed){if(!intent.current.blocked)intent.current.resume=player.playing;intent.current.blocked=true;player.pause();}
      else if(intent.current.blocked){intent.current.blocked=false;if(intent.current.resume)player.play();}
    }catch{}};
    sync();const sub=AppState.addEventListener('change',sync);
    return()=>sub.remove();
  },[player,active,callState]);
  useEffect(()=>()=>{try{player.pause();}catch{}},[player]);
}
