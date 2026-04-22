import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  TextInput, ActivityIndicator, RefreshControl, StatusBar, Alert,
  KeyboardAvoidingView, Platform, FlatList, Modal, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import {
  institutionsService, affiliationsService,
  type ProfileInstitution, type ProfileAffiliation, type Institution,
} from '../../services/institutionsService';

const SCREEN_W = Dimensions.get('window').width;

const SEMESTERS = ['Spring', 'Summer', 'Fall'] as const;
type Semester = typeof SEMESTERS[number];

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEARS: number[] = Array.from({ length: CURRENT_YEAR + 6 - 1946 }, (_, i) => CURRENT_YEAR + 5 - i);
const DEGREE_PROGRAMS = [
  'Master of Global Management (MGM)',
  'MGM — Finance Concentration',
  'MGM — Marketing Concentration',
  'MGM — Entrepreneurship Concentration',
  'MGM — Public Policy & Economics Concentration',
  'MGM — Sustainability Concentration',
  'MGM — Global Affairs Concentration',
  'Executive MBA (EMBA)',
  'Online Master of Global Management',
  'Master of Arts in Global Affairs & Management',
  'Doctor of Business Administration (DBA)',
  'PhD Program',
  'Certificate in Global Management',
  'Other',
];
const ROLES = ['student','alumni','faculty','staff'];

type Profile = {
  id: string; full_name: string; username: string; bio: string;
  location: string; degree_program: string;
  graduation_year: number | null; graduation_semester: Semester | null;
  avatar_url: string | null; email: string; role: string;
  profile_visibility: 'public' | 'private';
};
type Post = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  media_url: string | null;
  media: PostMedia[];
};
type Stats = { posts: number; connections: number; followers: number; following: number };
type Person = { id: string; full_name: string; username: string | null; avatar_url: string | null };

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff/60000), h = Math.floor(m/60), dy = Math.floor(h/24);
  if (m<1) return 'now'; if (m<60) return m+'m';
  if (h<24) return h+'h'; if (dy<7) return dy+'d';
  return new Date(d).toLocaleDateString([],{month:'short',day:'numeric'});
}
function fmtGrad(year?: number|null, semester?: Semester|null) {
  if (!year) return '';
  return semester ? semester + ' ' + year : String(year);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={st.field}><Text style={st.fieldLabel}>{label}</Text>{children}</View>;
}

const COMMUNITY = [
  { label: 'Mingle',      sub: 'Events & meetups',    ring: '#FF6CAB', bg: '#FFF0F7', emoji: '🔗', featherIcon: null, featherColor: null, route: 'MingleScreen' },
  { label: 'Startup',     sub: 'Founders & ideas',    ring: '#5856D6', bg: '#F0EEFF', emoji: '🚀', featherIcon: null, featherColor: null, route: 'StartupHubScreen' },
  { label: 'Mentorship',  sub: 'Guide & grow',        ring: '#34C759', bg: '#EDFBF0', emoji: '🏮', featherIcon: null, featherColor: null, route: 'Mentorship' },
  { label: "Bird's Biz",  sub: 'Alumni businesses',   ring: '#4364F7', bg: '#EFF3FF', emoji: '🏪', featherIcon: null, featherColor: null, route: 'BirdsBusinessScreen' },
  { label: 'Jobs',        sub: 'Roles & referrals',   ring: '#5856D6', bg: '#F0EEFF', emoji: null, featherIcon: 'briefcase',  featherColor: '#5856D6', route: 'Jobs' },
  { label: 'Support',     sub: 'FAQs & tickets',      ring: '#34C759', bg: '#EDFBF0', emoji: null, featherIcon: 'help-circle', featherColor: '#34C759', route: 'HelpSupport' },
] as const;

