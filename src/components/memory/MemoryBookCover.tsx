import React from 'react';
import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { memoryColors, memoryDesign } from '../../../shared/memoryBookDesign';

export default function MemoryBookCover({ title, color, design, width = 62, height = 78 }: { title: string; color?: string; design?: string; width?: number; height?: number }) {
  const c = memoryColors(color), d = memoryDesign(design), unit = width / 62;
  const serif = ['editorial','classic','field_notes'].includes(d.id);
  return <View accessible accessibilityLabel={`${d.label} book cover: ${title}`} style={{ width, height, borderRadius: 8 * unit, backgroundColor: c.spine, padding: 3 * unit, paddingLeft: 7 * unit, shadowColor: '#000', shadowOpacity: .13, shadowRadius: 4 * unit, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
    <View style={{ flex: 1, overflow: 'hidden', borderRadius: 5 * unit, backgroundColor: c.cover, borderWidth: d.id === 'editorial' ? 0 : 1, borderStyle: ['keepsake','postcard','field_notes'].includes(d.id) ? 'dashed' : 'solid', borderColor: c.text + '50', alignItems: 'center', justifyContent: 'center', padding: 4 * unit }}>
      {d.id === 'night_film' && [0,1,2,3,4].map(i => <View key={i} style={{ position:'absolute', left:2*unit, top:(6+i*12)*unit,width:3*unit,height:5*unit,backgroundColor:c.text,opacity:.25 }}/>) }
      {d.id === 'daybook' && [0,1,2,3,4,5].map(i => <View key={i} style={{position:'absolute',left:0,right:0,top:(10+i*10)*unit,height:1,backgroundColor:c.spine,opacity:.6}}/>)}
      {d.id === 'postcard' && <View style={{ position:'absolute',right:3*unit,top:3*unit,width:10*unit,height:12*unit,borderWidth:1,borderStyle:'dashed',borderColor:c.text,opacity:.5 }}/>} 
      {d.id === 'botanical' && <><Feather name="feather" size={32*unit} color={c.spine} style={{position:'absolute',top:0,left:-8*unit,transform:[{rotate:'-28deg'}]}}/><Feather name="feather" size={28*unit} color={c.spine} style={{position:'absolute',bottom:0,right:-7*unit,transform:[{rotate:'160deg'}]}}/></>}
      {d.id === 'classic' && <View style={{position:'absolute',top:5*unit,bottom:5*unit,left:3*unit,right:3*unit,borderWidth:1,borderColor:c.text,opacity:.3}}/>}
      <Feather name={d.mark} size={(d.id === 'editorial' ? 15 : 12)*unit} color={c.text} style={{ marginBottom:5*unit }}/>
      <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={.7} style={{ textAlign:'center',fontSize:(d.id === 'editorial' ? 11 : 9.5)*unit,lineHeight:11.5*unit,fontWeight:serif?'600':'800',fontFamily:serif?'Georgia':undefined,color:c.text }}>{title}</Text>
      <View style={{height:1,width:17*unit,backgroundColor:c.text,opacity:.35,marginTop:5*unit}}/>
    </View>
    {d.id === 'keepsake' && <View style={{position:'absolute',right:-4*unit,top:height*.4,width:10*unit,height:15*unit,borderRadius:3*unit,backgroundColor:'#DFC58E',borderWidth:1,borderColor:'#B89A5F'}}/>}
    {d.id === 'field_notes' && <View style={{position:'absolute',right:7*unit,top:0,bottom:0,width:2*unit,backgroundColor:c.text,opacity:.25}}/>}
  </View>;
}
