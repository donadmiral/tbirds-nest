import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { storiesService, CatchupUser } from '../../services/storiesService';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

type Props = {
  mode?: 'primary' | 'all' | 'global';
};

const NAVY = '#0B1E3D';
const SEEN = '#D1D5DB';
const TEXT_PRIMARY = '#1A1A1A';

function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

export default function StoryStrip({ mode = 'all' }: Props) {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [catchup, setCatchup] = useState<CatchupUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [myHasStories, setMyHasStories] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await storiesService.getCatchupFeed(mode, 30);
      setCatchup(rows);
      setMyHasStories(!!myId && rows.some(r => r.user_id === myId));
    } catch (e) {
      console.log('[StoryStrip.load]', e);
    } finally {
      setLoading(false);
    }
  }, [mode, myId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const ch = supabase
      .channel('stories_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stories' },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const openCreationMenu = () => {
    navigation.navigate('StoryCreationMenu');
  };

  const openViewer = (startUserId: string) => {
    const userIds = catchup.map(c => c.user_id);
    navigation.navigate('StoryViewer', {
      userIds,
      startUserId,
    });
  };

  const renderSelfBubble = () => {
    const myCatchup = catchup.find(c => c.user_id === myId);
    const hasUnseen = myCatchup?.has_unseen ?? false;

    return (
      <TouchableOpacity
        style={s.bubble}
        activeOpacity={0.75}
        onPress={() => {
          if (myHasStories && myId) {
            openViewer(myId);
          } else {
            openCreationMenu();
          }
        }}
      >
        <View
          style={[
            s.ringWrap,
            myHasStories
              ? hasUnseen
                ? s.ringUnseen
                : s.ringSeen
              : s.ringAddOwn,
          ]}
        >
          <View style={s.avatarInner}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, s.avatarFb]}>
                <Text style={s.avatarFbTxt}>{initials(profile?.full_name)}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={s.plusBadge}
            onPress={openCreationMenu}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Feather name="plus" size={12} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Text style={s.nameTxt} numberOfLines={1}>
          Your story
        </Text>
      </TouchableOpacity>
    );
  };

  const renderUserBubble = (user: CatchupUser) => {
    return (
      <TouchableOpacity
        key={user.user_id}
        style={s.bubble}
        activeOpacity={0.75}
        onPress={() => openViewer(user.user_id)}
      >
        <View
          style={[
            s.ringWrap,
            user.has_unseen ? s.ringUnseen : s.ringSeen,
          ]}
        >
          <View style={s.avatarInner}>
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, s.avatarFb]}>
                <Text style={s.avatarFbTxt}>{initials(user.full_name)}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={s.nameTxt} numberOfLines={1}>
          {user.full_name?.split(' ')[0] || 'User'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading && catchup.length === 0) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="small" color="#8E8E93" />
      </View>
    );
  }

  const others = catchup.filter(c => c.user_id !== myId);

  return (
    <View style={s.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {renderSelfBubble()}
        {others.map(renderUserBubble)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
    paddingVertical: 12,
  },
  loadingWrap: {
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 14,
  },
  bubble: {
    width: 68,
    alignItems: 'center',
  },
  ringWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    padding: 2.5,
    marginBottom: 6,
  },
  ringUnseen: {
    borderColor: NAVY,
  },
  ringSeen: {
    borderColor: SEEN,
  },
  ringAddOwn: {
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
  },
  avatarFb: {
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFbTxt: {
    fontSize: 17,
    fontWeight: '700',
    color: NAVY,
  },
  plusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  nameTxt: {
    fontSize: 11,
    fontWeight: '500',
    color: TEXT_PRIMARY,
    textAlign: 'center',
    maxWidth: 68,
    letterSpacing: -0.1,
  },
});