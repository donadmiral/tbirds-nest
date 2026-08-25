import LaunchVeil from '../components/LaunchVeil';
import ProfileRestore from '../components/ProfileRestore';
import MutedStoriesScreen from '../screens/profile/MutedStoriesScreen';
import ArticleReaderScreen from '../screens/feed/ArticleReaderScreen';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View, Animated, Pressable } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import type { ComponentProps } from 'react';

import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { callService } from '../services/callService';
import { setActiveCallNavId, clearCallNavGuard, isCallNavActive } from '../services/notificationBootstrap';
import { linking } from './linking';
import { CallProvider } from '../contexts/CallContext';
import SplashLoader from '../components/SplashLoader';

import LoginScreen          from '../screens/auth/LoginScreen';
import BusinessSignInScreen from '../screens/auth/BusinessSignInScreen';
import BusinessAccessScreen from '../screens/profile/BusinessAccessScreen';
import AccountStandingScreen from '../screens/profile/AccountStandingScreen';
import OfflineBanner from '../components/OfflineBanner';
import ArticleComposeScreen from '../screens/feed/ArticleComposeScreen';
import SignUpScreen         from '../screens/auth/SignUpScreen';
import SetupProfileScreen   from '../screens/auth/SetupProfileScreen';
import AuthCallbackScreen   from '../screens/auth/AuthCallbackScreen';
import VerifyEmailScreen    from '../screens/auth/VerifyEmailScreen';

import FeedScreen           from '../screens/feed/FeedScreen';
import PostScreen           from '../screens/feed/PostScreen';
import TrendFeedScreen      from '../screens/feed/TrendFeedScreen';
import SearchScreen         from '../screens/feed/SearchScreen';
import NotificationsScreen  from '../screens/notifications/NotificationsScreen';

import NetworkScreen                  from '../screens/network/NetworkScreen';

import JobDetailScreen           from '../screens/jobs/JobDetailScreen';
import ApplicantsScreen          from '../screens/jobs/ApplicantsScreen';
import SavedJobsScreen           from '../screens/jobs/SavedJobsScreen';
import MyApplicationsScreen      from '../screens/jobs/MyApplicationsScreen';
import BusinessInboxScreen       from '../screens/profile/BusinessInboxScreen';
import CampaignsScreen           from '../screens/profile/CampaignsScreen';
import JobsScreen           from '../screens/jobs/JobsScreen';

import MarketScreen         from '../screens/market/MarketScreen';
import ListingDetailScreen  from '../screens/market/ListingDetailScreen';
import CreateListingScreen  from '../screens/market/CreateListingScreen';
import { BlurView } from 'expo-blur';
import AdaptiveTabBar from '../components/AdaptiveTabBar';

import ConversationsScreen     from '../screens/messages/ConversationsScreen';
import ChatScreen              from '../screens/messages/ChatScreen';
import MemoryAlbumScreen       from '../screens/profile/MemoryAlbumScreen';
import GroupManagementScreen   from '../screens/messages/GroupManagementScreen';
import CreateGroupScreen       from '../screens/messages/CreateGroupScreen';
import MessageRequestsScreen   from '../screens/messages/MessageRequestsScreen';
import SavedMessagesScreen     from '../screens/messages/SavedMessagesScreen';
import StarredMessagesScreen   from '../screens/messages/StarredMessagesScreen';
import CallScreen              from '../screens/messages/CallScreen';
import IncomingCallScreen      from '../screens/messages/IncomingCallScreen';
import CallLogScreen           from '../screens/messages/CallLogScreen';

