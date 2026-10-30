"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Archive, AtSign, Bell, Briefcase, ChevronRight, Download, EyeOff, FileText, Fingerprint, HelpCircle, Info, KeyRound, LifeBuoy, ListFilter, LockKeyhole, Monitor, Search, Shield, ShieldAlert, ShieldOff, Trash2, UserCheck, UserMinus, UserRound, Users, VolumeX, Wallet, X, type LucideIcon } from "lucide-react";
import { autoplayEnabled, dataSaverEnabled, setAutoplay, setDataSaver } from "@/lib/mediaPrefs";
import { PageHeader } from "@/components/ui";
import { AccountStatus } from "@/components/AccountStatus";
import { ThemeToggle } from "@/components/ThemeToggle";
import styles from './SettingsPage.module.css';

type SettingsRow = { href: string; icon: LucideIcon; label: string; description: string };
type SettingsSection = { id: string; label: string; icon: LucideIcon; description: string; rows: SettingsRow[] };
const SECTIONS: SettingsSection[] = [
  { id: 'account', label: 'Account and profile', icon: UserRound, description: 'How people see you and connect with your work.', rows: [
    { href: '/settings/profile', icon: UserRound, label: 'Edit profile', description: 'Your photo, cover, name, bio, links and profile visibility' },
    { href: '/settings/username', icon: AtSign, label: 'Username', description: 'Change the @handle people use to find you' },
    { href: '/settings/account-type', icon: UserCheck, label: 'Account type', description: 'Personal, creator, organization or automated account' },
    { href: '/settings/verification', icon: Shield, label: 'Verification', description: 'View eligibility and apply for verification' },
  ] },
  { id: 'privacy', label: 'Privacy and interactions', icon: LockKeyhole, description: 'Choose who can reach you and what you see.', rows: [
    { href: '/settings/follow-requests', icon: Users, label: 'Follow requests', description: 'Review who follows your private account' },
    { href: '/settings/blocked', icon: ShieldOff, label: 'Blocked accounts', description: 'Manage the accounts you have blocked' },
    { href: '/settings/restricted', icon: UserMinus, label: 'Restricted accounts', description: 'Review their comments and move their messages to requests' },
    { href: '/settings/muted', icon: VolumeX, label: 'Muted stories', description: 'Choose whose stories appear in your story row' },
    { href: '/settings/hidden-words', icon: EyeOff, label: 'Hidden words', description: 'Filter comments containing words you choose' },
    { href: '/settings/muted-words', icon: ListFilter, label: 'Muted words', description: 'Keep posts with certain words out of your feed' },
  ] },
  { id: 'security', label: 'Security and access', icon: KeyRound, description: 'Protect your sign-in and review account activity.', rows: [
    { href: '/settings/two-factor', icon: Fingerprint, label: 'Two-factor authentication', description: 'Set up an authenticator app for added sign-in protection' },
    { href: '/settings/login-activity', icon: Monitor, label: 'Login activity', description: 'Review signed-in devices and end other sessions' },
    { href: '/settings/standing', icon: ShieldAlert, label: 'Account standing', description: 'Your account record and any current restrictions' },
  ] },
  { id: 'activity', label: 'Activity and your data', icon: Activity, description: 'Revisit your activity and manage your information.', rows: [
    { href: '/settings/activity', icon: Activity, label: 'Your activity', description: 'Likes, comments, reposts and saved posts' },
    { href: '/settings/archive', icon: Archive, label: 'Archive', description: 'Posts you hid from your profile without deleting them' },
    { href: '/settings/notifications', icon: Bell, label: 'Notifications', description: 'Choose which kinds of activity reach your phone' },
    { href: '/settings/download', icon: Download, label: 'Download your data', description: 'Request a copy of your account information' },
    { href: '/settings/delete-account', icon: Trash2, label: 'Delete account', description: 'Request permanent removal and track stored-file erasure' },
  ] },
  { id: 'professional', label: 'Professional tools', icon: Briefcase, description: 'Manage publishing, your business and your earnings.', rows: [
    { href: '/studio', icon: Briefcase, label: 'Studio', description: 'Your content, professional workflows and account insights' },
    { href: '/monetization', icon: Wallet, label: 'Monetization', description: 'Creator eligibility, earnings and payout status' },
    { href: '/businesses', icon: Users, label: 'Your businesses', description: 'Business accounts and teams you manage' },
    { href: '/businesses/apply', icon: FileText, label: 'Apply for a business account', description: 'Submit your organization for review' },
  ] },
  { id: 'device', label: 'Appearance and media', icon: Monitor, description: 'Preferences for this browser.', rows: [] },
  { id: 'help', label: 'Help and information', icon: HelpCircle, description: 'Find an answer or get help from the support team.', rows: [
    { href: '/settings/help', icon: HelpCircle, label: 'Help center', description: 'Answers to common questions and support tickets' },
    { href: '/settings/support', icon: LifeBuoy, label: 'Contact support', description: 'Describe an issue and follow your conversation' },
    { href: '/about', icon: Info, label: 'About Platinum Circles', description: 'Learn about the platform' },
    { href: '/terms', icon: FileText, label: 'Terms of Service', description: 'The terms for using Platinum Circles' },
    { href: '/privacy', icon: Shield, label: 'Privacy Policy', description: 'How your information is handled' },
  ] },
];

