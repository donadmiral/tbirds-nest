# ===== PHASE 1B: REMOVE SCHOOL-ERA CONTENT (Profile, Search, Badge) =====
$ErrorActionPreference = "Stop"
if (-not (Test-Path "package.json")) { Write-Host "Run from project root." -ForegroundColor Red; exit 1 }
$ErrorActionPreference = "Continue"
git add -A 2>&1 | Out-Null; git commit -m "Before Phase 1B" 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
function Edit-File($path, $pairs) {
  $c = [System.IO.File]::ReadAllText($path)
  $crlf = $c.Contains("`r`n")
  if ($crlf) { $c = $c.Replace("`r`n", "`n") }
  foreach ($p in $pairs) {
    $old = $p[0].Replace("`r`n", "`n"); $new = $p[1].Replace("`r`n", "`n")
    $i = 0; $pos = $c.IndexOf($old); while ($pos -ge 0) { $i++; $pos = $c.IndexOf($old, $pos + 1) }
    if ($i -ne 1) { Write-Host ("ANCHOR FAIL (" + $i + " matches): " + $old.Substring(0, [Math]::Min(60, $old.Length))) -ForegroundColor Red; exit 1 }
    $c = $c.Replace($old, $new)
  }
  if ($crlf) { $c = $c.Replace("`n", "`r`n") }
  [System.IO.File]::WriteAllText($path, $c)
  Write-Host ("edited " + $path + " (" + $pairs.Count + " changes)") -ForegroundColor Green
}