import ProfileScreen              from '../screens/profile/ProfileScreen';
import UserProfileScreen          from '../screens/profile/UserProfileScreen';
import FollowListScreen           from '../screens/profile/FollowListScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import BlockedAccountsScreen from '../screens/profile/BlockedAccountsScreen';
import CreateBusinessScreen from '../screens/profile/CreateBusinessScreen';
import BusinessesScreen from '../screens/profile/BusinessesScreen';
import ContextInboxScreen from '../screens/messages/ContextInboxScreen';
import BusinessManageScreen from '../screens/profile/BusinessManageScreen';
import SavedPostsScreen from '../screens/feed/SavedPostsScreen';
import SettingsScreen             from '../screens/profile/SettingsScreen';
import ApplyVerificationScreen    from '../screens/profile/ApplyVerificationScreen';
import ContactSupportScreen       from '../screens/profile/ContactSupportScreen';
import TicketScreen               from '../screens/profile/TicketScreen';
import BusinessApplyScreen        from '../screens/profile/BusinessApplyScreen';
import ChangeUsernameScreen       from '../screens/profile/ChangeUsernameScreen';
import HelpSupportScreen          from '../screens/profile/HelpSupportScreen';
import TermsScreen                from '../screens/profile/TermsScreen';
import PrivacyPolicyScreen        from '../screens/profile/PrivacyPolicyScreen';
import FollowRequestsScreen       from '../screens/profile/FollowRequestsScreen';




import StoryViewerScreen         from '../screens/stories/StoryViewerScreen';
import StoryComposerScreen       from '../screens/stories/StoryComposerScreen';
import StoryCreationMenuScreen   from '../screens/stories/StoryCreationMenuScreen';
import StoryCameraScreen         from '../screens/stories/StoryCameraScreen';
import StoryDualCaptureScreen    from '../screens/stories/StoryDualCaptureScreen';
import MemoryArrangementScreen   from '../screens/stories/MemoryArrangementScreen';


import IncomingCallListener         from '../components/IncomingCallListener';
import MiniCallBar                  from '../components/MiniCallBar';
import AppLockGate                  from '../components/AppLockGate';


const RootStack    = createNativeStackNavigator();
const FeedStack    = createNativeStackNavigator();
const NetworkStack = createNativeStackNavigator();
const JobsStack    = createNativeStackNavigator();
const MsgStack     = createNativeStackNavigator();
const ProfStack    = createNativeStackNavigator();
const Tab          = createBottomTabNavigator();

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const navigationRef = React.createRef<any>();

function FeedStackNav() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedMain"      component={FeedScreen} />
      <FeedStack.Screen name="Search"        component={SearchScreen} />
      <FeedStack.Screen name="Notifications" component={NotificationsScreen} />
      <FeedStack.Screen name="ArticleReader" component={ArticleReaderScreen} />
    </FeedStack.Navigator>
  );
}

function NetworkStackNav() {
  return (
    <NetworkStack.Navigator screenOptions={{ headerShown: false }}>
      <NetworkStack.Screen name="MarketMain"     component={MarketScreen} />
      <NetworkStack.Screen name="ListingDetail"  component={ListingDetailScreen} />
      <NetworkStack.Screen name="CreateListing"  component={CreateListingScreen} />
      <NetworkStack.Screen name="MarketInbox"   component={ContextInboxScreen} initialParams={{ context: 'market' }} />
    </NetworkStack.Navigator>
  );
}

function JobsStackNav() {
  return (
    <JobsStack.Navigator screenOptions={{ headerShown: false }}>
      <JobsStack.Screen name="JobsMain" component={JobsScreen} />
      <JobsStack.Screen name="JobsInbox" component={ContextInboxScreen} initialParams={{ context: 'jobs' }} />
    </JobsStack.Navigator>
  );
}

function MessagesStackNav() {
  return (
    <MsgStack.Navigator screenOptions={{ headerShown: false }}>
      <MsgStack.Screen name="Conversations"    component={ConversationsScreen} />
      <MsgStack.Screen name="CreateGroup"      component={CreateGroupScreen} />
      <MsgStack.Screen name="FindPeople"       component={NetworkScreen} />
      <MsgStack.Screen name="GroupManagement"  component={GroupManagementScreen} />
      <MsgStack.Screen name="MessageRequests"  component={MessageRequestsScreen} />
      <MsgStack.Screen name="SavedMessages"    component={SavedMessagesScreen} />
      <MsgStack.Screen name="StarredMessages"  component={StarredMessagesScreen} />
      <MsgStack.Screen name="CallLog"          component={CallLogScreen} />
    </MsgStack.Navigator>
  );
}

