import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { useAuthStore } from '../stores/authStore';
import { linking } from './linking';

import LoginScreen          from '../screens/auth/LoginScreen';
import SignUpScreen         from '../screens/auth/SignUpScreen';
import SetupProfileScreen   from '../screens/auth/SetupProfileScreen';
import AuthCallbackScreen   from '../screens/auth/AuthCallbackScreen';
import VerifyEmailScreen    from '../screens/auth/VerifyEmailScreen';

import FeedScreen           from '../screens/feed/FeedScreen';
import PostScreen           from '../screens/feed/PostScreen';
import SearchScreen         from '../screens/feed/SearchScreen';
import NotificationsScreen  from '../screens/notifications/NotificationsScreen';

import NetworkScreen                  from '../screens/network/NetworkScreen';
import AffiliationsScreen             from '../screens/network/AffiliationsScreen';
import CreateAffiliationScreen        from '../screens/network/CreateAffiliationScreen';
import AffiliationDetailScreen        from '../screens/network/AffiliationDetailScreen';
import AffiliationAdminScreen         from '../screens/network/AffiliationAdminScreen';
import AffiliationJoinRequestsScreen  from '../screens/network/AffiliationJoinRequestsScreen';

import JobsScreen           from '../screens/jobs/JobsScreen';

import ConversationsScreen     from '../screens/messages/ConversationsScreen';
import ChatScreen              from '../screens/messages/ChatScreen';
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
import SettingsScreen             from '../screens/profile/SettingsScreen';
import HelpSupportScreen          from '../screens/profile/HelpSupportScreen';
import TermsScreen                from '../screens/profile/TermsScreen';
import PrivacyPolicyScreen        from '../screens/profile/PrivacyPolicyScreen';
import AboutScreen                from '../screens/profile/AboutScreen';
import MentorshipScreen           from '../screens/profile/MentorshipScreen';

import MingleScreen               from '../screens/mingle/MingleScreen';
import MingleDetailsScreen        from '../screens/mingle/MingleDetailsScreen';

import BirdsBusinessScreen        from '../screens/profile/BirdsBusinessScreen';
import BirdsBusinessDetailsScreen from '../screens/profile/BirdsBusinessDetailsScreen';
import StartupHubScreen           from '../screens/profile/StartupHubScreen';
import StartupHubDetailsScreen    from '../screens/profile/StartupHubDetailsScreen';
import MoreScreen                 from '../screens/more/MoreScreen';

import EventsScreen        from '../screens/events/EventsScreen';
import CreateEventScreen   from '../screens/events/CreateEventScreen';

import StoryViewerScreen         from '../screens/stories/StoryViewerScreen';
import StoryComposerScreen       from '../screens/stories/StoryComposerScreen';
import StoryCreationMenuScreen   from '../screens/stories/StoryCreationMenuScreen';

import MentorshipHubScreen          from '../screens/mentorship/MentorshipHubScreen';
import MentorListScreen             from '../screens/mentorship/MentorListScreen';
import MentorProfileScreen          from '../screens/mentorship/MentorProfileScreen';
import BecomeMentorScreen           from '../screens/mentorship/BecomeMentorScreen';
import MentorshipRequestsScreen     from '../screens/mentorship/MentorshipRequestsScreen';
import MentorshipDetailScreen       from '../screens/mentorship/MentorshipDetailScreen';

import IncomingCallListener         from '../components/IncomingCallListener';

import MeetingScreen                from '../screens/meetings/MeetingScreen';
import NewMeetingScreen             from '../screens/meetings/NewMeetingScreen';

const RootStack    = createNativeStackNavigator();
const FeedStack    = createNativeStackNavigator();
const NetworkStack = createNativeStackNavigator();
const JobsStack    = createNativeStackNavigator();
const MsgStack     = createNativeStackNavigator();
const ProfStack    = createNativeStackNavigator();
const Tab          = createBottomTabNavigator();

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function FeedStackNav() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedMain"      component={FeedScreen} />
      <FeedStack.Screen name="Search"        component={SearchScreen} />
      <FeedStack.Screen name="Notifications" component={NotificationsScreen} />
    </FeedStack.Navigator>
  );
}

function NetworkStackNav() {
  return (
    <NetworkStack.Navigator screenOptions={{ headerShown: false }}>
      <NetworkStack.Screen name="NetworkMain"               component={NetworkScreen} />
      <NetworkStack.Screen name="Affiliations"              component={AffiliationsScreen} />
      <NetworkStack.Screen name="CreateAffiliation"         component={CreateAffiliationScreen} />
      <NetworkStack.Screen name="AffiliationDetail"         component={AffiliationDetailScreen} />
      <NetworkStack.Screen name="AffiliationAdmin"          component={AffiliationAdminScreen} />
      <NetworkStack.Screen name="AffiliationJoinRequests"   component={AffiliationJoinRequestsScreen} />
      <NetworkStack.Screen name="MentorshipHub"             component={MentorshipHubScreen} />
      <NetworkStack.Screen name="MentorList"                component={MentorListScreen} />
      <NetworkStack.Screen name="MentorProfile"             component={MentorProfileScreen} />
      <NetworkStack.Screen name="BecomeMentor"              component={BecomeMentorScreen} />
      <NetworkStack.Screen name="MentorshipRequests"        component={MentorshipRequestsScreen} />
      <NetworkStack.Screen name="MentorshipDetail"          component={MentorshipDetailScreen} />
    </NetworkStack.Navigator>
  );
}

