import React, {useState} from 'react';
import { View, Text, Platform, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import VideoThumb from '../VideoThumb';
import { memoryArtwork, memoryDesign, memoryCoverTitleSize } from '../../../shared/memoryBookDesign';
type Props = { title: string; subtitle?: string | null; color?: string; design?: string; photoUrl?: string; fallbackPhotoUrl?: string; videoUrl?: string; width?: number; height?: number };
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';
function CoverPhoto({photoUrl,fallbackPhotoUrl,videoUrl,ink,scale}:{photoUrl?:string;fallbackPhotoUrl?:string;videoUrl?:string;ink:string;scale:number}) {
 const [failed,setFailed]=useState<string[]>([]);
 const src=[photoUrl,fallbackPhotoUrl].find(url=>url&&!failed.includes(url));
 if(src)return <Image source={{uri:src}} contentFit="cover" style={{width:'100%',height:'100%'}} onError={()=>setFailed(prev=>[...prev.slice(-3),src])}/>;
 if(videoUrl)return <VideoThumb uri={videoUrl} fill chip={false}/>;
 return <View style={{flex:1,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:ink+'30',margin:5*scale}}><Feather name="image" size={25*scale} color={ink+'80'}/><Text style={{fontFamily:serif,fontSize:9*scale,color:ink+'A0',marginTop:5*scale}}>{photoUrl?'Open to view':'Your memories'}</Text></View>;
}
/** Actual cover layouts using already-authorized book media. */
export default function MemoryBookCover({ title, subtitle, color, design, photoUrl, fallbackPhotoUrl, videoUrl, width = 144, height = 188 }: Props) {
 const d=memoryDesign(design), a=memoryArtwork(design,color), u=width/200, dark=d.id==='editorial'||d.id==='night_film',titleSize=memoryCoverTitleSize(title,design)*u;
 const photo=(extra:ViewStyle={})=><View style={[{position:'absolute',overflow:'hidden',backgroundColor:dark?'#343632':'#D5CDBA'},extra]}>
  <CoverPhoto photoUrl={photoUrl} fallbackPhotoUrl={fallbackPhotoUrl} videoUrl={videoUrl} ink={a.ink} scale={u}/>
 </View>;
 return <View accessible accessibilityLabel={d.label+' book cover: '+title+(subtitle?'. '+subtitle:'')} style={{width,height,borderRadius:2*u,backgroundColor:a.paper,shadowColor:'#2C251B',shadowOpacity:.22,shadowRadius:7*u,shadowOffset:{width:2,height:5*u},elevation:5}}>
  <View style={{position:'absolute',left:0,top:0,bottom:0,width:12*u,backgroundColor:a.spine,borderTopLeftRadius:2*u,borderBottomLeftRadius:2*u}}/>
  <View style={{position:'absolute',left:5*u,top:0,bottom:0,width:2*u,backgroundColor:'#FFFFFF',opacity:.12}}/>
  <View style={{position:'absolute',left:12*u,right:0,top:0,bottom:0,overflow:'hidden',borderWidth:.6,borderColor:'#493D2925'}}>
   {dark?<>
    {photo({left:0,right:0,top:0,bottom:0})}<View style={{position:'absolute',left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(0,0,0,.35)'}}/>
    <Text numberOfLines={3} adjustsFontSizeToFit style={{position:'absolute',left:12*u,right:(d.id==='night_film'?40:14)*u,top:12*u,fontFamily:serif,fontSize:titleSize,lineHeight:titleSize*1.05,color:a.ink}}>{title}</Text>
    {!!subtitle&&<Text numberOfLines={2} style={{position:'absolute',left:14*u,right:15*u,bottom:14*u,fontSize:8*u,letterSpacing:1.2*u,color:a.ink}}>{subtitle}</Text>}
    {d.id==='night_film'&&<View style={{position:'absolute',right:0,top:0,bottom:0,width:31*u,backgroundColor:'#171717',paddingHorizontal:5*u,paddingVertical:7*u,gap:5*u}}>{[0,1,2].map(n=><View key={n} style={{flex:1,borderLeftWidth:2,borderColor:'#B7AA8B77'}}>{photo({left:3*u,right:0,top:0,bottom:0})}</View>)}</View>}
   </>:d.id==='keepsake'||d.id==='botanical'||d.id==='classic'?<>
    {photo({left:33*u,right:23*u,top:height*.18,height:height*.49,borderWidth:3*u,borderColor:'#C8BCA3'})}
    <Text numberOfLines={2} adjustsFontSizeToFit style={{position:'absolute',left:16*u,right:16*u,top:height*.70,fontFamily:serif,fontSize:titleSize,lineHeight:titleSize*1.05,textAlign:'center',color:a.ink}}>{title}</Text>
    {!!subtitle&&<Text numberOfLines={2} style={{position:'absolute',left:18*u,right:18*u,bottom:12*u,fontFamily:serif,fontSize:9*u,textAlign:'center',color:a.accent}}>{subtitle}</Text>}
   </>:d.id==='field_notes'?<>
    <Text numberOfLines={2} adjustsFontSizeToFit style={{position:'absolute',left:15*u,right:12*u,top:18*u,fontSize:titleSize,lineHeight:titleSize*1.05,fontWeight:'800',color:a.ink}}>{title}</Text>
    {photo({left:0,right:0,top:height*.29,height:height*.47})}
    <Text numberOfLines={3} style={{position:'absolute',left:16*u,right:16*u,bottom:18*u,fontSize:8*u,letterSpacing:1*u,color:a.ink}}>{subtitle||'A COLLECTION OF MOMENTS'}</Text>
   </>:d.id==='daybook'?<>
    <Text numberOfLines={2} adjustsFontSizeToFit style={{position:'absolute',left:12*u,right:15*u,top:8*u,fontFamily:serif,fontSize:titleSize,lineHeight:titleSize*1.05,color:a.ink}}>{title}</Text>
    {photo({left:9*u,width:96*u,top:height*.48,bottom:20*u})}{photo({right:8*u,width:65*u,top:height*.39,bottom:height*.19})}
    <Text numberOfLines={2} style={{position:'absolute',right:10*u,width:65*u,bottom:10*u,fontFamily:serif,fontStyle:'italic',fontSize:12*u,color:a.ink}}>{subtitle||'The good days'}</Text>
   </>:<>
    <Text numberOfLines={2} adjustsFontSizeToFit style={{position:'absolute',left:12*u,right:16*u,top:12*u,fontFamily:serif,fontSize:titleSize,lineHeight:titleSize*1.05,color:a.ink}}>{title}</Text>
    {!!subtitle&&<Text numberOfLines={1} style={{position:'absolute',left:13*u,right:12*u,top:height*.30,fontFamily:serif,fontSize:11*u,color:a.accent}}>{subtitle}</Text>}
    {photo({left:10*u,right:10*u,top:height*(subtitle ? .38 : .30),bottom:24*u})}
    <View style={{position:'absolute',left:8*u,bottom:9*u,width:44*u,height:38*u,backgroundColor:'#BDD5DF',transform:[{rotate:'-7deg'}],padding:5*u}}><Feather name="send" size={12*u} color={a.accent}/><Text style={{fontSize:5.5*u,letterSpacing:1*u,color:a.accent,marginTop:4*u}}>MOMENTS KEPT</Text></View>
    <Text style={{position:'absolute',right:10*u,bottom:7*u,fontSize:6*u,letterSpacing:1*u,color:a.accent}}>VOL. 01</Text>
   </>}
   <View pointerEvents="none" style={{position:'absolute',left:0,top:0,bottom:0,width:5*u,backgroundColor:'#0000000B'}}/>
  </View>
 </View>;
}