function ProfileStackNav() {
  return (
    <ProfStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfStack.Screen name="ProfileMain"     component={ProfileScreen} />
      <ProfStack.Screen name="Settings"        component={SettingsScreen} />
      <ProfStack.Screen name="ApplyVerification" component={ApplyVerificationScreen} />
      <ProfStack.Screen name="ContactSupport" component={ContactSupportScreen} />
      <ProfStack.Screen name="Ticket" component={TicketScreen} />
      <ProfStack.Screen name="BusinessApply" component={BusinessApplyScreen} />
      <ProfStack.Screen name="ChangeUsername" component={ChangeUsernameScreen} />
      <ProfStack.Screen name="BusinessAccess" component={BusinessAccessScreen} />
      <ProfStack.Screen name="AccountStanding" component={AccountStandingScreen} />
      <ProfStack.Screen name="ArticleCompose" component={ArticleComposeScreen} />
      <ProfStack.Screen name="EditProfile"     component={EditProfileScreen} />
      <ProfStack.Screen name="BlockedAccounts" component={BlockedAccountsScreen} />
      <ProfStack.Screen name="CreateBusiness"  component={CreateBusinessScreen} />
      <ProfStack.Screen name="Businesses"      component={BusinessesScreen} />
      <ProfStack.Screen name="BusinessManage"  component={BusinessManageScreen} />
      <ProfStack.Screen name="SavedPosts"      component={SavedPostsScreen} />
      <ProfStack.Screen name="MutedStories" component={MutedStoriesScreen} />
      <ProfStack.Screen name="Terms"           component={TermsScreen} />
      <ProfStack.Screen name="PrivacyPolicy"   component={PrivacyPolicyScreen} />
      <ProfStack.Screen name="HelpSupport"     component={HelpSupportScreen} />
      <ProfStack.Screen name="FollowRequests"  component={FollowRequestsScreen} />
      <ProfStack.Screen name="MyNetwork"       component={NetworkScreen} />
    </ProfStack.Navigator>
  );
}

function getTabIcon(name: string, focused: boolean): IoniconName {
  switch (name) {
    case 'Feed':     return focused ? 'home'        : 'home-outline';
    case 'Market':   return focused ? 'storefront'  : 'storefront-outline';
    case 'Jobs':     return focused ? 'briefcase'   : 'briefcase-outline';
    case 'Messages': return focused ? 'chatbubbles' : 'chatbubbles-outline';
    default:         return focused ? 'person'      : 'person-outline';
  }
}

