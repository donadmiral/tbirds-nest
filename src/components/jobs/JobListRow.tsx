/**
 * JobListRow — one job row used by SavedJobsScreen and MyApplicationsScreen.
 * Brand monogram block, title, company · place, and an optional right slot
 * (bookmark toggle, status chip). Whole row taps through to JobDetail.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const NAVY = '#0B1E3D';
const PLATINUM = '#C9BFB0';

export default function JobListRow({ job, subtitle, right, onPress }: {
  job: any; subtitle?: string | null; right?: React.ReactNode; onPress: () => void;
}) {
  const logo = String(job?.company || '?').trim().charAt(0).toUpperCase();
  const place = job?.remote_type === 'remote' ? 'Remote'
    : job?.remote_type === 'hybrid' ? [job?.location, 'Hybrid'].filter(Boolean).join(' · ')
    : (job?.location || '');
  return (
    <TouchableOpacity style={st.row} activeOpacity={0.88} onPress={onPress}>
      <View style={st.logo}><Text style={st.logoTxt}>{logo}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.title} numberOfLines={1}>{job?.title || 'Job'}</Text>
        <Text style={st.meta} numberOfLines={1}>{[job?.company, place].filter(Boolean).join('  ·  ')}</Text>
        {subtitle ? <Text style={st.sub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: '#FFFFFF' },
  logo: { width: 46, height: 46, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(201,191,176,0.7)' },
  logoTxt: { fontSize: 17, fontWeight: '800', color: PLATINUM },
  title: { fontSize: 15.5, fontWeight: '700', color: NAVY, letterSpacing: -0.2 },
  meta: { fontSize: 13, color: 'rgba(11,30,61,0.6)', marginTop: 2 },
  sub: { fontSize: 12, color: 'rgba(11,30,61,0.42)', marginTop: 2 },
});