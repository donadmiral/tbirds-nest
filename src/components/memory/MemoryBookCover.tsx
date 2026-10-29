import React, {useId,useState} from 'react';
import {View,Text,Platform,type ViewStyle} from 'react-native';
import {Image} from 'expo-image';
import {LinearGradient} from 'expo-linear-gradient';
import {Feather} from '@expo/vector-icons';
import Svg,{Defs,Pattern,Rect,Path,Circle,Text as SvgText} from 'react-native-svg';
import VideoThumb from '../VideoThumb';
import {memoryArtwork,memoryDesign,memoryCoverDate,memoryCoverTitleSize} from '../../../shared/memoryBookDesign';
type Props={title:string;subtitle?:string|null;color?:string;design?:string;photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;takenAt?:string;width?:number;height?:number};
type Position={left:`${number}%`;top:`${number}%`};
const serif=Platform.OS==='ios'?'Didot':'serif';
const absolute={position:'absolute',left:0,right:0,top:0,bottom:0} as const;

function CoverPhoto({photoUrl,fallbackPhotoUrl,videoUrl,ink,scale,position={left:'50%',top:'50%'},monochrome=false}:{photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;ink:string;scale:number;position?:Position;monochrome?:boolean}){
 const [failed,setFailed]=useState<string[]>([]),src=[photoUrl,fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 return <>
  {src?<Image source={{uri:src}} contentFit="cover" contentPosition={position} style={{width:'100%',height:'100%'}} onError={()=>setFailed(prev=>[...prev.slice(-3),src])}/>:videoUrl?<VideoThumb uri={videoUrl} fill chip={false}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:ink+'30',margin:5*scale}}><Feather name="image" size={25*scale} color={ink+'80'}/><Text style={{fontFamily:serif,fontSize:9*scale,color:ink+'A0',marginTop:5*scale}}>{photoUrl?'Open to view':'Your memories'}</Text></View>}
  {monochrome&&<View pointerEvents="none" style={[absolute,{backgroundColor:'#888888',mixBlendMode:'saturation'}]}/>}
 </>;
}

/** Woven paper and cloth remain sharp at every shelf / tablet size. */
function Weave({id,cloth=false,scale}:{id:string;cloth?:boolean;scale:number}){
 const cell=Math.max(1.5,3*scale);
 return <Svg pointerEvents="none" style={absolute} width="100%" height="100%"><Defs><Pattern id={id} width={cell} height={cell} patternUnits="userSpaceOnUse"><Path d={`M0 .3 H${cell} M.4 0 V${cell}`} stroke={cloth?'#090807':'#7A6444'} strokeWidth={cloth?.45:.35} opacity={cloth?.20:.09}/><Path d={`M0 ${cell*.55} H${cell} M${cell*.55} 0 V${cell}`} stroke="#FFFDF2" strokeWidth=".4" opacity={cloth?.14:.27}/></Pattern></Defs><Rect width="100%" height="100%" fill={`url(#${id})`}/></Svg>;
}