// Phase 8B: Physical tab bar button with micro-compression + haptic
function TabBarButton({ children, onPress, onLongPress, accessibilityState, style }: any) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const lastActiveRef = React.useRef(accessibilityState?.selected);

  React.useEffect(() => {
    // Haptic on tab change (not on re-press of active tab)
    if (accessibilityState?.selected && !lastActiveRef.current) {
      Haptics.selectionAsync();
    }
    lastActiveRef.current = accessibilityState?.selected;
  }, [accessibilityState?.selected]);

  const handlePressIn = React.useCallback(() => {
    Animated.timing(scaleAnim, { toValue: 0.95, duration: 100, useNativeDriver: true }).start();
  }, [scaleAnim]);

  const handlePressOut = React.useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 14, useNativeDriver: true }).start();
  }, [scaleAnim]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { flex: 1, alignItems: 'center', justifyContent: 'center' }]}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function MainTabs() {
  const profile = useAuthStore(s => s.profile);
  const userId = profile?.id ?? null;
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!userId) { setUnreadNotifs(0); return; }
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const loadUnread = async () => {
      const { count } = await supabase
        .from('notifications').select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId).is('read_at', null);
      const c = count || 0;
      setUnreadNotifs(c);
      // Icon badge policy: the number means unread MESSAGES only.
      try {
        const { data: cu } = await supabase.rpc('get_context_unread');
        const msgCount = (((cu as any)?.personal ?? 0) + ((cu as any)?.groups ?? 0));
        Notifications.setBadgeCountAsync(msgCount).catch(() => {});
      } catch { Notifications.setBadgeCountAsync(0).catch(() => {}); }
    };
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadUnread, 300);
    };
    loadUnread();
    const ch = supabase.channel(`tab_notifs_${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, debouncedLoad)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, debouncedLoad)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const tabBarHeight = 56 + Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0);
  const tabBarPaddingBottom = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0);

  return (
    <Tab.Navigator
      tabBar={(p) => <AdaptiveTabBar {...p} />}
      initialRouteName="Feed"
      screenOptions={({ route }) => ({
        headerShown: false, tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: '#0B1E3D', tabBarInactiveTintColor: '#8E8E93',
        tabBarButton: (props) => <TabBarButton {...props} />,
        tabBarIcon: ({ focused, color, size }) => {
          const iconName = getTabIcon(route.name, focused);
          if (route.name === 'Feed' && unreadNotifs > 0) {
            return (
              <View style={{ width: size + 10, height: size, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={iconName} size={size + 2} color={color} />
                <View style={[s.dot, { minWidth: 10, width: 10, height: 10, borderRadius: 5, paddingHorizontal: 0 }]} />
              </View>
            );
          }
          return <Ionicons name={iconName} size={size + 2} color={color} />;
        },
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: tabBarPaddingBottom + 10,
          height: 64,
          borderRadius: 32,
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.88)',
          borderTopWidth: 0,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(0,0,0,0.08)',
          paddingBottom: 0,
          paddingTop: 0,
          shadowColor: '#000',
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 14,
        },
        tabBarItemStyle: { height: 64 },
        tabBarBackground: () => (
          <BlurView tint="systemChromeMaterialLight" intensity={90} style={StyleSheet.absoluteFill} />
        ),
      })}
    >
      <Tab.Screen name="Feed"     component={FeedStackNav} />
      <Tab.Screen name="Market"   component={NetworkStackNav} />
      <Tab.Screen name="Jobs"     component={JobsStackNav} />
      <Tab.Screen name="Messages" component={MessagesStackNav} />
      <Tab.Screen name="Profile"  component={ProfileStackNav} />
    </Tab.Navigator>
  );
}

function MainTabsWithListener() {
  return <MainTabs />;
}

function useNotificationTapHandler() {
  const responseListener = useRef<any>(null);

  useEffect(() => {
    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data;
      if (!data || !navigationRef.current) return;
      console.log('[PUSH_TAP] type:', data.type);
      try { await handleNotificationTap(data); } catch (e) { console.log('[PUSH_TAP] error:', e); }
    });

    Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (!data || !data.type) return;
      console.log('[PUSH_TAP] cold start, type:', data.type);
      const waitForNav = () => new Promise<void>((resolve) => {
        const check = () => { if (navigationRef.current) { resolve(); return; } setTimeout(check, 200); };
        check(); setTimeout(resolve, 5000);
      });
      await waitForNav();
      if (!navigationRef.current) return;
      try { await handleNotificationTap(data); } catch (e) { console.log('[PUSH_TAP] cold start error:', e); }
    });

    return () => { if (responseListener.current) responseListener.current?.remove(); };
  }, []);
}

async function handleNotificationTap(data: any) {
  if (!navigationRef.current) return;
  switch (data.type) {
    case 'incoming_call': await handleIncomingCallTap(data); break;
    case 'message':
      if (data.conversation_id) navigationRef.current.navigate('Chat', { conversationId: data.conversation_id });
      break;
    case 'like': case 'comment': case 'reply': case 'repost': case 'mention':
      if (data.post_id) navigationRef.current.navigate('Post', { postId: data.post_id, commentId: data.comment_id || undefined });
      break;
    case 'connection_request': case 'connection_accepted': case 'follow':
      navigationRef.current.navigate('Main', { screen: 'Feed', params: { screen: 'Notifications' } });
      break;
    case 'missed_call':
      navigationRef.current.navigate('Main', { screen: 'Messages', params: { screen: 'CallLog' } });
      break;
    case 'campus_moment':
      navigationRef.current.navigate('Main', { screen: 'Feed', params: { screen: 'FeedMain' } });
      break;
    default:
      navigationRef.current.navigate('Main', { screen: 'Feed', params: { screen: 'Notifications' } });
      break;
  }
}

async function handleIncomingCallTap(data: any) {
  const callId = data.call_id;
  if (!callId) return;
  if (isCallNavActive()) { console.log('[PUSH_TAP] call nav already active, ignoring'); return; }
  let call: any = null;
  for (let i = 0; i < 3; i++) {
    try { call = await callService.getCall(callId); } catch {}
    if (call) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!call) { console.log('[PUSH_TAP] call not found after retries:', callId); return; }
  if (call.status !== 'ringing') { console.log('[PUSH_TAP] call not ringing, status:', call.status); return; }
  setActiveCallNavId(callId);
  try {
    const callerId = call.caller_id || call.initiator_id;
    const { data: caller } = await supabase.from('profiles').select('id, full_name, username, avatar_url').eq('id', callerId).single();
    const recheck = await callService.getCall(callId);
    if (!recheck || recheck.status !== 'ringing') { console.log('[PUSH_TAP] call ended during fetch'); clearCallNavGuard(); return; }
    let groupName = 'Group Call';
    if (call.is_group_call && call.conversation_id) {
      const { data: conv } = await supabase.from('conversations').select('group_name').eq('id', call.conversation_id).maybeSingle();
      if (conv?.group_name) groupName = conv.group_name;
    }
    console.log('[PUSH_TAP] navigating to IncomingCall:', callId);
    navigationRef.current.navigate('IncomingCall', {
      callId: call.id, channelId: call.channel_id || data.channel_id,
      callerName: caller?.full_name || data.caller_name || 'Unknown',
      callerAvatar: caller?.avatar_url || null, callerUsername: caller?.username || null,
      otherUser: caller || { id: callerId, full_name: 'Unknown', avatar_url: null },
      isVideo: call.is_video ?? data.is_video ?? false,
      isGroupCall: call.is_group_call ?? data.is_group_call ?? false,
      groupName: call.is_group_call ? groupName : undefined,
      conversationId: call.conversation_id || data.conversation_id || null,
    });
  } catch (e: any) { console.log('[PUSH_TAP] error:', e?.message); clearCallNavGuard(); }
}

function useBadgeClearOnForeground() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { /* Badge re-set by MainTabs useEffect */ }
    });
    return () => sub.remove();
  }, []);
}

export default function AppNavigator() {
  const session = useAuthStore(s => s.session);
  const profile = useAuthStore(s => s.profile);
  const loading = useAuthStore(s => s.loading);
  const isPasswordRecovery = useAuthStore(s => s.isPasswordRecovery);

  useNotificationTapHandler();
  useBadgeClearOnForeground();


  if (isPasswordRecovery) {
    return (
      <CallProvider>
        <NavigationContainer ref={navigationRef} linking={linking} fallback={<SplashLoader />}
          theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#FFFFFF', card: '#FFFFFF', text: '#000000', border: '#F0F0F0', primary: '#0B1E3D', notification: '#FF3B30' } }}>
          <LaunchVeil busy={loading} />
          <OfflineBanner />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="AuthCallback" component={AuthCallbackScreen} />
          </RootStack.Navigator>
        </NavigationContainer>
      </CallProvider>
    );
  }

  if (loading) return <SplashLoader />;
  const isAuthed = !!session;
  if (isAuthed && profile === null) return <ProfileRestore />;
  const needsSetup = isAuthed && !profile?.username;
  const isReady    = isAuthed && !!profile?.username;

  return (
    <CallProvider>
      <NavigationContainer ref={navigationRef} linking={linking} fallback={<SplashLoader />}
        theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#FFFFFF', card: '#FFFFFF', text: '#000000', border: '#F0F0F0', primary: '#0B1E3D', notification: '#FF3B30' } }}>
          <OfflineBanner />
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          {isReady ? (
            <>
              <RootStack.Screen name="Main" component={MainTabsWithListener} />

              <RootStack.Group>
                <RootStack.Screen name="Post"                 component={PostScreen} />
                <RootStack.Screen name="TrendFeed"            component={TrendFeedScreen} />
                <RootStack.Screen name="UserProfile"          component={UserProfileScreen} />
                <RootStack.Screen name="Chat"                 component={ChatScreen} />
                <RootStack.Screen name="MemoryAlbum"          component={MemoryAlbumScreen} />
                <RootStack.Screen name="MessageRequests"      component={MessageRequestsScreen} />
                <RootStack.Screen name="GroupManagement"      component={GroupManagementScreen} />
                <RootStack.Screen name="JobDetail"            component={JobDetailScreen} />
                <RootStack.Screen name="Applicants"           component={ApplicantsScreen} />
                <RootStack.Screen name="SavedJobs"            component={SavedJobsScreen} />
                <RootStack.Screen name="MyApplications"       component={MyApplicationsScreen} />
                <RootStack.Screen name="BusinessInbox"        component={BusinessInboxScreen} />
                <RootStack.Screen name="Campaigns"            component={CampaignsScreen} />
              </RootStack.Group>

              {/* Phase 8: Story creation cinematic realm — dark atmospheric fade entry */}
              <RootStack.Group screenOptions={{ presentation: 'fullScreenModal', animation: 'fade' }}>
                <RootStack.Screen name="StoryCreationMenu"    component={StoryCreationMenuScreen} />
                <RootStack.Screen name="StoryComposer"        component={StoryComposerScreen} />
                <RootStack.Screen name="StoryCamera"          component={StoryCameraScreen} />
                <RootStack.Screen name="StoryDualCapture"     component={StoryDualCaptureScreen} />
                <RootStack.Screen name="MemoryArrangement"    component={MemoryArrangementScreen} />
              </RootStack.Group>

              {/* Immersive overlays — calls, viewer, meetings */}
              <RootStack.Group screenOptions={{ presentation: 'fullScreenModal', animation: 'fade' }}>
                <RootStack.Screen name="Call"              component={CallScreen} />
                <RootStack.Screen name="IncomingCall"      component={IncomingCallScreen} />
                <RootStack.Screen name="StoryViewer"       component={StoryViewerScreen} />
                <RootStack.Screen name="FollowList"        component={FollowListScreen} />
                <RootStack.Screen name="UserProfileTop"    component={UserProfileScreen} />
                <RootStack.Screen name="PostTop"           component={PostScreen} />
              </RootStack.Group>
            </>
          ) : needsSetup ? (
            <RootStack.Screen name="SetupProfile" component={SetupProfileScreen} />
          ) : (
            <>
              <RootStack.Screen name="Login"        component={LoginScreen} />
              <RootStack.Screen name="BusinessSignIn" component={BusinessSignInScreen} />
              <RootStack.Screen name="BusinessApply" component={BusinessApplyScreen} />
              <RootStack.Screen name="SignUp"       component={SignUpScreen} />
              <RootStack.Screen name="VerifyEmail"  component={VerifyEmailScreen} />
              <RootStack.Screen name="AuthCallback" component={AuthCallbackScreen} />
            </>
          )}
        </RootStack.Navigator>
        {isReady && <IncomingCallListener />}
        {isReady && <MiniCallBar />}
        {isReady && <AppLockGate />}
      </NavigationContainer>
    </CallProvider>
  );
}

const s = StyleSheet.create({
  dot: { position: 'absolute', top: -3, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: '#FFFFFF' },
  dotTxt: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
});