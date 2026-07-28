/**
 * IncomingCallScreen.tsx
 *
 * Uses audioService for ringtone (no local Audio.Sound).
 * Auto-dismiss on caller cancel. Vibration pattern.
 * Supports both 1-on-1 and group calls.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  StatusBar, Image, Easing, Vibration, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { callService } from '../../services/callService';
import { audioService } from '../../services/audioService';
import { useAuthStore } from '../../stores/authStore';
import { useCallContext } from '../../contexts/CallContext';

const VIB = Platform.OS === 'android' ? [0,800,600,800,600,800,2000] : [0,800,600,800];

export default function IncomingCallScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const { startCall } = useCallContext();
  const myId = profile?.id ?? null;

  const callId: string = route.params?.callId || '';
  const channelId: string = route.params?.channelId || route.params?.callId || '';
  const callerName: string = route.params?.callerName || 'Unknown';
  const callerAvatar: string | null = route.params?.callerAvatar ?? null;
  const callerUsername: string | null = route.params?.callerUsername ?? null;
  const otherUser = route.params?.otherUser ?? null;
  const isVideo: boolean = route.params?.isVideo === true;
  const isGroupCall: boolean = route.params?.isGroupCall === true;
  const groupName: string = route.params?.groupName || 'Group Call';
  const conversationId: string | null = route.params?.conversationId ?? null;
  const callerId: string = otherUser?.id || '';

  const [dismissed, setDismissed] = useState(false);
  const vibRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring3 = useRef(new Animated.Value(1)).current;
  const r1o = useRef(new Animated.Value(0.6)).current;
  const r2o = useRef(new Animated.Value(0.4)).current;
  const r3o = useRef(new Animated.Value(0.2)).current;
  const slideUp = useRef(new Animated.Value(80)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  const stoppingRef = useRef(false);
  const ringtoneStartedRef = useRef(false);

  const stopAlerts = () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    Vibration.cancel();
    if (vibRef.current) { clearInterval(vibRef.current); vibRef.current = null; }
    try { require('react-native').Vibration.cancel(); } catch {}
      audioService.stopAll();
  };

  const dismiss = () => {
    if (dismissed) return; setDismissed(true); stopAlerts();
    if (mountedRef.current && navigation.canGoBack()) navigation.goBack();
  };

  useEffect(() => {
    mountedRef.current = true;
    stoppingRef.current = false;

    // Play ringtone via audioService (async, guarded against double-play)
    const startRingtone = async () => {
      if (ringtoneStartedRef.current) return;
      ringtoneStartedRef.current = true;
      await audioService.playRingtone();
      try { const { Vibration } = require('react-native'); Vibration.vibrate([0, 800, 1200], true); } catch {}
    };
    startRingtone();

    // Vibration pattern
    Vibration.vibrate(VIB, false);
    vibRef.current = setInterval(() => { if (mountedRef.current) Vibration.vibrate(VIB, false); }, 4000);

    return () => {
      mountedRef.current = false;
      ringtoneStartedRef.current = false;
      stopAlerts();
    };
  }, []);

  // Auto-dismiss with inline subscription (unique channel name)
  useEffect(() => {
    if (!callId) return;
    const uid = `${callId}_incoming_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const sub = supabase.channel(`call_status_${uid}`)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'call_sessions', filter:`id=eq.${callId}` },
        (payload) => { const st = (payload.new as any).status; if (st === 'ended' || st === 'declined' || st === 'missed') dismiss(); })
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [callId]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideUp, { toValue:0, duration:500, easing:Easing.out(Easing.cubic), useNativeDriver:true }),
      Animated.timing(fadeIn, { toValue:1, duration:500, useNativeDriver:true }),
    ]).start();
    const pulse = (sc: Animated.Value, op: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([Animated.delay(delay),
        Animated.parallel([Animated.timing(sc,{toValue:2.2,duration:1600,easing:Easing.out(Easing.quad),useNativeDriver:true}),Animated.timing(op,{toValue:0,duration:1600,useNativeDriver:true})]),
        Animated.parallel([Animated.timing(sc,{toValue:1,duration:0,useNativeDriver:true}),Animated.timing(op,{toValue:0.6,duration:0,useNativeDriver:true})])]));
    const a1=pulse(ring1,r1o,0); const a2=pulse(ring2,r2o,500); const a3=pulse(ring3,r3o,1000);
    a1.start(); a2.start(); a3.start();
    const timeout = setTimeout(async () => {
      if (callId) {
        if (isGroupCall) {
          await supabase.rpc('decline_group_call', { p_session_id: callId }).then(() => {}, () => {});
        } else {
          await callService.markMissed(callId);
        }
      }
      dismiss();
    }, 30000);
    return () => { a1.stop(); a2.stop(); a3.stop(); clearTimeout(timeout); };
  }, []);

  const getInitials = (n: string) => { const p = n.trim().split(' ').filter(Boolean); return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase(); };

  const displayName = isGroupCall ? groupName : callerName;

  const handleAccept = async () => {
    stopAlerts();
    if (isGroupCall) {
      startCall({
        callId, channelId,
        otherUserId: callerId,
        otherUserName: groupName,
        otherUserAvatar: null,
        isVideo, isIncoming: true,
        isGroupCall: true,
        conversationId,
      });
    } else {
      startCall({
        callId, channelId,
        otherUserId: callerId,
        otherUserName: callerName,
        otherUserAvatar: callerAvatar,
        isVideo, isIncoming: true,
        isGroupCall: false,
        conversationId: null,
      });
    }
    navigation.replace('Call', {
      callId, channelId,
      callerName: displayName,
      callerAvatar: isGroupCall ? null : callerAvatar,
      otherUser, isIncoming: true, isVideo,
      fromContext: true, isGroupCall,
      groupName: isGroupCall ? groupName : undefined,
      conversationId,
    });
  };

  const handleDecline = async () => {
    stopAlerts();
    if (callId) {
      if (isGroupCall) {
        await supabase.rpc('decline_group_call', { p_session_id: callId }).then(() => {}, () => {});
      } else {
        await callService.declineCall(callId);
      }
    }
    setDismissed(true);
    setTimeout(() => { if (navigation.canGoBack()) navigation.goBack(); }, 200);
  };

  return (
    <SafeAreaView style={st.safe} edges={['left','right','bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#060A14" />
      <Animated.View style={[st.container,{paddingTop:insets.top+20,opacity:fadeIn,transform:[{translateY:slideUp}]}]}>
        <View style={st.topSection}>
          <View style={st.appPill}><Text style={st.appPillTxt}>PlatinumCircles</Text></View>
          <Text style={st.incomingTxt}>{isGroupCall ? 'Group Call' : 'Incoming Call'}</Text>
        </View>
        <View style={st.avatarSection}>
          <View style={st.pulseContainer}>
            <Animated.View style={[st.ring,{transform:[{scale:ring3}],opacity:r3o,borderColor:'#38BDF820'}]} />
            <Animated.View style={[st.ring,{transform:[{scale:ring2}],opacity:r2o,borderColor:'#38BDF840'}]} />
            <Animated.View style={[st.ring,{transform:[{scale:ring1}],opacity:r1o,borderColor:'#38BDF860'}]} />
            <View style={st.avatarWrap}>
              {isGroupCall
                ? <View style={st.avatarFb}><Text style={st.avatarFbTxt}>G</Text></View>
                : callerAvatar
                  ? <Image source={{uri:callerAvatar}} style={st.avatar} />
                  : <View style={st.avatarFb}><Text style={st.avatarFbTxt}>{getInitials(callerName)}</Text></View>}
            </View>
          </View>
          <Text style={st.callerName}>{displayName}</Text>
          {!isGroupCall && callerUsername && <Text style={st.callerHandle}>@{callerUsername}</Text>}
          {isGroupCall && <Text style={st.callerHandle}>from {callerName}</Text>}
          <View style={st.callTypePill}><View style={st.callTypeDot} /><Text style={st.callTypeTxt}>{isVideo ? 'Video Call' : 'Audio Call'}</Text></View>
        </View>
        <View style={[st.actionSection,{paddingBottom:Math.max(insets.bottom+20,40)}]}>
          <Text style={st.hint}>Tap to respond</Text>
          <View style={st.btnRow}>
            <TouchableOpacity style={st.declineBtn} activeOpacity={0.85} onPress={handleDecline}><View style={st.btnInner}><Text style={st.declineIcon}>&#x2715;</Text></View><Text style={st.declineLbl}>Decline</Text></TouchableOpacity>
            <TouchableOpacity style={st.acceptBtn} activeOpacity={0.85} onPress={handleAccept}><View style={[st.btnInner,st.acceptBtnInner]}><Text style={st.acceptIcon}>&#x2713;</Text></View><Text style={st.acceptLbl}>Accept</Text></TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const AV=108; const RS=160;
const st = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#060A14'},container:{flex:1,backgroundColor:'#060A14',alignItems:'center',justifyContent:'space-between'},
  topSection:{alignItems:'center',paddingTop:8},appPill:{backgroundColor:'#0E1825',borderRadius:20,borderWidth:1,borderColor:'#1F3050',paddingHorizontal:14,paddingVertical:5,marginBottom:10},
  appPillTxt:{fontSize:12,fontWeight:'700',color:'#38BDF8',letterSpacing:0.5},incomingTxt:{fontSize:15,fontWeight:'600',color:'#64748B',letterSpacing:0.3},
  avatarSection:{flex:1,alignItems:'center',justifyContent:'center'},pulseContainer:{width:RS,height:RS,alignItems:'center',justifyContent:'center',marginBottom:28},
  ring:{position:'absolute',width:RS,height:RS,borderRadius:RS/2,borderWidth:1.5},avatarWrap:{width:AV,height:AV,borderRadius:AV/2,overflow:'hidden',borderWidth:2,borderColor:'#38BDF840'},
  avatar:{width:'100%',height:'100%'},avatarFb:{width:'100%',height:'100%',backgroundColor:'#0E2A4A',alignItems:'center',justifyContent:'center'},avatarFbTxt:{fontSize:36,fontWeight:'800',color:'#38BDF8'},
  callerName:{fontSize:32,fontWeight:'800',color:'#F1F5F9',textAlign:'center',letterSpacing:-0.5},callerHandle:{fontSize:15,color:'#38BDF8',marginTop:6,fontWeight:'500'},
  callTypePill:{flexDirection:'row',alignItems:'center',gap:6,marginTop:14,backgroundColor:'#0E1825',borderRadius:20,borderWidth:1,borderColor:'#1F3050',paddingHorizontal:14,paddingVertical:7},
  callTypeDot:{width:7,height:7,borderRadius:4,backgroundColor:'#4ADE80'},callTypeTxt:{fontSize:13,color:'#94A3B8',fontWeight:'600'},
  actionSection:{width:'100%',alignItems:'center',paddingHorizontal:40},hint:{fontSize:12,color:'#334155',marginBottom:20,letterSpacing:0.5},
  btnRow:{flexDirection:'row',justifyContent:'space-between',width:'100%'},btnInner:{width:72,height:72,borderRadius:36,backgroundColor:'#2D1A1A',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#7F1D1D',marginBottom:10},
  acceptBtnInner:{backgroundColor:'#0D2B1A',borderColor:'#14532D'},declineBtn:{alignItems:'center'},declineIcon:{fontSize:28,color:'#F87171'},declineLbl:{fontSize:13,fontWeight:'700',color:'#F87171'},
  acceptBtn:{alignItems:'center'},acceptIcon:{fontSize:28,color:'#4ADE80'},acceptLbl:{fontSize:13,fontWeight:'700',color:'#4ADE80'},
});