$pairs0 = @(
  ,@(@'
import {
  institutionsService, affiliationsService,
  type ProfileInstitution, type ProfileAffiliation, type Institution,
} from '../../services/institutionsService';

'@, @'

'@)
  ,@(@'
const SEMESTERS = ['Spring', 'Summer', 'Fall'] as const;
type Semester = typeof SEMESTERS[number];


'@, @'

'@)
  ,@(@'
const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEARS: number[] = Array.from({ length: CURRENT_YEAR + 6 - 1946 }, (_, i) => CURRENT_YEAR + 5 - i);

'@, @'

'@)
  ,@(@'
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

'@, @'

'@)
  ,@(@'
  location: string; degree_program: string;
  graduation_year: number | null; graduation_semester: Semester | null;

'@, @'
  location: string; degree_program: string;

'@)
  ,@(@'
function fmtGrad(year?: number|null, semester?: Semester|null) {
  if (!year) return '';
  return semester ? semester + ' ' + year : String(year);
}

'@, @'

'@)
  ,@(@'
  const [editYear, setEditYear] = useState<number|null>(null);
  const [editSemester, setEditSemester] = useState<Semester|null>(null);

'@, @'

'@)
  ,@(@'
  const [showDegreeList, setShowDegreeList] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

'@, @'

'@)
  ,@(@'
  const [myInstitutions, setMyInstitutions] = useState<ProfileInstitution[]>([]);
  const [myAffiliations, setMyAffiliations] = useState<ProfileAffiliation[]>([]);
  const [instLoading, setInstLoading] = useState(false);
  const [addInstOpen, setAddInstOpen] = useState(false);
  const [instQuery, setInstQuery] = useState('');
  const [instResults, setInstResults] = useState<Institution[]>([]);
  const [addingInstitution, setAddingInstitution] = useState(false);


'@, @'

'@)
  ,@(@'
          bio: pd.bio||'', location: pd.location||'', degree_program: pd.degree_program||'',
          graduation_year: pd.graduation_year??null, graduation_semester: pd.graduation_semester??null,

'@, @'
          bio: pd.bio||'', location: pd.location||'', degree_program: pd.degree_program||'',

'@)
  ,@(@'
  const loadMemberships = useCallback(async () => {
    if (!userId) return;
    setInstLoading(true);
    try {
      const [insts, affs] = await Promise.all([
        institutionsService.getProfileInstitutions(userId),
        affiliationsService.getProfileAffiliations(userId),
      ]);
      setMyInstitutions(insts); setMyAffiliations(affs);
    } catch (e: any) { console.log('[loadMemberships]', e?.message); }
    finally { setInstLoading(false); }
  }, [userId]);


'@, @'

'@)
  ,@(@'
useFocusEffect(useCallback(() => { load(); loadMemberships(); loadHighlights(); }, [load, loadMemberships, loadHighlights]));
'@, @'
useFocusEffect(useCallback(() => { load(); loadHighlights(); }, [load, loadHighlights]));
'@)
  ,@(@'
    setEditLocation(profile.location); setEditDegree(profile.degree_program);
    setEditYear(profile.graduation_year); setEditSemester(profile.graduation_semester);

'@, @'
    setEditLocation(profile.location); setEditDegree(profile.degree_program);

'@)
  ,@(@'
    setShowDegreeList(false); setShowYearPicker(false); setEditing(true);

'@, @'
    setEditing(true);

'@)
  ,@(@'
        bio:editBio.trim(), location:editLocation.trim(), degree_program:editDegree,
        graduation_year:editYear, graduation_semester:editSemester,

'@, @'
        bio:editBio.trim(), location:editLocation.trim(), degree_program:editDegree,

'@)
  ,@(@'
  const searchInstitutionsForAdd = useCallback(async (q: string) => {
    setInstQuery(q);
    try {
      const r = await institutionsService.search(q, 20);
      const haveIds = new Set(myInstitutions.map(i => i.institution_id));
      setInstResults(r.filter(i => !haveIds.has(i.id)));
    } catch (e: any) { console.log('[searchInstitutionsForAdd]', e?.message); }
  }, [myInstitutions]);

  const handleAddInstitution = async (inst: Institution) => {
    if (addingInstitution) return;
    setAddingInstitution(true);
    try {
      await institutionsService.claim({ institutionId: inst.id, relationshipType: 'current', makePrimary: false });
      setAddInstOpen(false); setInstQuery(''); setInstResults([]); await loadMemberships();
    } catch (e: any) { Alert.alert('Could not add', e?.message || 'Please try again'); }
    finally { setAddingInstitution(false); }
  };

  const handleSetPrimary = async (institutionId: string) => {
    try { await institutionsService.setPrimary(institutionId); await loadMemberships(); }
    catch (e: any) { Alert.alert('Error', e?.message || 'Could not switch primary'); }
  };

  const handleRemoveInstitution = (institutionId: string, name: string) => {
    Alert.alert('Remove ' + name + '?', 'You will no longer see content scoped to this school.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!userId) return;
        try { await institutionsService.remove(institutionId, userId); await loadMemberships(); }
        catch (e: any) { Alert.alert('Error', e?.message || 'Could not remove'); }
      }},
    ]);
  };


'@, @'

'@)
  ,@(@'
            <Field label="Degree Program">
              <TouchableOpacity style={st.picker} onPress={()=>{setShowDegreeList(p=>!p);setShowYearPicker(false);}} activeOpacity={0.8}>
                <Text style={[st.pickerTxt,!editDegree&&st.pickerPh]} numberOfLines={2}>{editDegree||'Select your program...'}</Text>
                <Feather name={showDegreeList?'chevron-up':'chevron-down'} size={16} color={TEXT_SECONDARY}/>
              </TouchableOpacity>
              {showDegreeList&&<View style={st.dropList}>{DEGREE_PROGRAMS.map(d=>(<TouchableOpacity key={d} style={[st.dropItem,editDegree===d&&st.dropItemOn]} onPress={()=>{setEditDegree(d);setShowDegreeList(false);}}><Text style={[st.dropTxt,editDegree===d&&st.dropTxtOn]} numberOfLines={2}>{d}</Text>{editDegree===d&&<Feather name="check" size={14} color={NAVY}/>}</TouchableOpacity>))}</View>}
            </Field>

'@, @'
            <Field label="Profession"><TextInput value={editDegree} onChangeText={setEditDegree} style={st.input} placeholder="e.g. Software Developer, Nurse, Trader" placeholderTextColor="#C7C7CC" autoCapitalize="words"/></Field>

'@)
  ,@(@'
            <Field label="Graduation Year">
              <TouchableOpacity style={st.picker} onPress={()=>{setShowYearPicker(p=>!p);setShowDegreeList(false);}} activeOpacity={0.8}>
                <Text style={[st.pickerTxt,!editYear&&st.pickerPh]}>{editYear?String(editYear):'Select graduation year...'}</Text>
                <Feather name={showYearPicker?'chevron-up':'chevron-down'} size={16} color={TEXT_SECONDARY}/>
              </TouchableOpacity>
              {showYearPicker&&<View style={[st.dropList,{maxHeight:220}]}><ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>{GRAD_YEARS.map(y=>(<TouchableOpacity key={y} style={[st.dropItem,editYear===y&&st.dropItemOn]} onPress={()=>{setEditYear(y);setShowYearPicker(false);}}><Text style={[st.dropTxt,editYear===y&&st.dropTxtOn]}>{y}</Text>{editYear===y&&<Feather name="check" size={14} color={NAVY}/>}</TouchableOpacity>))}</ScrollView></View>}
            </Field>

'@, @'

'@)
  ,@(@'
            <Field label="Graduation Semester">
              <View style={st.semesterRow}>{SEMESTERS.map(sem=>(<TouchableOpacity key={sem} style={[st.semesterChip,editSemester===sem&&st.semesterChipOn]} onPress={()=>setEditSemester(editSemester===sem?null:sem)} activeOpacity={0.8}><Text style={[st.semesterChipTxt,editSemester===sem&&st.semesterChipTxtOn]}>{sem}</Text></TouchableOpacity>))}</View>
            </Field>

'@, @'

'@)
  ,@(@'
<Feather name="book" size={13} color={TEXT_SECONDARY}/>
'@, @'
<Feather name="briefcase" size={13} color={TEXT_SECONDARY}/>
'@)
  ,@(@'
              {profile.graduation_year?<View style={st.metaRow}><Feather name="calendar" size={13} color={TEXT_SECONDARY}/><Text style={st.metaTxt}>{fmtGrad(profile.graduation_year,profile.graduation_semester)}</Text></View>:null}

'@, @'

'@)
  ,@(@'
        <View style={st.instSection}>
          <View style={st.instHeader}>
            <Text style={st.instSectionTitle}>Schools</Text>
            <TouchableOpacity onPress={()=>{setInstQuery('');setInstResults([]);setAddInstOpen(true);searchInstitutionsForAdd('');}} activeOpacity={0.7} hitSlop={{top:10,bottom:10,left:10,right:10}}><Feather name="plus-circle" size={20} color={NAVY}/></TouchableOpacity>
          </View>
          {instLoading&&myInstitutions.length===0?<ActivityIndicator color={NAVY} style={{paddingVertical:12}}/>:myInstitutions.length===0?(<TouchableOpacity onPress={()=>{setAddInstOpen(true);searchInstitutionsForAdd('');}} style={st.instEmpty} activeOpacity={0.7}><Feather name="award" size={18} color={NAVY}/><Text style={st.instEmptyTxt}>Add your school</Text></TouchableOpacity>):(
            myInstitutions.map(pi=>(<View key={pi.id} style={st.instItemRow}><View style={st.instItemIcon}>{pi.institution_logo_url?<ExpoImage source={{uri:pi.institution_logo_url}} style={{width:36,height:36,borderRadius:8}} contentFit="cover" cachePolicy="memory-disk" transition={150} />:<Feather name="award" size={18} color={NAVY}/>}</View><View style={{flex:1}}><View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text style={st.instItemName} numberOfLines={1}>{pi.institution_short_name||pi.institution_name}</Text>{pi.is_primary&&<View style={st.primaryChip}><Text style={st.primaryChipTxt}>Primary</Text></View>}{pi.verified_via_email&&<Feather name="check-circle" size={13} color="#059669"/>}</View><Text style={st.instItemMeta}>{pi.relationship_type.charAt(0).toUpperCase()+pi.relationship_type.slice(1)}{pi.start_year?' \u00b7 '+pi.start_year+(pi.end_year?'\u2013'+pi.end_year:''):''}</Text></View><TouchableOpacity onPress={()=>{const buttons=pi.is_primary?[{text:'Remove',style:'destructive' as const,onPress:()=>handleRemoveInstitution(pi.institution_id,pi.institution_name)},{text:'Cancel',style:'cancel' as const}]:[{text:'Make primary',onPress:()=>handleSetPrimary(pi.institution_id)},{text:'Remove',style:'destructive' as const,onPress:()=>handleRemoveInstitution(pi.institution_id,pi.institution_name)},{text:'Cancel',style:'cancel' as const}];Alert.alert(pi.institution_name,undefined,buttons);}} hitSlop={{top:10,bottom:10,left:10,right:10}}><Feather name="more-horizontal" size={18} color={TEXT_SECONDARY}/></TouchableOpacity></View>))
          )}
          {myAffiliations.length>0&&(<><Text style={[st.instSectionTitle,{marginTop:20,marginBottom:10}]}>Affiliations</Text>{myAffiliations.map(a=>(<View key={a.id} style={st.instItemRow}><View style={[st.instItemIcon,{backgroundColor:'#F0EEFF'}]}><Feather name="users" size={16} color="#5856D6"/></View><View style={{flex:1}}><Text style={st.instItemName} numberOfLines={1}>{a.affiliation_name}</Text><Text style={st.instItemMeta}>{a.kind.replace(/_/g,' ')}{a.institution_name?' \u00b7 '+a.institution_name:' \u00b7 Global'}{a.is_official?' \u00b7 Official':''}</Text></View></View>))}</>)}
        </View>

        <View style={st.tabsContainer}>
'@, @'
        <View style={st.tabsContainer}>
'@)
  ,@(@'

      <Modal visible={addInstOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setAddInstOpen(false)}>
        <SafeAreaView style={{flex:1,backgroundColor:'#FFF'}}>
          <View style={st.modalHeader}><View style={{width:60}}/><Text style={st.modalTitle}>Add school</Text><TouchableOpacity onPress={()=>setAddInstOpen(false)} style={{width:60,alignItems:'flex-end'}}><Feather name="x" size={22} color="#000"/></TouchableOpacity></View>
          <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
            <TextInput value={instQuery} onChangeText={searchInstitutionsForAdd} placeholder="Search schools..." placeholderTextColor={TEXT_SECONDARY} style={st.addInstSearch} autoCapitalize="none" autoFocus/>
            <FlatList data={instResults} keyExtractor={it=>it.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:20}} renderItem={({item})=>(<TouchableOpacity style={st.addInstRow} onPress={()=>handleAddInstitution(item)} disabled={addingInstitution} activeOpacity={0.7}><View style={st.instItemIcon}><Feather name="award" size={18} color={NAVY}/></View><View style={{flex:1}}><Text style={st.instItemName} numberOfLines={1}>{item.name}</Text><Text style={st.instItemMeta}>{[item.short_name,item.city,item.state].filter(Boolean).join(' \u00b7 ')||item.country}</Text></View>{addingInstitution?<ActivityIndicator size={14} color={NAVY}/>:<Feather name="plus-circle" size={20} color={NAVY}/>}</TouchableOpacity>)} ListEmptyComponent={<Text style={{padding:20,textAlign:'center',color:TEXT_SECONDARY}}>No matching schools found</Text>}/>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

'@, @'


'@)
  ,@(@'
onRefresh={()=>{setRefreshing(true);load();loadMemberships();loadHighlights();loadTabContent(activeTab);}}
'@, @'
onRefresh={()=>{setRefreshing(true);load();loadHighlights();loadTabContent(activeTab);}}
'@)
)
Edit-File "src\screens\profile\ProfileScreen.tsx" $pairs0

$pairs1 = @(
  ,@(@'
type Tab = 'people' | 'posts' | 'jobs' | 'events';
'@, @'
type Tab = 'people' | 'posts' | 'jobs';
'@)
  ,@(@'
  { id: 'events', label: 'Events', emoji: '📅' },

'@, @'

'@)
  ,@(@'
  const [events, setEvents] = useState<any[]>([]);

'@, @'

'@)
  ,@(@'
      setPeople([]); setPosts([]); setJobs([]); setEvents([]);
'@, @'
      setPeople([]); setPosts([]); setJobs([]);
'@)
  ,@(@'
      const [pplRes, postRes, jobRes, evtRes] = await Promise.all([
'@, @'
      const [pplRes, postRes, jobRes] = await Promise.all([
'@)
  ,@(@'
        supabase
          .from('mingle_posts')
          .select('id, host_id, title, category, location, event_time, image_url, created_at')
          .or(`title.ilike.${like},location.ilike.${like},category.ilike.${like}`)
          .order('created_at', { ascending: false })
          .limit(20),

'@, @'

'@)
  ,@(@'
      setEvents(evtRes.data || []);

'@, @'

'@)
  ,@(@'
    jobs:   jobs.length,
    events: events.length,
  }), [people, posts, jobs, events]);
'@, @'
    jobs:   jobs.length,
  }), [people, posts, jobs]);
'@)
  ,@(@'
  const renderEvent = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={s.eventRow}
      activeOpacity={0.85}
      onPress={() => { saveRecent(query); navigation.navigate('MingleDetails', { postId: item.id }); }}
    >
      {item.image_url
        ? <Image source={{ uri: item.image_url }} style={s.eventImg} />
        : <View style={[s.eventImg, { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 22 }}>📅</Text>
          </View>}
      <View style={{ flex: 1 }}>
        <Text style={s.eventTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>{item.category}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>📍 {item.location}</Text>
        <Text style={s.eventMeta} numberOfLines={1}>⏰ {item.event_time}</Text>
      </View>
    </TouchableOpacity>
  );


'@, @'

'@)
  ,@(@'
    activeTab === 'posts'  ? posts  :
    activeTab === 'jobs'   ? jobs   :
    events;
'@, @'
    activeTab === 'posts'  ? posts  :
    jobs;
'@)
  ,@(@'
    activeTab === 'posts'  ? renderPost :
    activeTab === 'jobs'   ? renderJob :
    renderEvent;
'@, @'
    activeTab === 'posts'  ? renderPost :
    renderJob;
'@)
  ,@(@'
placeholder="Search people, posts, jobs, events..."
'@, @'
placeholder="Search people, posts, and jobs..."
'@)
  ,@(@'
Find classmates, posts, jobs, and events.
'@, @'
Find people, posts, and jobs.
'@)
)
Edit-File "src\screens\feed\SearchScreen.tsx" $pairs1

$pairs2 = @(
  ,@(@'
label = 'ASU Verified'
'@, @'
label = 'Verified'
'@)
)
Edit-File "src\components\VerifiedBadge.tsx" $pairs2

Write-Host ""; Write-Host "==== VERIFICATION ====" -ForegroundColor Cyan
$bad1 = Select-String -Path "src\screens\profile\ProfileScreen.tsx" -Pattern "institutionsService|DEGREE_PROGRAMS|Graduation|Schools|loadMemberships" -Quiet
$bad2 = Select-String -Path "src\screens\feed\SearchScreen.tsx" -Pattern "mingle|renderEvent|classmates" -Quiet
$ok3  = Select-String -Path "src\components\VerifiedBadge.tsx" -Pattern "label = .Verified." -Quiet
if (-not $bad1 -and -not $bad2 -and $ok3) { Write-Host "PHASE 1B CLEAN - press r in the Metro terminal to reload the app" -ForegroundColor Green } else { Write-Host "LEFTOVERS FOUND - paste this output to Claude" -ForegroundColor Red }