import React,{forwardRef,useCallback,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Animated,Easing,PanResponder,Platform,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {Image} from 'expo-image';
import {MemoryBookTurnMachine,memoryTurnDuration,memoryTurnProgress,memoryTurnShouldCommit,type MemoryTurn,type MemoryTurnDirection} from '../../../shared/memoryBookTurn';
import {memoryCoverMedia,type MemoryCoverPage} from '../../../shared/memoryBookDesign';
export type MemoryPageTurnHandle={turn:(direction:MemoryTurnDirection)=>void;cancel:()=>void};
type Props={pageIds:readonly string[];index:number;width:number;height:number;active:boolean;reduceMotion:boolean;spine:string;title:string;children:ReactNode;renderPreview:(index:number)=>ReactNode;onCommit:(index:number)=>void;onTurningChange:(turning:boolean)=>void};
const PAPER='#FBF6EC',serif=Platform.OS==='ios'?'Georgia':'serif';
export default forwardRef<MemoryPageTurnHandle,Props>(function MemoryPageTurn({pageIds,index,width,height,active,reduceMotion,spine,title,children,renderPreview,onCommit,onTurningChange},ref){
 const machine=useRef(new MemoryBookTurnMachine(pageIds,index)).current,progress=useRef(new Animated.Value(0)).current;
 const callbacks=useRef({onCommit,onTurningChange});callbacks.current={onCommit,onTurningChange};
 const live=useRef(true),gesture=useRef<{token:number;direction:MemoryTurnDirection}|null>(null);
 const pendingSettlement=useRef<(()=>void)|null>(null);
 const retireSettlement=useCallback(()=>{pendingSettlement.current?.();pendingSettlement.current=null;},[]);
 const [turn,setTurn]=useState<MemoryTurn|null>(null);
 const cancel=useCallback(()=>{retireSettlement();machine.cancel();gesture.current=null;progress.stopAnimation();progress.setValue(0);if(live.current){setTurn(null);callbacks.current.onTurningChange(false);}},[machine,progress,retireSettlement]);
 const identity=JSON.stringify(pageIds);
 useLayoutEffect(()=>{retireSettlement();progress.stopAnimation();machine.sync(JSON.parse(identity) as string[],index);if(!machine.turn){progress.setValue(0);setTurn(null);callbacks.current.onTurningChange(false);}},[identity,index,machine,progress,retireSettlement]);
 useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;retireSettlement();machine.cancel();progress.stopAnimation();};},[machine,progress,retireSettlement]);
 useLayoutEffect(()=>{if(!active)cancel();},[active,cancel]);
 useLayoutEffect(()=>{cancel();},[reduceMotion,width,height,cancel]);
 const settle=useCallback((current:MemoryTurn,commit:boolean)=>{
  if(!machine.settle(current.token))return;
  retireSettlement();
  const duration=memoryTurnDuration(current.progress,commit,reduceMotion);
  let done=false,timer:ReturnType<typeof setTimeout>|undefined;
  const dispose=()=>{done=true;if(timer!==undefined){clearTimeout(timer);timer=undefined;}if(pendingSettlement.current===dispose)pendingSettlement.current=null;};
  const finish=(finished:boolean,stopNative=false)=>{
   if(done)return;
   dispose();
   if(!live.current||machine.turn?.token!==current.token)return;
   // Retire both completion paths before stopping native work: stopAnimation
   // may itself deliver an interrupted callback synchronously or later.
   if(stopNative)progress.stopAnimation();
   const next=machine.finish(current.token,finished&&commit);
   if(next!==null)callbacks.current.onCommit(next);else{progress.setValue(0);setTurn(null);callbacks.current.onTurningChange(false);}
  };
  pendingSettlement.current=dispose;
  // The intended visual duration also bounds the control lock. A delayed
  // native callback cannot leave a completed or cancelled turn inaccessible.
  timer=setTimeout(()=>finish(true,true),duration);
  Animated.timing(progress,{toValue:commit?1:0,duration,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start(({finished})=>finish(finished));
 },[machine,progress,reduceMotion,retireSettlement]);
 const turnPage=useCallback((direction:MemoryTurnDirection)=>{if(!active)return;const next=machine.begin(direction);if(!next)return;progress.setValue(0);setTurn({...next});callbacks.current.onTurningChange(true);if(reduceMotion){const to=machine.finish(next.token,true);if(to!==null)callbacks.current.onCommit(to);}else settle(next,true);},[active,machine,progress,reduceMotion,settle]);
 useImperativeHandle(ref,()=>({turn:turnPage,cancel}),[turnPage,cancel]);
 const swipe=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>false,
  onMoveShouldSetPanResponder:(_event,g)=>active&&!machine.turn&&Math.abs(g.dx)>12&&Math.abs(g.dx)>Math.abs(g.dy)*1.4&&((g.dx<0&&index<pageIds.length-1)||(g.dx>0&&index>0)),
  onPanResponderGrant:(_event,g)=>{const direction:MemoryTurnDirection=g.dx<0?1:-1,next=machine.begin(direction,true);if(!next)return;gesture.current={token:next.token,direction};progress.setValue(0);setTurn({...next});callbacks.current.onTurningChange(true);},
  onPanResponderMove:(_event,g)=>{const drag=gesture.current;if(!drag)return;const value=memoryTurnProgress(g.dx,width,drag.direction);if(machine.move(drag.token,value))progress.setValue(value);},
  onPanResponderRelease:(_event,g)=>{const drag=gesture.current,current=machine.turn;gesture.current=null;if(!drag||current?.token!==drag.token)return;settle(current,memoryTurnShouldCommit(current.progress,g.vx,current.direction));},
  onPanResponderTerminate:()=>{const drag=gesture.current,current=machine.turn;gesture.current=null;if(drag&&current?.token===drag.token)settle(current,false);},
  onPanResponderTerminationRequest:()=>true,
 }),[active,index,pageIds.length,machine,progress,settle,width]);
 const forward=turn?.direction===1,angle=progress.interpolate({inputRange:[0,1],outputRange:forward?['0deg','-180deg']:['-180deg','0deg']});
 const innerWidth=width-18;
 const hinge=[{perspective:1400},{translateX:-innerWidth/2},{rotateY:angle},{translateX:innerWidth/2}];
 const foldShadow=progress.interpolate({inputRange:[0,.5,1],outputRange:[0,.24,0]});
 return <View style={{width,height,marginTop:10,borderRadius:3,backgroundColor:spine,paddingLeft:12,paddingRight:6,paddingTop:5,paddingBottom:6,shadowColor:'#251C1B',shadowOpacity:.22,shadowRadius:14,shadowOffset:{width:1,height:9},elevation:6}} {...swipe.panHandlers}>
  <View pointerEvents="none" style={[styles.paperEdge,{right:1,bottom:1,top:7,left:13}]}/><View pointerEvents="none" style={[styles.paperEdge,{right:3,bottom:3,top:5,left:13}]}/>
  <View style={{flex:1}}>
   {forward&&<View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>{renderPreview(turn.to)}</View>}
   {!reduceMotion&&<Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#251C1B',opacity:foldShadow}]}/>}
   <Animated.View pointerEvents={turn?'none':'auto'} accessibilityElementsHidden={!!turn} importantForAccessibility={turn?'no-hide-descendants':'auto'} style={[styles.live,{transform:forward&&!reduceMotion?hinge:undefined}]}>
    <View style={styles.content}>{children}</View>
    {forward&&!reduceMotion&&<Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#3C2A16',opacity:foldShadow}]}/>}
   </Animated.View>
   {turn&&!reduceMotion&&<Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{transform:hinge,zIndex:4}]}>
    {turn.direction===-1&&<View style={[StyleSheet.absoluteFill,{backgroundColor:PAPER,backfaceVisibility:'hidden'}]}>{renderPreview(turn.to)}</View>}
    <View style={[StyleSheet.absoluteFill,{backfaceVisibility:'hidden',transform:[{rotateY:'180deg'}],backgroundColor:'#F3EDDF',alignItems:'center',justifyContent:'center',borderRightWidth:1,borderColor:'#D5CBB8'}]}><Text numberOfLines={3} style={{fontFamily:serif,fontStyle:'italic',fontSize:19,color:'#AC9E87',textAlign:'center',maxWidth:'70%'}}>{title}</Text><Text style={{fontFamily:serif,fontSize:10,color:'#BCAE95',letterSpacing:2,marginTop:14}}>{String(turn.direction===1?turn.from+1:turn.to+1).padStart(2,'0')}</Text><View style={{position:'absolute',right:0,top:0,bottom:0,width:10,backgroundColor:'#A98F5520'}}/></View>
   </Animated.View>}
   <TouchableOpacity accessibilityLabel="Previous memory" disabled={index===0||!!turn||!active} style={styles.edgeL} onPress={()=>turnPage(-1)}/>
   <TouchableOpacity accessibilityLabel="Next memory" disabled={index>=pageIds.length-1||!!turn||!active} style={styles.edgeR} onPress={()=>turnPage(1)}/>
  </View>
 </View>;
});
/** A paper preview uses images and text only; it never mounts a media player. */
export function MemoryTurnPreview({page,index}:{page:MemoryCoverPage;index:number}){
 const media=memoryCoverMedia(page),[failed,setFailed]=useState<string[]>([]),src=[media.photoUrl,media.fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 return <View style={styles.content}><Text style={styles.number}>{String(index+1).padStart(2,'0')} ─</Text><View style={{flex:1,minHeight:0,borderWidth:4,borderColor:'#FFFAF2',backgroundColor:'#EEE8DB',alignItems:'center',justifyContent:'center'}}>{src?<Image source={{uri:src}} style={{width:'100%',height:'100%'}} contentFit="contain" onError={()=>setFailed(values=>[...values,src])}/>:<Text numberOfLines={6} style={{fontFamily:serif,fontSize:17,lineHeight:24,color:'#74664E',textAlign:'center',padding:20}}>{page.media_type==='video'?'Video memory':page.story_caption||page.caption||'A memory'}</Text>}</View><Text numberOfLines={2} style={{fontFamily:serif,fontSize:16,color:'#24334B',textAlign:'center',marginTop:15}}>{page.caption}</Text></View>;
}
const styles=StyleSheet.create({
 paperEdge:{position:'absolute',borderWidth:1,borderColor:'#D5CBB8',backgroundColor:'#F4EBDD',borderRadius:2},
 live:{...StyleSheet.absoluteFillObject,zIndex:3,backgroundColor:PAPER,backfaceVisibility:'hidden'},
 content:{flex:1,minHeight:0,paddingHorizontal:18,paddingTop:15,paddingBottom:18,backgroundColor:PAPER},
 number:{fontFamily:serif,fontSize:10,color:'#98765A',textAlign:'center',letterSpacing:1,marginBottom:14},
 edgeL:{position:'absolute',zIndex:8,left:0,top:'20%',bottom:'32%',width:27},
 edgeR:{position:'absolute',zIndex:8,right:0,top:'20%',bottom:'32%',width:27},
});