function PreferenceSwitch({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className={styles.preference}><div><strong>{label}</strong><p>{description}</p></div><button type="button" role="switch" aria-label={label} aria-checked={value} className={styles.switch} onClick={() => onChange(!value)}><span><i /></span></button></div>;
}

export default function SettingsPage() {
  const [auto, setAuto] = useState(true), [saver, setSaver] = useState(false);
  const [query, setQuery] = useState(''), [preferenceError, setPreferenceError] = useState('');
  useEffect(() => {
    const sync = () => { setAuto(autoplayEnabled()); setSaver(dataSaverEnabled()); };
    sync(); window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const updatePreference = (kind: 'autoplay' | 'saver', next: boolean) => {
    if (kind === 'autoplay') { setAutoplay(next); setAuto(autoplayEnabled()); }
    else { setDataSaver(next); setSaver(dataSaverEnabled()); }
    const confirmed = (kind === 'autoplay' ? autoplayEnabled() : dataSaverEnabled()) === next;
    setPreferenceError(confirmed ? '' : 'Your browser could not save this preference. Allow site storage and try again.');
  };
  const needle = query.trim().toLocaleLowerCase();
  const sections = SECTIONS.map(section => ({ ...section, rows: section.rows.filter(row => !needle || (section.label + ' ' + row.label + ' ' + row.description).toLocaleLowerCase().includes(needle)) })).filter(section => section.rows.length || (section.id === 'device' && (!needle || /appearance|theme|light|dim|dark|system|media|video|autoplay|data|saver|browser/.test(needle))));
  return <div className={styles.page}>
    <PageHeader title="Settings" subtitle="Your account, your preferences and your peace of mind." />
    <label className={styles.search}><Search size={19} strokeWidth={1.75} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" />{query ? <button type="button" aria-label="Clear settings search" onClick={() => setQuery('')}><X size={17} /></button> : null}</label>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <nav aria-label="Settings sections" className={styles.index}>{sections.map(section => <a key={section.id} href={'#' + section.id}><section.icon size={18} strokeWidth={1.75} /><span>{section.label}</span><ChevronRight size={14} /></a>)}</nav>
        <div className={styles.account}><AccountStatus /></div>
      </aside>
      <div className={styles.content}>
        {needle ? <p role="status" className={styles.searchStatus}>{sections.length ? `${sections.reduce((count, section) => count + section.rows.length + (section.id === 'device' ? 3 : 0), 0)} settings match “${query.trim()}”` : `No settings match “${query.trim()}”`}</p> : null}
        {!sections.length ? <div className={styles.empty}><Search size={28} /><h2>Try a different search</h2><p>Look for a feature such as profile, privacy or notifications.</p><button type="button" onClick={() => setQuery('')}>View all settings</button></div> : null}
        {sections.map(section => <section key={section.id} id={section.id} className={styles.section} aria-labelledby={'heading-' + section.id}>
          <header><h2 id={'heading-' + section.id}>{section.label}</h2><p>{section.description}</p></header>
          {section.id === 'device' ? <div className={styles.preferences}>
            <div className={styles.appearance}><div><strong>Appearance</strong><p>Light, Dim, Lights out, or your device setting.</p></div><ThemeToggle /></div>
            <PreferenceSwitch label="Autoplay videos" description={saver ? 'Data saver is on, so videos wait for you to press play.' : 'Start videos as they come into view. Turn off to press play yourself.'} value={auto} onChange={value => updatePreference('autoplay', value)} />
            <PreferenceSwitch label="Data saver" description="Use smaller images and turn off automatic video playback on slower connections." value={saver} onChange={value => updatePreference('saver', value)} />
            {preferenceError ? <p role="alert" className={styles.error}>{preferenceError}</p> : null}
          </div> : <div>{section.rows.map(row => <Link key={row.href} href={row.href} className={styles.row}><span className={styles.icon}><row.icon size={20} strokeWidth={1.75} /></span><span><strong>{row.label}</strong><small>{row.description}</small></span><ChevronRight size={17} strokeWidth={1.75} /></Link>)}</div>}
        </section>)}
      </div>
    </div>
  </div>;
}