function JobsStackNav() {
  return (
    <JobsStack.Navigator screenOptions={{ headerShown: false }}>
      <JobsStack.Screen name="JobsMain" component={JobsScreen} />
    </JobsStack.Navigator>
  );
}

function MessagesStackNav() {
  return (
    <MsgStack.Navigator screenOptions={{ headerShown: false }}>
      <MsgStack.Screen name="Conversations"    component={ConversationsScreen} />
      <MsgStack.Screen name="CreateGroup"      component={CreateGroupScreen} />
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
      <ProfStack.Screen name="ProfileMain"   component={ProfileScreen} />
      <ProfStack.Screen name="Settings"      component={SettingsScreen} />
      <ProfStack.Screen name="Terms"         component={TermsScreen} />
      <ProfStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      <ProfStack.Screen name="About"         component={AboutScreen} />
      <ProfStack.Screen name="HelpSupport"   component={HelpSupportScreen} />
      <ProfStack.Screen name="Mentorship"    component={MentorshipScreen} />
      <ProfStack.Screen name="More"          component={MoreScreen} />
    </ProfStack.Navigator>
  );
}

function getTabIcon(name: string, focused: boolean): IoniconName {
  switch (name) {
    case 'Feed':     return focused ? 'home'        : 'home-outline';
    case 'Network':  return focused ? 'people'      : 'people-outline';
    case 'Jobs':     return focused ? 'briefcase'   : 'briefcase-outline';
    case 'Messages': return focused ? 'chatbubbles' : 'chatbubbles-outline';
    default:         return focused ? 'person'      : 'person-outline';
  }
}

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8E8E93',
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={getTabIcon(route.name, focused)} size={size} color={color} />
        ),
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#F0F0F0',
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      })}
    >
      <Tab.Screen name="Feed"     component={FeedStackNav} />
      <Tab.Screen name="Network"  component={NetworkStackNav} />
      <Tab.Screen name="Jobs"     component={JobsStackNav} />
      <Tab.Screen name="Messages" component={MessagesStackNav} />
      <Tab.Screen name="Profile"  component={ProfileStackNav} />
    </Tab.Navigator>
  );
}

function MainTabsWithListener() {
  return (
    <>
      <MainTabs />
      <IncomingCallListener />
    </>
  );
}

export default function AppNavigator() {
  const { session, profile, loading } = useAuthStore();

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={s.loadingTxt}>Loading...</Text>
      </View>
    );
  }

  const isAuthed   = !!session;
  const needsSetup = isAuthed && !profile?.username;
  const isReady    = isAuthed && !!profile?.username;

  return (
    <NavigationContainer
      linking={linking}
      fallback={<ActivityIndicator color="#007AFF" />}
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: '#FFFFFF',
          card: '#FFFFFF',
          text: '#000000',
          border: '#F0F0F0',
          primary: '#007AFF',
          notification: '#FF3B30',
        },
      }}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isReady ? (
          <>
            <RootStack.Screen name="Main" component={MainTabsWithListener} />

            <RootStack.Group>
              <RootStack.Screen name="Post"                 component={PostScreen} />
              <RootStack.Screen name="UserProfile"          component={UserProfileScreen} />
              <RootStack.Screen name="Chat"                 component={ChatScreen} />
              <RootStack.Screen name="MingleScreen"         component={MingleScreen} />
              <RootStack.Screen name="MingleDetails"        component={MingleDetailsScreen} />
              <RootStack.Screen name="Events"               component={EventsScreen} />
              <RootStack.Screen name="BirdsBusinessScreen"  component={BirdsBusinessScreen} />
              <RootStack.Screen name="BirdsBusinessDetails" component={BirdsBusinessDetailsScreen} />
              <RootStack.Screen name="StartupHubScreen"     component={StartupHubScreen} />
              <RootStack.Screen name="StartupHubDetails"    component={StartupHubDetailsScreen} />
            </RootStack.Group>

            <RootStack.Group
              screenOptions={{
                presentation: 'fullScreenModal',
                animation: 'fade',
              }}
            >
              <RootStack.Screen name="Call"              component={CallScreen} />
              <RootStack.Screen name="IncomingCall"      component={IncomingCallScreen} />
              <RootStack.Screen name="CreateEvent"       component={CreateEventScreen} />
              <RootStack.Screen name="StoryViewer"       component={StoryViewerScreen} />
              <RootStack.Screen name="StoryCreationMenu" component={StoryCreationMenuScreen} />
              <RootStack.Screen name="StoryComposer"     component={StoryComposerScreen} />
              <RootStack.Screen name="Meeting"           component={MeetingScreen} />
              <RootStack.Screen name="NewMeeting"        component={NewMeetingScreen} />
            </RootStack.Group>
          </>
        ) : needsSetup ? (
          <RootStack.Screen name="SetupProfile" component={SetupProfileScreen} />
        ) : (
          <>
            <RootStack.Screen name="Login"        component={LoginScreen} />
            <RootStack.Screen name="SignUp"       component={SignUpScreen} />
            <RootStack.Screen name="VerifyEmail"  component={VerifyEmailScreen} />
            <RootStack.Screen name="AuthCallback" component={AuthCallbackScreen} />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  loadingTxt: { marginTop: 12, fontSize: 15, color: '#8E8E93' },
});