import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Modal,Platform,StyleSheet,Text,TouchableOpacity,useWindowDimensions,View} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import {captureRef,releaseCapture} from 'react-native-view-shot';
import {memoryMovieCompositionAvailable} from '../../../modules/boomerang/memoryComposition';
import {memoryMovieContentStamp,type MemoryMovieSnapshot} from '../../../shared/memoryMovieAccess';
import {planMemoryMovie} from '../../../shared/memoryMoviePlan';
import {useCallContext} from '../../contexts/CallContext';
import {useNativeModalDismissal} from '../../hooks/useNativeModalDismissal';
import {exportNativeMemoryMovie,type NativeMemoryCapture,type NativeMemoryProgress} from '../../services/memoryMovieExport';
import {memoryMovieStep} from '../../services/memoryMovieFiles';
import {SUPABASE_URL} from '../../services/supabase';
import {useSafeAreaInsets} from '../SafeArea';
import StoryPixelImage,{StoryPhotoReadinessContext,type StoryPhotoReadiness} from '../stories/StoryPixelImage';
import MemoryStoryFrame from './MemoryStoryFrame';

type Movie=Awaited<ReturnType<typeof exportNativeMemoryMovie>>;
type CaptureState=NativeMemoryCapture&{key:number};
export default function MemoryMovieExport({bookId,expected,originalAudio,scoreVolume,reduceMotion,onClose}:{bookId?:string;expected:MemoryMovieSnapshot;originalAudio:boolean;scoreVolume:number|null;reduceMotion:boolean;onClose:()=>void}){
 const {width,height}=useWindowDimensions(),insets=useSafeAreaInsets(),{callState}=useCallContext(),canvasWidth=Math.max(90,Math.min(320,width-48,(height-Math.max(20,insets.top)-Math.max(24,insets.bottom)-230)*9/16)),canvasHeight=canvasWidth*16/9;
 const [capture,setCapture]=useState<CaptureState|null>(null),[progress,setProgress]=useState<NativeMemoryProgress|null>(null),[error,setError]=useState(''),[movie,setMovie]=useState<Movie|null>(null),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
 const dismissal=useNativeModalDismissal(bookId);
 const canvas=useRef<View>(null),sequence=useRef(0),readiness=useRef(new Map<string,StoryPhotoReadiness>()),layout=useRef(0),textOverflow=useRef(false),scope=useRef<AbortController|null>(null),result=useRef<Movie|null>(null),busy=useRef(false),permissionPrompt=useRef(false);
 const report=useCallback((id:string,status:StoryPhotoReadiness)=>{if(status==='removed')readiness.current.delete(id);else readiness.current.set(id,status);},[]);
 let stamp='',snapshotProblem='';
 try{stamp=memoryMovieContentStamp(expected,SUPABASE_URL);}catch{snapshotProblem='This book’s artwork could not be read. Reopen the book before creating its movie.';}
 const current=useRef({stamp,bookId});current.current={stamp,bookId};
 const dispose=useCallback(()=>{scope.current?.abort();scope.current=null;result.current?.release();result.current=null;},[]);
 const close=()=>dismissal.dismiss(onClose,dispose);
 useEffect(()=>()=>dispose(),[dispose]);
 useEffect(()=>{dispose();setMovie(null);setProgress(null);setCapture(null);},[stamp,bookId,dispose]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if((state==='background'||state!=='active'&&!permissionPrompt.current)&&scope.current){setError('Export stopped while the app was interrupted. Keep this screen open and retry.');dispose();setMovie(null);}});return()=>sub.remove();},[dispose]);
 useEffect(()=>{if(callState!=='idle'&&scope.current){setError('Export stopped for the call. Retry after it finishes.');dispose();setMovie(null);}},[callState,dispose]);
 const captureFrame=useCallback(async(value:NativeMemoryCapture,signal:AbortSignal)=>{
  const key=++sequence.current;readiness.current.clear();textOverflow.current=false;layout.current=0;setCapture({...value,key});
  await memoryMovieStep(new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),signal,'The memory canvas did not appear.');
  const deadline=Date.now()+12000;
  while(layout.current!==key||[...readiness.current.values()].some(status=>status==='loading')){
   if(Date.now()>deadline)throw new Error('A memory photo did not finish rendering. Reopen the book and retry.');
   await memoryMovieStep(new Promise<void>(resolve=>setTimeout(resolve,40)),signal,'A memory photo did not finish rendering.');
  }
  if([...readiness.current.values()].some(status=>status==='error'))throw new Error('A memory photo could not be rendered. No blank movie was saved.');
  if(textOverflow.current)throw new Error('A memory’s writing does not fit the movie frame. Shorten it before exporting.');
  // Decode readiness can precede the Skia/native image's painted frame.
  await memoryMovieStep(new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),signal,'The prepared memory artwork did not paint.');
  const work=captureRef(canvas,{format:'png',quality:1,result:'tmpfile',width:720,height:1280,handleGLSurfaceViewOnAndroid:true});
  let accepted=false,abandoned=false;void work.then(uri=>{if((signal.aborted||abandoned)&&!accepted)releaseCapture(uri);},()=>{});
  try{const uri=await memoryMovieStep(work,signal,'A memory page could not be captured.');if(signal.aborted){releaseCapture(uri);throw new Error('Memory movie export was cancelled.');}accepted=true;return uri;}catch(error){abandoned=true;throw error;}
 },[]);
 const create=async()=>{
  if(dismissal.isDismissing()||busy.current||!bookId||snapshotProblem)return;busy.current=true;dispose();setMovie(null);setSaved(false);setError('');setProgress({message:'Checking your book and media access…',percent:0});
  const abort=new AbortController(),identity={stamp,bookId};scope.current=abort;
  const live=()=>scope.current===abort&&!abort.signal.aborted&&current.current.stamp===identity.stamp&&current.current.bookId===identity.bookId;
  try{
   const prepared=await exportNativeMemoryMovie({bookId,expected,originalAudio,scoreVolume,reduceMotion,signal:abort.signal,capture:captureFrame,
    progress:value=>{if(live())setProgress(value);},onInvalid:failure=>{if(scope.current===abort){abort.abort(failure);setError(failure.message);setMovie(null);result.current?.release();result.current=null;}}});
   if(!live()){prepared.release();return;}result.current=prepared;setMovie(prepared);setCapture(null);
  }catch(failure){if(scope.current===abort){const reason=abort.signal.reason instanceof Error?abort.signal.reason:failure;setError(reason instanceof Error?reason.message:'The memory movie could not be created. Your book is kept.');setCapture(null);}}
  finally{busy.current=false;if(scope.current===abort)setProgress(null);}
 };
 const save=async()=>{
  const prepared=result.current,abort=scope.current;if(dismissal.isDismissing()||!prepared||!abort||busy.current||abort.signal.aborted)return;busy.current=true;setSaving(true);setError('');
  try{
   await prepared.assertRights();permissionPrompt.current=true;let permission:Awaited<ReturnType<typeof MediaLibrary.requestPermissionsAsync>>;try{permission=await MediaLibrary.requestPermissionsAsync(true);}finally{permissionPrompt.current=false;}
   if(!permission.granted)throw new Error('Allow Photos access to save this memory movie.');
   await prepared.assertRights();if(result.current!==prepared||scope.current!==abort||abort.signal.aborted)throw new Error('Memory movie export was cancelled.');
   await MediaLibrary.saveToLibraryAsync(prepared.result.uri);
   if(result.current===prepared){prepared.release();result.current=null;setMovie(null);setSaved(true);}
  }catch(failure){if(scope.current===abort)setError(failure instanceof Error?failure.message:'The movie could not be saved to Photos.');}
  finally{busy.current=false;setSaving(false);}
 };
 let count=0;try{count=planMemoryMovie(expected.pages,expected.filmSettings).selectedCount;}catch{}
 const titleCard=capture?.item.movie.titleCard,scale=canvasWidth/390;
 return <Modal visible={dismissal.visible} animationType={reduceMotion?'none':'slide'} presentationStyle="fullScreen" onRequestClose={close} onDismiss={dismissal.onDismiss}>
  <View style={[s.root,{paddingTop:Math.max(20,insets.top),paddingBottom:Math.max(24,insets.bottom)}]}>
   <View style={s.header}><Text style={s.title}>Your memory movie</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close movie export" onPress={close} style={s.button}><Text style={s.secondary}>{progress?'Cancel':'Close'}</Text></TouchableOpacity></View>
   <Text style={s.description}>{expected.title} · {count} {count===1?'memory':'memories'}</Text>
   <View style={s.preview}>
    {capture?<StoryPhotoReadinessContext.Provider value={report}><View ref={canvas} key={capture.key} collapsable={false} style={{width:canvasWidth,height:canvasHeight,backgroundColor:capture.layer==='overlay'?'transparent':'#142642'}} onLayout={()=>{layout.current=capture.key;}}>
     <MemoryStoryFrame page={capture.item.page} clock={capture.clock} layer={capture.layer} exporting>{({fit,style})=>capture.item.kind==='image'&&capture.item.uri?<StoryPixelImage uri={capture.item.uri} fit={fit} style={style}/>:capture.item.kind==='text'?<View style={[s.textPage,{padding:28*scale,backgroundColor:titleCard?'#142642':undefined}]}><Text style={{color:'#fff',fontFamily:titleCard?(Platform.OS==='ios'?'Georgia':'serif'):undefined,fontSize:(titleCard?32:26)*scale,lineHeight:(titleCard?42:36)*scale,textAlign:'center'}} onTextLayout={event=>{if(event.nativeEvent.lines.reduce((height,line)=>height+line.height,0)>canvasHeight-56*scale)textOverflow.current=true;}}>{capture.item.excerpt||capture.item.page.story_caption||capture.item.page.caption||''}</Text></View>:null}</MemoryStoryFrame>
     {capture.layer==='overlay'&&(capture.item.page.caption&&capture.item.kind!=='text'||capture.item.author)?<View style={{position:'absolute',left:18*scale,right:18*scale,bottom:20*scale,padding:12*scale,backgroundColor:'#00000099',borderRadius:8*scale}}>{capture.item.page.caption&&capture.item.kind!=='text'?<Text style={{fontSize:15*scale,lineHeight:21*scale,color:'#fff',textAlign:'center'}} onTextLayout={event=>{if(event.nativeEvent.lines.reduce((height,line)=>height+line.height,0)>canvasHeight*.22)textOverflow.current=true;}}>{capture.item.page.caption}</Text>:null}{capture.item.author?<Text style={{fontSize:11*scale,color:'#e1e6ec',textAlign:'center',marginTop:4*scale}}>Shared from {capture.item.author}</Text>:null}</View>:null}
    </View></StoryPhotoReadinessContext.Provider>:<View style={[s.readyCard,{width:canvasWidth,height:Math.min(canvasHeight,380)}]}><Text style={s.eyebrow}>MEMORIES</Text><Text style={s.bookTitle}>{expected.title}</Text><Text style={s.description}>{saved?'Saved to Photos':movie?`${Math.round(movie.result.duration)} seconds · MP4`:'A film of your saved moments'}</Text></View>}
   </View>
   {!!(snapshotProblem||error)&&<Text accessibilityRole="alert" style={s.error}>{snapshotProblem||error}</Text>}
   {!memoryMovieCompositionAvailable?<Text style={s.description}>Saving a whole memory movie needs the new {Platform.OS==='android'?'Android':'iPhone'} build. Your book and soundtrack are kept.</Text>:!bookId?<Text style={s.error}>Reopen the saved book before making a movie.</Text>:progress?<View accessibilityRole="progressbar" accessibilityValue={{min:0,max:100,now:progress.percent}} style={s.status}><ActivityIndicator color="#eadcc2"/><Text style={s.description}>{progress.message}</Text></View>:movie?<TouchableOpacity disabled={saving} accessibilityRole="button" onPress={()=>void save()} style={s.primary}><Text style={s.primaryText}>{saving?'Saving to Photos…':'Save movie to Photos'}</Text></TouchableOpacity>:<TouchableOpacity disabled={!!snapshotProblem} accessibilityRole="button" onPress={()=>void create()} style={s.primary}><Text style={s.primaryText}>{saved?'Create another movie':'Create memory movie'}</Text></TouchableOpacity>}
   <Text style={s.hint}>Keep this screen open while the movie is prepared. Your cover, book and saved memories stay editable.</Text>
  </View>
 </Modal>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#070b10',paddingHorizontal:24},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:22,color:'#fff',fontWeight:'600'},button:{minHeight:44,paddingHorizontal:10,justifyContent:'center'},secondary:{color:'#eadcc2',fontSize:15},description:{color:'#bac5d4',fontSize:14,lineHeight:20,textAlign:'center'},preview:{flex:1,minHeight:100,alignItems:'center',justifyContent:'center',overflow:'hidden',marginVertical:16},readyCard:{backgroundColor:'#142642',borderColor:'#e8d8b9',borderWidth:1,alignItems:'center',justifyContent:'center',padding:30,gap:20},eyebrow:{color:'#e8d8b9',letterSpacing:4,fontSize:11},bookTitle:{color:'#fff',fontFamily:Platform.OS==='ios'?'Georgia':'serif',fontSize:32,textAlign:'center'},textPage:{flex:1,alignItems:'center',justifyContent:'center'},primary:{backgroundColor:'#eadcc2',borderRadius:24,minHeight:50,alignItems:'center',justifyContent:'center',padding:12},primaryText:{color:'#142642',fontSize:16,fontWeight:'700'},error:{color:'#ffc4b8',fontSize:14,lineHeight:20,textAlign:'center',marginVertical:10},hint:{color:'#8f9caf',fontSize:12,lineHeight:18,textAlign:'center',marginTop:14},status:{minHeight:50,gap:10,alignItems:'center'}});