type StatsModalKey = 'connections' | 'followers' | 'following' | null;

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile: authProfile, setProfile: setAuthProfile } = useAuthStore();
  const userId = authProfile?.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats>({ posts: 0, connections: 0, followers: 0, following: 0 });
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDegree, setEditDegree] = useState('');
  const [editYear, setEditYear] = useState<number|null>(null);
  const [editSemester, setEditSemester] = useState<Semester|null>(null);
  const [editRole, setEditRole] = useState('student');
  const [editVisibility, setEditVisibility] = useState<'public'|'private'>('public');
  const [showDegreeList, setShowDegreeList] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const [statsModal, setStatsModal] = useState<StatsModalKey>(null);
  const [statsPeople, setStatsPeople] = useState<Person[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [myInstitutions, setMyInstitutions] = useState<ProfileInstitution[]>([]);
  const [myAffiliations, setMyAffiliations] = useState<ProfileAffiliation[]>([]);
  const [instLoading, setInstLoading] = useState(false);

  const [addInstOpen, setAddInstOpen] = useState(false);
  const [instQuery, setInstQuery] = useState('');
  const [instResults, setInstResults] = useState<Institution[]>([]);
  const [addingInstitution, setAddingInstitution] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: pd } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (pd) {
        const p: Profile = {
          id: pd.id, full_name: pd.full_name||'', username: pd.username||'',
          bio: pd.bio||'', location: pd.location||'', degree_program: pd.degree_program||'',
          graduation_year: pd.graduation_year??null,
          graduation_semester: pd.graduation_semester??null,
          avatar_url: pd.avatar_url||null, email: pd.email||'', role: pd.role||'student',
          profile_visibility: pd.profile_visibility||'public',
        };
        setProfile(p);
        if (setAuthProfile) setAuthProfile({ ...(authProfile as any), ...p });
      }

      const { count: postCount } = await supabase.from('posts').select('id',{count:'exact',head:true}).eq('user_id',userId);
      const { count: c1 } = await supabase.from('connections').select('id',{count:'exact',head:true}).eq('requester_id',userId).eq('status','accepted');
      const { count: c2 } = await supabase.from('connections').select('id',{count:'exact',head:true}).eq('recipient_id',userId).eq('status','accepted');
      const { count: followerCount } = await supabase.from('orbits').select('id',{count:'exact',head:true}).eq('following_id',userId);
      const { count: followingCount } = await supabase.from('orbits').select('id',{count:'exact',head:true}).eq('follower_id',userId);
      setStats({
        posts: postCount??0,
        connections:(c1??0)+(c2??0),
        followers: followerCount??0,
        following: followingCount??0,
      });

      let postsData: any[] = [];
      try {
        const { data: md } = await supabase
          .from('posts')
          .select('*, post_media(id, url, media_type, width, height, sort_order)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30);
        postsData = md || [];
      } catch {
        const { data: md } = await supabase
          .from('posts').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(30);
        postsData = md || [];
      }

      const posts: Post[] = postsData.map((p: any) => {
        const mediaArr: PostMedia[] = Array.isArray(p.post_media) && p.post_media.length > 0
          ? (p.post_media as PostMedia[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          : (p.media_url ? [{ id: '0', url: p.media_url, media_type: 'image', sort_order: 0 }] : []);
        return {
          id: p.id,
          content: p.content || p.body || '',
          likes_count: p.likes_count ?? 0,
          comments_count: p.comments_count ?? 0,
          created_at: p.created_at,
          media_url: p.media_url || null,
          media: mediaArr,
        };
      });
      setUserPosts(posts);
    } catch(e){ console.log('PROFILE_LOAD',e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [userId]);

  const loadMemberships = useCallback(async () => {
    if (!userId) return;
    setInstLoading(true);
    try {
      const [insts, affs] = await Promise.all([
        institutionsService.getProfileInstitutions(userId),
        affiliationsService.getProfileAffiliations(userId),
      ]);
      setMyInstitutions(insts);
      setMyAffiliations(affs);
    } catch (e: any) {
      console.log('[loadMemberships]', e?.message);
    } finally {
      setInstLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    load();
    loadMemberships();
  }, [load, loadMemberships]));

  useEffect(() => {
    if (route.params?.edit && profile) {
      openEdit();
      navigation.setParams({ edit: undefined } as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.edit, profile]);

  const changePhoto = async () => {
    if (!userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed','Allow photo access in your device settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as ImagePicker.MediaType[],
      allowsEditing: true,
      aspect: [1,1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase().replace('jpeg','jpg');
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

      const { url } = await uploadMedia(
        'avatars',
        userId,
        {
          uri: asset.uri,
          kind: 'image',
          ext,
          mimeType: mime,
          width: asset.width,
          height: asset.height,
          base64: null,
        },
        { filename: `avatar_${Date.now()}.${ext}` }
      );

      const { error: dbErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
      if (dbErr) { Alert.alert('Save failed', dbErr.message); return; }

      setProfile(prev => prev ? { ...prev, avatar_url: url } : prev);
      if (setAuthProfile) setAuthProfile({ ...(authProfile as any), avatar_url: url });
    } catch(e:any) {
      Alert.alert('Error', e?.message || 'Could not update photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openStats = async (type: 'connections'|'followers'|'following') => {
    setStatsModal(type); setStatsLoading(true); setStatsPeople([]);
    try {
      let ids:string[]=[];
      if (type==='connections') {
        const { data: r1 } = await supabase.from('connections').select('recipient_id').eq('requester_id',userId).eq('status','accepted');
        const { data: r2 } = await supabase.from('connections').select('requester_id').eq('recipient_id',userId).eq('status','accepted');
        ids=[...(r1||[]).map((r:any)=>r.recipient_id),...(r2||[]).map((r:any)=>r.requester_id)];
      } else if (type==='followers') {
        const { data } = await supabase.from('orbits').select('follower_id').eq('following_id',userId);
        ids=(data||[]).map((r:any)=>r.follower_id);
      } else {
        const { data } = await supabase.from('orbits').select('following_id').eq('follower_id',userId);
        ids=(data||[]).map((r:any)=>r.following_id);
      }
      if (ids.length>0) {
        const { data: people } = await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',ids);
        setStatsPeople((people||[]) as Person[]);
      }
    } catch(e){ console.log('STATS',e); }
    finally { setStatsLoading(false); }
  };

  const openEdit = () => {
    if (!profile) return;
    setEditName(profile.full_name); setEditUsername(profile.username); setEditBio(profile.bio);
    setEditLocation(profile.location); setEditDegree(profile.degree_program);
    setEditYear(profile.graduation_year); setEditSemester(profile.graduation_semester);
    setEditRole(profile.role||'student'); setEditVisibility(profile.profile_visibility||'public');
    setShowDegreeList(false); setShowYearPicker(false);
    setEditing(true);
  };

  const saveProfile = async () => {
    if (!userId||saving) return;
    if (!editName.trim()){ Alert.alert('Required','Full name cannot be empty.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('profiles').update({
        full_name:editName.trim(),
        username:editUsername.trim().toLowerCase().replace(/\s+/g,'_'),
        bio:editBio.trim(), location:editLocation.trim(),
        degree_program:editDegree,
        graduation_year:editYear,
        graduation_semester:editSemester,
        role:editRole, profile_visibility:editVisibility,
        updated_at:new Date().toISOString(),
      }).eq('id',userId);
      if (error){ Alert.alert('Error',error.message); return; }
      setEditing(false); await load();
    } catch(e:any){ Alert.alert('Error',e?.message||'Could not save.'); }
    finally { setSaving(false); }
  };

  const searchInstitutionsForAdd = useCallback(async (q: string) => {
    setInstQuery(q);
    try {
      const r = await institutionsService.search(q, 20);
      const haveIds = new Set(myInstitutions.map(i => i.institution_id));
      setInstResults(r.filter(i => !haveIds.has(i.id)));
    } catch (e: any) {
      console.log('[searchInstitutionsForAdd]', e?.message);
    }
  }, [myInstitutions]);

  const handleAddInstitution = async (inst: Institution) => {
    if (addingInstitution) return;
    setAddingInstitution(true);
    try {
      await institutionsService.claim({
        institutionId: inst.id,
        relationshipType: 'current',
        makePrimary: false,
      });
      setAddInstOpen(false);
      setInstQuery('');
      setInstResults([]);
      await loadMemberships();
    } catch (e: any) {
      Alert.alert('Could not add', e?.message || 'Please try again');
    } finally {
      setAddingInstitution(false);
    }
  };

  const handleSetPrimary = async (institutionId: string) => {
    try {
      await institutionsService.setPrimary(institutionId);
      await loadMemberships();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not switch primary');
    }
  };

  const handleRemoveInstitution = (institutionId: string, name: string) => {
    Alert.alert(
      'Remove ' + name + '?',
      'You will no longer see content scoped to this school.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!userId) return;
            try {
              await institutionsService.remove(institutionId, userId);
              await loadMemberships();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not remove');
            }
          },
        },
      ]
    );
  };

  if (editing) {
    return (
      <SafeAreaView style={st.safe} edges={['top','left','right']}>
        <StatusBar barStyle="dark-content" />
        <View style={st.editHeader}>
          <TouchableOpacity onPress={()=>setEditing(false)}><Text style={st.editCancel}>Cancel</Text></TouchableOpacity>
          <Text style={st.editTitle}>Edit Profile</Text>
          <TouchableOpacity onPress={saveProfile} disabled={saving}>
            {saving?<ActivityIndicator color="#007AFF" size="small"/>:<Text style={st.editSave}>Save</Text>}
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
          <ScrollView contentContainerStyle={[st.editScroll,{paddingBottom:insets.bottom+40}]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            <View style={st.editPhotoRow}>
              <TouchableOpacity onPress={changePhoto} disabled={uploadingPhoto} activeOpacity={0.8} style={{position:'relative'}}>
                {profile?.avatar_url
                  ?<Image source={{uri:profile.avatar_url}} style={st.editAvatar}/>
                  :<View style={[st.editAvatar,st.editAvatarFb]}><Text style={st.editAvatarTxt}>{initials(profile?.full_name)}</Text></View>}
                <View style={st.editCameraBadge}><Feather name="camera" size={14} color="#FFF"/></View>
              </TouchableOpacity>
              <View style={{flex:1,gap:4}}>
                <Text style={{fontSize:16,fontWeight:'600',color:'#000'}}>Profile Photo</Text>
                <TouchableOpacity onPress={changePhoto} disabled={uploadingPhoto} activeOpacity={0.7}>
                  <Text style={{fontSize:14,color:'#007AFF',fontWeight:'500'}}>{uploadingPhoto?'Uploading...':'Tap to change photo'}</Text>
                </TouchableOpacity>
                <Text style={{fontSize:12,color:'#8E8E93'}}>Square images work best</Text>
              </View>
            </View>

            <Field label="Profile Visibility">
              <View style={st.visRow}>
                {(['public','private'] as const).map(v=>(
                  <TouchableOpacity key={v} style={[st.visChip,editVisibility===v&&st.visChipOn]} onPress={()=>setEditVisibility(v)} activeOpacity={0.8}>
                    <Feather name={v==='public'?'globe':'lock'} size={14} color={editVisibility===v?'#FFF':'#8E8E93'}/>
                    <Text style={[st.visChipTxt,editVisibility===v&&st.visChipTxtOn]}>{v==='public'?'Public':'Private'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            <Field label="Full Name *"><TextInput value={editName} onChangeText={setEditName} style={st.input} placeholder="Your full name" placeholderTextColor="#C7C7CC" autoCapitalize="words"/></Field>
            <Field label="Username"><TextInput value={editUsername} onChangeText={setEditUsername} style={st.input} placeholder="username" placeholderTextColor="#C7C7CC" autoCapitalize="none"/></Field>
            <Field label="Bio"><TextInput value={editBio} onChangeText={setEditBio} style={[st.input,st.inputMulti]} placeholder="Tell your story..." placeholderTextColor="#C7C7CC" multiline textAlignVertical="top"/></Field>
            <Field label="Location"><TextInput value={editLocation} onChangeText={setEditLocation} style={st.input} placeholder="City, Country" placeholderTextColor="#C7C7CC" autoCapitalize="words"/></Field>

            <Field label="Degree Program">
              <TouchableOpacity style={st.picker} onPress={()=>{setShowDegreeList(p=>!p);setShowYearPicker(false);}} activeOpacity={0.8}>
                <Text style={[st.pickerTxt,!editDegree&&st.pickerPh]} numberOfLines={2}>{editDegree||'Select your program...'}</Text>
                <Feather name={showDegreeList?'chevron-up':'chevron-down'} size={16} color="#8E8E93"/>
              </TouchableOpacity>
              {showDegreeList&&<View style={st.dropList}>{DEGREE_PROGRAMS.map(d=>(
                <TouchableOpacity key={d} style={[st.dropItem,editDegree===d&&st.dropItemOn]} onPress={()=>{setEditDegree(d);setShowDegreeList(false);}}>
                  <Text style={[st.dropTxt,editDegree===d&&st.dropTxtOn]} numberOfLines={2}>{d}</Text>
                  {editDegree===d&&<Feather name="check" size={14} color="#007AFF"/>}
                </TouchableOpacity>
              ))}</View>}
            </Field>

            <Field label="Graduation Year">
              <TouchableOpacity style={st.picker} onPress={()=>{setShowYearPicker(p=>!p);setShowDegreeList(false);}} activeOpacity={0.8}>
                <Text style={[st.pickerTxt,!editYear&&st.pickerPh]}>{editYear?String(editYear):'Select graduation year...'}</Text>
                <Feather name={showYearPicker?'chevron-up':'chevron-down'} size={16} color="#8E8E93"/>
              </TouchableOpacity>
              {showYearPicker&&<View style={[st.dropList,{maxHeight:220}]}><ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>{GRAD_YEARS.map(y=>(
                <TouchableOpacity key={y} style={[st.dropItem,editYear===y&&st.dropItemOn]} onPress={()=>{setEditYear(y);setShowYearPicker(false);}}>
                  <Text style={[st.dropTxt,editYear===y&&st.dropTxtOn]}>{y}</Text>
                  {editYear===y&&<Feather name="check" size={14} color="#007AFF"/>}
                </TouchableOpacity>
              ))}</ScrollView></View>}
            </Field>

            <Field label="Graduation Semester">
              <View style={st.semesterRow}>
                {SEMESTERS.map(sem => (
                  <TouchableOpacity
                    key={sem}
                    style={[st.semesterChip, editSemester===sem && st.semesterChipOn]}
                    onPress={() => setEditSemester(editSemester === sem ? null : sem)}
                    activeOpacity={0.8}
                  >
                    <Text style={[st.semesterChipTxt, editSemester===sem && st.semesterChipTxtOn]}>{sem}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            <Field label="Role">
              <View style={st.roleRow}>{ROLES.map(r=>(
                <TouchableOpacity key={r} style={[st.roleChip,editRole===r&&st.roleChipOn]} onPress={()=>setEditRole(r)} activeOpacity={0.8}>
                  <Text style={[st.roleChipTxt,editRole===r&&st.roleChipTxtOn]}>{r.charAt(0).toUpperCase()+r.slice(1)}</Text>
                </TouchableOpacity>
              ))}</View>
            </Field>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (loading) return <SafeAreaView style={st.safe}><View style={st.center}><ActivityIndicator color="#007AFF" size="large"/></View></SafeAreaView>;
  if (!profile) return <SafeAreaView style={st.safe}><View style={st.center}><Text style={{color:'#8E8E93'}}>Profile not found.</Text></View></SafeAreaView>;

  const statsModalTitle =
    statsModal === 'connections' ? 'Connections' :
    statsModal === 'followers' ? 'Followers' :
    statsModal === 'following' ? 'Following' : '';

  const statsEmptyMsg =
    statsModal === 'connections' ? 'Connect with other TBirds.' :
    statsModal === 'followers' ? 'When someone follows you they appear here.' :
    'Follow people to see their updates.';

  return (
    <SafeAreaView style={st.safe} edges={['top','left','right']}>
      <StatusBar barStyle="dark-content"/>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load();loadMemberships();}} tintColor="#007AFF"/>}
        contentContainerStyle={{paddingBottom:insets.bottom+60}}
      >
        <View style={st.topBar}>
          <Text style={st.screenTitle}>Profile</Text>
          <View style={{flexDirection:'row',gap:8,alignItems:'center'}}>
            <TouchableOpacity style={st.iconBtn} onPress={()=>navigation.navigate('Settings')} activeOpacity={0.7}>
              <Feather name="settings" size={20} color="#000"/>
            </TouchableOpacity>
            <TouchableOpacity style={[st.iconBtn,{width:'auto',paddingHorizontal:14,flexDirection:'row',gap:5}]} onPress={openEdit} activeOpacity={0.7}>
              <Feather name="edit-2" size={14} color="#000"/>
              <Text style={{fontSize:14,fontWeight:'600',color:'#000'}}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={st.avatarRow}>
          <View style={{alignItems:'center',gap:6}}>
            <TouchableOpacity onPress={changePhoto} disabled={uploadingPhoto} activeOpacity={0.8} style={{position:'relative'}}>
              {uploadingPhoto
                ?<View style={[st.avatar,st.avatarLoading]}><ActivityIndicator color="#007AFF"/></View>
                :profile.avatar_url
                ?<Image source={{uri:profile.avatar_url}} style={st.avatar}/>
                :<View style={[st.avatar,st.avatarFb]}><Text style={st.avatarFbTxt}>{initials(profile.full_name)}</Text></View>}
              <View style={st.cameraBadge}><Feather name="camera" size={13} color="#FFF"/></View>
            </TouchableOpacity>
            <TouchableOpacity onPress={changePhoto} disabled={uploadingPhoto} activeOpacity={0.7}>
              <Text style={st.changePhotoTxt}>{uploadingPhoto?'Uploading...':'Change photo'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{flex:1,paddingTop:4}}>
            <Text style={st.nameText}>{profile.full_name||'Your Name'}</Text>
            {profile.username?<Text style={st.handleText}>@{profile.username}</Text>:null}
            {profile.role?<View style={st.roleBadge}><Text style={st.roleBadgeTxt}>{profile.role.charAt(0).toUpperCase()+profile.role.slice(1)}</Text></View>:null}
          </View>
        </View>

        <View style={st.statsBar}>
          <View style={st.statCell}>
            <Text style={st.statNum}>{stats.posts}</Text>
            <Text style={st.statLbl}>Posts</Text>
          </View>
          <View style={st.statDivider}/>
          <TouchableOpacity style={st.statCell} onPress={()=>openStats('connections')} activeOpacity={0.7}>
            <Text style={st.statNum}>{stats.connections}</Text>
            <Text style={st.statLbl}>Connections</Text>
          </TouchableOpacity>
          <View style={st.statDivider}/>
          <TouchableOpacity style={st.statCell} onPress={()=>openStats('followers')} activeOpacity={0.7}>
            <Text style={st.statNum}>{stats.followers}</Text>
            <Text style={st.statLbl}>Followers</Text>
          </TouchableOpacity>
          <View style={st.statDivider}/>
          <TouchableOpacity style={st.statCell} onPress={()=>openStats('following')} activeOpacity={0.7}>
            <Text style={st.statNum}>{stats.following}</Text>
            <Text style={st.statLbl}>Following</Text>
          </TouchableOpacity>
        </View>

        <View style={st.bioSection}>
          {profile.bio
            ?<Text style={st.bioTxt}>{profile.bio}</Text>
            :<TouchableOpacity onPress={openEdit}><Text style={st.bioEmpty}>Add a bio...</Text></TouchableOpacity>}
          <View style={{gap:5,marginTop:8}}>
            {profile.degree_program?<View style={st.metaRow}><Feather name="book" size={13} color="#8E8E93"/><Text style={st.metaTxt}>{profile.degree_program}</Text></View>:null}
            {profile.graduation_year?<View style={st.metaRow}><Feather name="calendar" size={13} color="#8E8E93"/><Text style={st.metaTxt}>{fmtGrad(profile.graduation_year,profile.graduation_semester)}</Text></View>:null}
            {profile.location?<View style={st.metaRow}><Feather name="map-pin" size={13} color="#8E8E93"/><Text style={st.metaTxt}>{profile.location}</Text></View>:null}
          </View>
          {(!profile.degree_program||!profile.graduation_year)&&(
            <TouchableOpacity style={st.cohortBanner} onPress={openEdit} activeOpacity={0.8}>
              <Feather name="calendar" size={14} color="#1D4ED8"/>
              <Text style={st.cohortBannerTxt}>
                {!profile.graduation_year&&!profile.degree_program?'Add your cohort, degree and graduation semester':!profile.degree_program?'Add your degree program':'Add your graduation year and semester'}
              </Text>
              <Feather name="chevron-right" size={14} color="#1D4ED8"/>
            </TouchableOpacity>
          )}
        </View>

        <View style={st.instSection}>
          <View style={st.instHeader}>
            <Text style={st.instSectionTitle}>Schools</Text>
            <TouchableOpacity
              onPress={() => { setInstQuery(''); setInstResults([]); setAddInstOpen(true); searchInstitutionsForAdd(''); }}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="plus-circle" size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>

          {instLoading && myInstitutions.length === 0 ? (
            <ActivityIndicator color="#007AFF" style={{ paddingVertical: 12 }} />
          ) : myInstitutions.length === 0 ? (
            <TouchableOpacity
              onPress={() => { setAddInstOpen(true); searchInstitutionsForAdd(''); }}
              style={st.instEmpty}
              activeOpacity={0.7}
            >
              <Feather name="award" size={18} color="#007AFF" />
              <Text style={st.instEmptyTxt}>Add your school</Text>
            </TouchableOpacity>
          ) : (
            myInstitutions.map(pi => (
              <View key={pi.id} style={st.instItemRow}>
                <View style={st.instItemIcon}>
                  {pi.institution_logo_url
                    ? <Image source={{ uri: pi.institution_logo_url }} style={{ width: 36, height: 36, borderRadius: 8 }} />
                    : <Feather name="award" size={18} color="#007AFF" />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={st.instItemName} numberOfLines={1}>
                      {pi.institution_short_name || pi.institution_name}
                    </Text>
                    {pi.is_primary && <View style={st.primaryChip}><Text style={st.primaryChipTxt}>Primary</Text></View>}
                    {pi.verified_via_email && <Feather name="check-circle" size={13} color="#059669" />}
                  </View>
                  <Text style={st.instItemMeta}>
                    {pi.relationship_type.charAt(0).toUpperCase() + pi.relationship_type.slice(1)}
                    {pi.start_year ? ' · ' + pi.start_year + (pi.end_year ? '–' + pi.end_year : '') : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    const buttons = pi.is_primary
                      ? [
                          { text: 'Remove', style: 'destructive' as const, onPress: () => handleRemoveInstitution(pi.institution_id, pi.institution_name) },
                          { text: 'Cancel', style: 'cancel' as const },
                        ]
                      : [
                          { text: 'Make primary', onPress: () => handleSetPrimary(pi.institution_id) },
                          { text: 'Remove', style: 'destructive' as const, onPress: () => handleRemoveInstitution(pi.institution_id, pi.institution_name) },
                          { text: 'Cancel', style: 'cancel' as const },
                        ];
                    Alert.alert(pi.institution_name, undefined, buttons);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="more-horizontal" size={18} color="#8E8E93" />
                </TouchableOpacity>
              </View>
            ))
          )}

          {myAffiliations.length > 0 && (
            <>
              <Text style={[st.instSectionTitle, { marginTop: 20, marginBottom: 10 }]}>Affiliations</Text>
              {myAffiliations.map(a => (
                <View key={a.id} style={st.instItemRow}>
                  <View style={[st.instItemIcon, { backgroundColor: '#F0EEFF' }]}>
                    <Feather name="users" size={16} color="#5856D6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.instItemName} numberOfLines={1}>{a.affiliation_name}</Text>
                    <Text style={st.instItemMeta}>
                      {a.kind.replace(/_/g, ' ')}
                      {a.institution_name ? ' · ' + a.institution_name : ' · Global'}
                      {a.is_official ? ' · Official' : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={st.communitySection}>
          <Text style={st.communityTitle}>Community</Text>
          <View style={st.communityGrid}>
            {COMMUNITY.map(item=>(
              <TouchableOpacity
                key={item.label}
                style={st.communityCell}
                activeOpacity={0.8}
                onPress={()=>navigation.navigate(item.route as any)}
              >
                <View style={[st.communityRingWrap,{borderColor:item.ring}]}>
                  <View style={[st.communityCircle,{backgroundColor:item.bg}]}>
                    {item.emoji
                      ?<Text style={{fontSize:26}}>{item.emoji}</Text>
                      :<Feather name={(item as any).featherIcon} size={26} color={(item as any).featherColor}/>}
                  </View>
                </View>
                <Text style={st.communityLabel}>{item.label}</Text>
                <Text style={st.communitySub}>{item.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={st.sectionHeader}>
          <Text style={st.sectionHeaderTxt}>Posts</Text>
        </View>

        {userPosts.length===0
          ?<View style={st.empty}>
            <Feather name="edit-3" size={40} color="#E5E5EA"/>
            <Text style={st.emptyTitle}>No posts yet</Text>
            <Text style={st.emptyTxt}>Share something with the community.</Text>
            <TouchableOpacity style={st.emptyBtn} onPress={()=>navigation.navigate('Feed')}>
              <Text style={st.emptyBtnTxt}>Go to Feed</Text>
            </TouchableOpacity>
          </View>
          :userPosts.map(post=>(
            <TouchableOpacity key={post.id} style={st.postCard} activeOpacity={0.85} onPress={()=>navigation.navigate('Post',{postId:post.id})}>
              {post.media.length > 0 ? (
                <View style={{marginBottom:10}}>
                  <MediaRenderer
                    media={post.media}
                    containerWidth={SCREEN_W - 32}
                    maxHeight={420}
                  />
                </View>
              ) : null}
              <Text style={st.postContent} numberOfLines={4}>{post.content}</Text>
              <View style={{flexDirection:'row',gap:14,alignItems:'center'}}>
                <View style={{flexDirection:'row',gap:4,alignItems:'center'}}><Feather name="heart" size={13} color="#8E8E93"/><Text style={st.postMetaTxt}>{post.likes_count}</Text></View>
                <View style={{flexDirection:'row',gap:4,alignItems:'center'}}><Feather name="message-circle" size={13} color="#8E8E93"/><Text style={st.postMetaTxt}>{post.comments_count}</Text></View>
                <Text style={{marginLeft:'auto',fontSize:13,color:'#C7C7CC'}}>{relTime(post.created_at)}</Text>
              </View>
            </TouchableOpacity>
          ))
        }

      </ScrollView>

      <Modal visible={!!statsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setStatsModal(null)}>
        <SafeAreaView style={{flex:1,backgroundColor:'#FFF'}}>
          <View style={st.modalHeader}>
            <View style={{width:60}}/>
            <Text style={st.modalTitle}>{statsModalTitle}</Text>
            <TouchableOpacity onPress={()=>setStatsModal(null)} style={{width:60,alignItems:'flex-end'}}><Feather name="x" size={22} color="#000"/></TouchableOpacity>
          </View>
          {statsLoading
            ?<View style={st.center}><ActivityIndicator color="#007AFF" size="large"/></View>
            :statsPeople.length===0
            ?<View style={st.empty}>
              <Feather name="users" size={40} color="#E5E5EA"/>
              <Text style={st.emptyTitle}>Nobody here yet</Text>
              <Text style={st.emptyTxt}>{statsEmptyMsg}</Text>
            </View>
            :<FlatList data={statsPeople} keyExtractor={p=>p.id} contentContainerStyle={{padding:16}} renderItem={({item:person})=>(
              <TouchableOpacity style={st.personRow} activeOpacity={0.85} onPress={()=>{setStatsModal(null);navigation.navigate('UserProfile',{userId:person.id});}}>
                {person.avatar_url?<Image source={{uri:person.avatar_url}} style={st.personAvatar}/>:<View style={[st.personAvatar,st.personAvatarFb]}><Text style={st.personAvatarTxt}>{initials(person.full_name)}</Text></View>}
                <View style={{flex:1}}><Text style={st.personName}>{person.full_name||'Member'}</Text>{person.username?<Text style={st.personHandle}>@{person.username}</Text>:null}</View>
                <Feather name="chevron-right" size={16} color="#C7C7CC"/>
              </TouchableOpacity>
            )}/>
          }
        </SafeAreaView>
      </Modal>

      <Modal
        visible={addInstOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddInstOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={st.modalHeader}>
            <View style={{ width: 60 }} />
            <Text style={st.modalTitle}>Add school</Text>
            <TouchableOpacity
              onPress={() => setAddInstOpen(false)}
              style={{ width: 60, alignItems: 'flex-end' }}
            >
              <Feather name="x" size={22} color="#000" />
            </TouchableOpacity>
          </View>
          <TextInput
            value={instQuery}
            onChangeText={searchInstitutionsForAdd}
            placeholder="Search schools..."
            placeholderTextColor="#8E8E93"
            style={st.addInstSearch}
            autoCapitalize="none"
            autoFocus
          />
          <FlatList
            data={instResults}
            keyExtractor={it => it.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={st.addInstRow}
                onPress={() => handleAddInstitution(item)}
                disabled={addingInstitution}
                activeOpacity={0.7}
              >
                <View style={st.instItemIcon}>
                  <Feather name="award" size={18} color="#007AFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.instItemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={st.instItemMeta}>
                    {[item.short_name, item.city, item.state].filter(Boolean).join(' · ') || item.country}
                  </Text>
                </View>
                {addingInstitution
                  ? <ActivityIndicator size={14} color="#007AFF" />
                  : <Feather name="plus-circle" size={20} color="#007AFF" />}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={{ padding: 20, textAlign: 'center', color: '#8E8E93' }}>
                No matching schools found
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#FFF'},
  center:{flex:1,alignItems:'center',justifyContent:'center'},
  topBar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingTop:10,paddingBottom:14},
  screenTitle:{fontSize:28,fontWeight:'800',color:'#000',letterSpacing:-0.5},
  iconBtn:{width:36,height:36,borderRadius:18,backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  avatarRow:{flexDirection:'row',alignItems:'flex-start',paddingHorizontal:16,marginBottom:16,gap:16},
  avatar:{width:82,height:82,borderRadius:41},
  avatarLoading:{backgroundColor:'#F2F2F7',alignItems:'center',justifyContent:'center'},
  avatarFb:{backgroundColor:'#DBEAFE',alignItems:'center',justifyContent:'center'},
  avatarFbTxt:{fontSize:30,fontWeight:'700',color:'#1D4ED8'},
  cameraBadge:{position:'absolute',bottom:0,right:0,width:26,height:26,borderRadius:13,backgroundColor:'#007AFF',alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#FFF'},
  changePhotoTxt:{fontSize:13,color:'#007AFF',fontWeight:'600'},
  nameText:{fontSize:20,fontWeight:'700',color:'#000',marginBottom:3},
  handleText:{fontSize:14,color:'#007AFF',fontWeight:'500',marginBottom:6},
  roleBadge:{alignSelf:'flex-start',backgroundColor:'#F2F2F7',borderRadius:8,paddingHorizontal:10,paddingVertical:4},
  roleBadgeTxt:{fontSize:12,fontWeight:'600',color:'#3C3C43'},
  statsBar:{flexDirection:'row',alignItems:'center',marginHorizontal:16,marginBottom:18,backgroundColor:'#F9F9F9',borderRadius:14,borderWidth:StyleSheet.hairlineWidth,borderColor:'#E5E5EA',overflow:'hidden'},
  statCell:{flex:1,alignItems:'center',paddingVertical:14},
  statNum:{fontSize:20,fontWeight:'700',color:'#000'},
  statLbl:{fontSize:11,color:'#8E8E93',marginTop:2,textAlign:'center'},
  statDivider:{width:StyleSheet.hairlineWidth,height:36,backgroundColor:'#E5E5EA'},
  bioSection:{paddingHorizontal:16,marginBottom:20},
  bioTxt:{fontSize:15,color:'#1A1A1A',lineHeight:22},
  bioEmpty:{fontSize:15,color:'#C7C7CC'},
  metaRow:{flexDirection:'row',alignItems:'center',gap:6},
  metaTxt:{fontSize:14,color:'#6B6B6B',flexShrink:1},
  cohortBanner:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#EFF6FF',borderRadius:12,padding:12,marginTop:12,borderWidth:1,borderColor:'#BFDBFE'},
  cohortBannerTxt:{flex:1,fontSize:13,color:'#1D4ED8',fontWeight:'500',lineHeight:19},
  communitySection:{paddingHorizontal:16,marginBottom:20},
  communityTitle:{fontSize:18,fontWeight:'800',color:'#000',marginBottom:16,letterSpacing:-0.3},
  communityGrid:{flexDirection:'row',flexWrap:'wrap',gap:6,justifyContent:'space-between'},
  communityCell:{width:'31%',alignItems:'center',gap:7,marginBottom:6},
  communityRingWrap:{width:72,height:72,borderRadius:36,borderWidth:2.5,alignItems:'center',justifyContent:'center',shadowColor:'#000',shadowOpacity:0.07,shadowRadius:8,shadowOffset:{width:0,height:3},elevation:3},
  communityCircle:{width:62,height:62,borderRadius:31,alignItems:'center',justifyContent:'center'},
  communityLabel:{fontSize:12,fontWeight:'700',color:'#000',textAlign:'center'},
  communitySub:{fontSize:10,color:'#8E8E93',textAlign:'center',lineHeight:13},
  sectionHeader:{paddingHorizontal:16,paddingTop:16,paddingBottom:8},
  sectionHeaderTxt:{fontSize:17,fontWeight:'700',color:'#000'},
  postCard:{padding:16,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F2F2F7'},
  postContent:{fontSize:15,color:'#1A1A1A',lineHeight:22,marginBottom:10},
  postMetaTxt:{fontSize:13,color:'#8E8E93'},
  empty:{alignItems:'center',paddingVertical:60,paddingHorizontal:32,gap:8},
  emptyTitle:{fontSize:18,fontWeight:'600',color:'#000'},
  emptyTxt:{fontSize:14,color:'#8E8E93',textAlign:'center',lineHeight:20},
  emptyBtn:{marginTop:10,backgroundColor:'#000',borderRadius:12,paddingHorizontal:24,paddingVertical:12},
  emptyBtnTxt:{color:'#FFF',fontSize:15,fontWeight:'600'},
  modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F0F0F0'},
  modalTitle:{fontSize:17,fontWeight:'600',color:'#000'},
  personRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F5F5F5'},
  personAvatar:{width:46,height:46,borderRadius:23},
  personAvatarFb:{backgroundColor:'#DBEAFE',alignItems:'center',justifyContent:'center'},
  personAvatarTxt:{fontSize:17,fontWeight:'700',color:'#1D4ED8'},
  personName:{fontSize:16,fontWeight:'600',color:'#000'},
  personHandle:{fontSize:13,color:'#8E8E93',marginTop:2},
  editHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F0F0F0'},
  editCancel:{fontSize:17,color:'#8E8E93',minWidth:60},
  editTitle:{fontSize:17,fontWeight:'600',color:'#000'},
  editSave:{fontSize:17,fontWeight:'700',color:'#007AFF',textAlign:'right',minWidth:60},
  editScroll:{padding:20},
  editPhotoRow:{flexDirection:'row',alignItems:'center',gap:16,marginBottom:28},
  editAvatar:{width:80,height:80,borderRadius:40},
  editAvatarFb:{backgroundColor:'#DBEAFE',alignItems:'center',justifyContent:'center'},
  editAvatarTxt:{fontSize:28,fontWeight:'700',color:'#1D4ED8'},
  editCameraBadge:{position:'absolute',bottom:0,right:0,width:28,height:28,borderRadius:14,backgroundColor:'#007AFF',alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#FFF'},
  field:{marginBottom:22},
  fieldLabel:{fontSize:12,fontWeight:'700',color:'#8E8E93',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8},
  input:{backgroundColor:'#F5F5F5',borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16,color:'#000'},
  inputMulti:{minHeight:90,paddingTop:13,textAlignVertical:'top'},
  visRow:{flexDirection:'row',gap:10},
  visChip:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingVertical:12,borderRadius:12,borderWidth:1.5,borderColor:'#E5E5EA',backgroundColor:'#F5F5F5'},
  visChipOn:{backgroundColor:'#000',borderColor:'#000'},
  visChipTxt:{fontSize:15,fontWeight:'500',color:'#8E8E93'},
  visChipTxtOn:{color:'#FFF',fontWeight:'600'},
  picker:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#F5F5F5',borderRadius:12,paddingHorizontal:14,paddingVertical:13},
  pickerTxt:{fontSize:16,color:'#000',flex:1,paddingRight:8},
  pickerPh:{color:'#C7C7CC'},
  dropList:{marginTop:4,backgroundColor:'#FFF',borderRadius:12,borderWidth:StyleSheet.hairlineWidth,borderColor:'#E5E5EA',overflow:'hidden'},
  dropItem:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14,paddingVertical:13,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#F0F0F0'},
  dropItemOn:{backgroundColor:'#EFF6FF'},
  dropTxt:{fontSize:15,color:'#000',flex:1,paddingRight:8},
  dropTxtOn:{color:'#007AFF',fontWeight:'500'},
  semesterRow:{flexDirection:'row',gap:10},
  semesterChip:{flex:1,alignItems:'center',justifyContent:'center',paddingVertical:13,borderRadius:12,borderWidth:1.5,borderColor:'#E5E5EA',backgroundColor:'#F5F5F5'},
  semesterChipOn:{backgroundColor:'#000',borderColor:'#000'},
  semesterChipTxt:{fontSize:15,fontWeight:'500',color:'#8E8E93'},
  semesterChipTxtOn:{color:'#FFF',fontWeight:'700'},
  roleRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  roleChip:{paddingHorizontal:18,paddingVertical:10,borderRadius:20,borderWidth:1,borderColor:'#E5E5EA',backgroundColor:'#F5F5F5'},
  roleChipOn:{backgroundColor:'#000',borderColor:'#000'},
  roleChipTxt:{fontSize:14,color:'#8E8E93',fontWeight:'500'},
  roleChipTxtOn:{color:'#FFF',fontWeight:'600'},

  instSection: { paddingHorizontal: 16, marginBottom: 20 },
  instHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  instSectionTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  instEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14 },
  instEmptyTxt: { fontSize: 14, color: '#007AFF', fontWeight: '600' },
  instItemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F2F2F7' },
  instItemIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  instItemName: { fontSize: 15, fontWeight: '600', color: '#000' },
  instItemMeta: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  primaryChip: { backgroundColor: '#1D4ED8', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  primaryChipTxt: { fontSize: 10, color: '#FFF', fontWeight: '700' },

  addInstSearch: { margin: 14, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  addInstRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F2F2F7' },
});