/** These six layouts use the book's own authorized cover, including its real date. */
export default function MemoryBookCover({title,subtitle,color,design,photoUrl,fallbackPhotoUrl,videoUrl,takenAt,width=144,height=188}:Props){
 const d=memoryDesign(design),a=memoryArtwork(design,color),u=width/200,typeSize=memoryCoverTitleSize(title,design)*u,date=memoryCoverDate(takenAt),id=useId().replace(/:/g,''),longPostcard=title.trim().length>12;
 const dark=d.id==='editorial'||d.id==='night_film';
 const photo=(style:ViewStyle,position:Position={left:'50%',top:'50%'},auxiliary=false,monochrome=false)=><View style={[{position:'absolute',overflow:'hidden',backgroundColor:dark?'#343632':'#D5CDBA'},style]}><CoverPhoto photoUrl={photoUrl} fallbackPhotoUrl={fallbackPhotoUrl} videoUrl={auxiliary?undefined:videoUrl} ink={a.ink} scale={u} position={position} monochrome={monochrome}/></View>;
 const type={position:'absolute',fontFamily:serif,fontSize:typeSize,color:a.ink,includeFontPadding:false} as const;
 const small={position:'absolute',includeFontPadding:false} as const;
 return <View accessible accessibilityLabel={`${d.label} book cover: ${title}${subtitle?'. '+subtitle:''}`} style={{width,height,borderRadius:2*u,backgroundColor:a.paper,shadowColor:'#2C251B',shadowOpacity:.22,shadowRadius:7*u,shadowOffset:{width:2,height:5*u},elevation:5}}>
  <View style={{position:'absolute',left:0,top:0,bottom:0,width:12.4*u,backgroundColor:a.spine,borderTopLeftRadius:2*u,borderBottomLeftRadius:2*u,overflow:'hidden'}}><Weave id={id+'cloth'} cloth scale={u}/><LinearGradient colors={['#00000020','#ffffff20','#00000000','#00000035']} locations={[0,.24,.55,1]} start={{x:0,y:0}} end={{x:1,y:0}} style={absolute}/><View style={{position:'absolute',left:4*u,top:0,bottom:0,width:.7*u,backgroundColor:'#FFFFFF',opacity:.16}}/></View>
  <View pointerEvents="none" style={{position:'absolute',left:12.4*u,right:0,top:0,bottom:0,overflow:'hidden',borderWidth:.5,borderColor:'#493D2925',backgroundColor:a.paper}}>
   <Weave id={id+'paper'} scale={u}/>
   {d.id==='postcard'?<>
    <Text numberOfLines={longPostcard?2:1} adjustsFontSizeToFit minimumFontScale={.78} style={[type,{left:12*u,right:48*u,top:12*u,lineHeight:typeSize*.98}]}>{title}</Text>
    <Svg width={50*u} height={34*u} viewBox="0 0 54 37" style={{position:'absolute',right:6*u,top:17*u}}><Circle cx="15" cy="17" r="14" fill="none" stroke="#B64437" strokeWidth=".5"/><Circle cx="15" cy="17" r="12.7" fill="none" stroke="#B64437" strokeWidth=".3"/>{[7,12,17,22,27].map(y=><Path key={y} d={`M27 ${y} C35 ${y-4},44 ${y+4},54 ${y}`} fill="none" stroke="#B64437" strokeWidth=".45"/>)}<SvgText x="15" y="15" textAnchor="middle" fontSize="6" fill="#B64437">{date?.month??'KEPT'}</SvgText><SvgText x="15" y="23" textAnchor="middle" fontSize="6" fill="#B64437">{date?.year??'WITH LOVE'}</SvgText></Svg>
    {!!subtitle&&<Text numberOfLines={1} style={[small,{left:13*u,right:10*u,top:(longPostcard?72:44)*u,fontFamily:serif,fontSize:10*u,color:a.accent}]}>{subtitle}</Text>}
    {photo({left:11*u,right:10*u,top:(longPostcard?88:59)*u,bottom:24*u})}
    <View style={{position:'absolute',left:2*u,bottom:14*u,width:49*u,height:41*u,padding:5*u,backgroundColor:'#B9D5DF',transform:[{rotate:'-7deg'}],borderColor:'#638B9F80',borderWidth:.4*u}}><Text style={{fontSize:4.7*u,letterSpacing:1*u,color:'#285572'}}>MOMENT KEPT</Text><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6*u}}><Text style={{fontSize:8*u,color:'#285572'}}>MEM</Text><Feather name="send" size={9*u} color="#285572"/></View>{date&&<Text style={{fontSize:4.5*u,letterSpacing:.4*u,marginTop:4*u,color:'#285572'}}>{date.ticket}</Text>}</View>
    <Text style={[small,{right:10*u,bottom:9*u,fontSize:5.5*u,letterSpacing:.7*u,color:a.accent}]}>MEMORY BOOK</Text>
   </>:d.id==='editorial'?<>
    {photo(absolute,{left:'50%',top:'50%'},false,true)}<LinearGradient colors={['#0a0b0b66','#0a0b0b00']} start={{x:0,y:0}} end={{x:1,y:1}} style={absolute}/>
    <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={.75} style={[type,{left:10*u,right:12*u,top:9*u,lineHeight:typeSize*.85}]}>{title}</Text>{date&&<Text style={[small,{right:6*u,top:10*u,color:'#FAF6E9',fontSize:6*u}]}>{date.year}</Text>}
    {!!subtitle&&<Text numberOfLines={2} style={[small,{bottom:12*u,left:12*u,right:12*u,fontSize:7*u,color:a.ink,letterSpacing:.5*u}]}>{subtitle}</Text>}
   </>:d.id==='keepsake'||d.id==='classic'||d.id==='botanical'?<>
    {photo({left:38*u,right:32*u,top:'17%',height:'51%',borderWidth:2*u,borderColor:'#C7BAA1'})}
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.8} style={[type,{left:16*u,right:16*u,top:'74%',lineHeight:typeSize*1.02,textAlign:'center'}]}>{title}</Text>{!!subtitle&&<Text numberOfLines={2} style={[small,{left:16*u,right:16*u,bottom:12*u,fontFamily:serif,fontSize:7*u,color:a.accent,textAlign:'center'}]}>{subtitle}</Text>}
   </>:d.id==='field_notes'?<>
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.75} style={[type,{left:15*u,right:12*u,top:20*u,fontFamily:Platform.OS==='ios'?'Arial':'sans-serif',fontWeight:'800',fontSize:typeSize,letterSpacing:-.6*u,lineHeight:typeSize*1.03}]}>{title}</Text><Text style={[small,{left:16*u,top:61*u,fontSize:5*u,letterSpacing:1*u,color:a.ink}]}>A COLLECTION OF MOMENTS</Text>
    {photo({left:0,right:0,top:'27.5%',height:'42%'})}{photo({right:14*u,bottom:15*u,width:49*u,height:51*u,borderWidth:1*u,borderColor:'#EEE3BB'},{left:'90%',top:'95%'},true)}
    <Text numberOfLines={4} style={[small,{left:17*u,right:74*u,bottom:28*u,fontSize:5.8*u,letterSpacing:.8*u,lineHeight:8.7*u,color:a.ink,textTransform:'uppercase'}]}>{subtitle||'Out into the world'}{date?'\n'+date.month+' '+date.year:''}</Text>
   </>:d.id==='night_film'?<>
    {photo(absolute,{left:'50%',top:'65%'})}<LinearGradient colors={['#11110bf0','#11110b00']} locations={[0,.7]} start={{x:0,y:0}} end={{x:1,y:1}} style={absolute}/>
    <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={.75} style={[type,{left:12*u,right:43*u,top:12*u,lineHeight:typeSize*.86}]}>{title}</Text><Text numberOfLines={2} style={[small,{left:13*u,right:47*u,top:'37%',fontSize:5.5*u,lineHeight:7.7*u,letterSpacing:1*u,color:a.ink,textTransform:'uppercase'}]}>{subtitle||'Moments after hours'}{date?' / '+date.year:''}</Text>
    <View style={{position:'absolute',right:0,top:0,bottom:0,width:39*u,backgroundColor:'#171717',paddingLeft:8*u,paddingRight:5*u,paddingVertical:7*u,gap:5*u}}>{[0,1,2,3].map(n=><View key={n} style={{flex:1,overflow:'hidden'}}>{photo(absolute,{left:'50%',top:`${n*33}%`},true,true)}</View>)}<Svg style={{position:'absolute',left:2*u,top:0,bottom:0}} width={3*u} height="100%"><Defs><Pattern id={id+'film'} width={3*u} height={7*u} patternUnits="userSpaceOnUse"><Rect width={2*u} height={3*u} fill="#B4AA94" opacity=".65"/></Pattern></Defs><Rect width="100%" height="100%" fill={`url(#${id}film)`}/></Svg></View>
   </>:<>
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.75} style={[type,{left:9*u,width:115*u,top:8*u,lineHeight:typeSize*.86}]}>{title}</Text><View style={{position:'absolute',right:9*u,top:14*u,width:28*u,height:28*u,borderRadius:14*u,backgroundColor:'#ED542F',alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:5.6*u,lineHeight:7.3*u,letterSpacing:.5*u,color:'#FFF7E5',textAlign:'center'}}>{date?date.month+'\n'+date.year:'GOOD\nDAYS'}</Text></View>
    {photo({left:7*u,width:103*u,top:'40%',bottom:'7%'},{left:'15%',top:'65%'})}{photo({right:7*u,width:66*u,top:'23%',bottom:'22%'},{left:'88%',top:'30%'},true)}
    <Text numberOfLines={1} adjustsFontSizeToFit style={[small,{right:10*u,width:64*u,bottom:14*u,fontFamily:'Caveat_600SemiBold',fontSize:23*u,transform:[{rotate:'-11deg'}],color:'#4E4C23'}]}>{date?.signature||'Kept'}</Text>{!!subtitle&&<Text numberOfLines={1} style={[small,{left:8*u,width:102*u,bottom:5*u,fontSize:5.3*u,color:a.ink}]}>{subtitle}</Text>}
   </>}
   <LinearGradient pointerEvents="none" colors={['#00000022','#ffffff07','#00000000']} locations={[0,.045,.12]} start={{x:0,y:0}} end={{x:1,y:0}} style={absolute}/><View style={[absolute,{borderColor:'#FFF9E530',borderWidth:.6*u}]}/>
  </View>
 </View>;
}
