'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, Check, Link as LinkIcon, Plus, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { checkUploadableBytes } from '@/lib/media';
import { withTimeout } from '@/lib/withTimeout';
import { profilePath } from '@/lib/profileLookup';
import { EMPTY_PROFILE, readProfileDraft, validatedProfile, type ProfileDraft } from '@/lib/profileForm';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/ui';
import styles from './profile.module.css';

type ImageDraft = { file: File; path: string; preview: string };
type PhotoKind = 'avatar' | 'banner';
const FIELDS = 'id,username,full_name,bio,headline,workplace,location,profile_visibility,avatar_url,banner_url,links';
type NavigationDraft = { owner: string; draft: ProfileDraft; photos: Partial<Record<PhotoKind, Pick<ImageDraft, 'file' | 'path'>>>; at: number };
// Keep at most one owner's unfinished work in this tab's memory. Files never
// enter localStorage or a server until Save. This also covers browser Back,
// which changes a Next route without triggering beforeunload.
let navigationDraft: NavigationDraft | null = null;

/** Uploads belong to the verified owner and are not sent until Save is chosen. */
export default function EditProfilePage() {
  const [client] = useState(createClient);
  const router = useRouter();
  const [owner, setOwner] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [baseline, setBaseline] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, ImageDraft>>>({});
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [recovery, setRecovery] = useState<NavigationDraft | null>(null);
  const scope = useRef({ owner: undefined as string | null | undefined, generation: 0 });
  const alive = useRef(false), lock = useRef(false), photoVersion = useRef(0);
  const avatarInput = useRef<HTMLInputElement>(null), bannerInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const dirty = loaded && (JSON.stringify(draft) !== baseline || !!photos.avatar || !!photos.banner);
  const destination = owner ? profilePath(username, owner) : '/settings';

  useEffect(() => {
    alive.current = true;
    scope.current = { owner: undefined, generation: scope.current.generation + 1 };
    setError('');
    const bind = (id: string | null) => {
      if (!alive.current || scope.current.owner === id) return;
      scope.current = { owner: id, generation: scope.current.generation + 1 };
      photoVersion.current++;
      if (navigationDraft?.owner !== id) navigationDraft = null;
      lock.current = false; setBusy(false);
      setOwner(id); setDraft(EMPTY_PROFILE); setBaseline(''); setLoaded(false); setUsername(null); setPhotos({}); setSaved(false); setError(''); setCheckingPhoto(false); setRecovery(null);
      if (!id) setError('Sign in to edit your profile.');
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => bind(session?.user.id ?? null));
    const generation = scope.current.generation;
    void withTimeout(client.auth.getUser()).then(({ data, error: cause }) => {
      if (alive.current && scope.current.generation === generation) {
        if (cause) { setError('Your account could not be checked. Reload or sign in again.'); return; }
        bind(data.user?.id ?? null);
      }
    }, () => { if (alive.current && scope.current.generation === generation) setError('Your account could not be checked. Reload or sign in again.'); });
    return () => { alive.current = false; scope.current.generation++; photoVersion.current++; subscription.unsubscribe(); };
  }, [client, authAttempt]);

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    const generation = scope.current.generation;
    setError('');
    void withTimeout(client.from('profiles').select(FIELDS).eq('id', owner).maybeSingle()).then(({ data, error: cause }) => {
      if (cancelled || generation !== scope.current.generation) return;
      if (cause || data?.id !== owner) { setError('Your profile could not load. Please try again.'); return; }
      const value = readProfileDraft(data);
      if (navigationDraft?.owner === owner && Date.now() - navigationDraft.at < 30 * 60 * 1000) setRecovery(navigationDraft);
      else navigationDraft = null;
      setDraft(value); setBaseline(JSON.stringify(value)); setUsername(data.username); setLoaded(true);
    }, () => { if (!cancelled && generation === scope.current.generation) setError('Your profile could not load. Please try again.'); });
    return () => { cancelled = true; };
  }, [client, owner, attempt]);

  useEffect(() => {
    if (!loaded || !owner || recovery || scope.current.owner !== owner) return;
    if (!dirty) { if (navigationDraft?.owner === owner) navigationDraft = null; return; }
    const retained: NavigationDraft['photos'] = {};
    for (const kind of ['avatar', 'banner'] as const) if (photos[kind]) retained[kind] = { file: photos[kind]!.file, path: photos[kind]!.path };
    navigationDraft = { owner, draft, photos: retained, at: Date.now() };
  }, [loaded, owner, draft, photos, dirty, recovery]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leaving = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.getAttribute('target') === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const next = new URL(href, window.location.href);
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      if (!window.confirm('Discard these unsaved profile changes?')) { event.preventDefault(); event.stopPropagation(); }
      else if (navigationDraft?.owner === owner) navigationDraft = null;
    };
    const submittingElsewhere = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement) || event.target.closest('[data-profile-editor]')) return;
      if (!window.confirm('Discard these unsaved profile changes?')) { event.preventDefault(); event.stopPropagation(); }
      else if (navigationDraft?.owner === owner) navigationDraft = null;
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', leaving, true);
    document.addEventListener('submit', submittingElsewhere, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', leaving, true); document.removeEventListener('submit', submittingElsewhere, true); };
  }, [dirty, owner]);
  useEffect(() => {
    const retained = new Set(Object.values(photos).map(photo => photo.preview));
    for (const url of previewUrls.current) if (!retained.has(url)) { URL.revokeObjectURL(url); previewUrls.current.delete(url); }
  }, [photos]);
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url); previewUrls.current.clear(); }, []);

  function change<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    if (recovery) { navigationDraft = null; setRecovery(null); }
    setDraft(current => ({ ...current, [key]: value })); setSaved(false);
  }
  function restoreDraft() {
    if (!recovery || recovery.owner !== owner || recovery.owner !== scope.current.owner) return;
    const restored: Partial<Record<PhotoKind, ImageDraft>> = {};
    for (const kind of ['avatar', 'banner'] as const) {
      const photo = recovery.photos[kind]; if (!photo) continue;
      const preview = URL.createObjectURL(photo.file); previewUrls.current.add(preview);
      restored[kind] = { ...photo, preview };
    }
    setDraft(recovery.draft); setPhotos(restored); setRecovery(null); setSaved(false); setError('');
  }
  async function choosePhoto(kind: PhotoKind, file?: File) {
    if (!file || !owner || lock.current) return;
    const generation = scope.current.generation, version = ++photoVersion.current;
    setCheckingPhoto(true); setError('');
    const current = () => alive.current && generation === scope.current.generation && version === photoVersion.current;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
      const issue = await checkUploadableBytes(file);
      if (issue) throw new Error(issue);
      if (!current()) return;
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const image = { file, path: `${owner}/${kind}_${crypto.randomUUID()}.${extension}`, preview: URL.createObjectURL(file) };
      if (recovery) { navigationDraft = null; setRecovery(null); }
      previewUrls.current.add(image.preview);
      setPhotos(previous => ({ ...previous, [kind]: image })); setSaved(false);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'That photo could not be opened.'); }
    finally { if (current()) setCheckingPhoto(false); }
  }
  function removePhoto(kind: PhotoKind) {
    setPhotos(previous => { const next = { ...previous }; delete next[kind]; return next; });
    change(kind === 'avatar' ? 'avatar_url' : 'banner_url', null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!owner || !loaded || lock.current || checkingPhoto || recovery || !dirty) return;
    lock.current = true; setBusy(true); setError(''); setSaved(false);
    const generation = scope.current.generation;
    const current = () => alive.current && generation === scope.current.generation && scope.current.owner === owner;
    try {
      const value = validatedProfile(draft);
      const { data: auth, error: authError } = await withTimeout(client.auth.getUser());
      if (!current()) return;
      if (authError || auth.user?.id !== owner) throw new Error('Your account changed. Reload this page before saving.');
      for (const kind of ['avatar', 'banner'] as const) {
        const image = photos[kind];
        if (!image) continue;
        // The random path is stable for retries of this exact chosen file.
        const { error: uploadError } = await withTimeout(client.storage.from('avatars').upload(image.path, image.file, { upsert: true, contentType: image.file.type, cacheControl: '3600' }), 45000);
        if (!current()) return;
        if (uploadError) throw new Error(`Your ${kind === 'avatar' ? 'profile' : 'cover'} photo could not upload. Keep this page open and try Save again.`);
        value[kind === 'avatar' ? 'avatar_url' : 'banner_url'] = client.storage.from('avatars').getPublicUrl(image.path).data.publicUrl;
      }
      const latest = await withTimeout(client.auth.getUser());
      if (!current()) return;
      if (latest.error || latest.data.user?.id !== owner) throw new Error('Your account changed. Reload this page before saving.');
      const { data, error: writeError } = await withTimeout(client.from('profiles').update({ ...value, updated_at: new Date().toISOString() }).eq('id', owner).select(FIELDS).maybeSingle());
      if (!current()) return;
      if (writeError || data?.id !== owner) throw new Error('We could not confirm your changes. Your draft is still here; try Save again.');
      const confirmed = readProfileDraft(data);
      navigationDraft = null;
      setDraft(confirmed); setBaseline(JSON.stringify(confirmed)); setPhotos({}); setSaved(true); router.refresh();
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Your profile was not saved. Please try again.'); }
    finally { if (generation === scope.current.generation) { lock.current = false; if (alive.current) setBusy(false); } }
  }
  function cancel() {
    if (busy) return;
    if (!dirty || window.confirm('Discard these unsaved profile changes?')) { if (dirty && navigationDraft?.owner === owner) navigationDraft = null; router.push(destination); }
  }

  if (!loaded) return <section className={styles.page}><PageHeader title="Edit profile" subtitle="Make your profile feel like you." />{error ? <ErrorState title={error} onRetry={() => owner ? setAttempt(value => value + 1) : setAuthAttempt(value => value + 1)} /> : <p role="status" className="py-10 text-sm text-muted">Loading your profile…</p>}{!owner && error ? <Link href="/login" className="underline">Sign in</Link> : null}</section>;
  const banner = photos.banner?.preview || draft.banner_url, avatar = photos.avatar?.preview || draft.avatar_url;
  return <section className={styles.page} data-profile-editor>
    <PageHeader title="Edit profile" subtitle="Your name, your story and the work you want to share." />
    {recovery ? <section className={styles.recovery} aria-label="Unsaved profile draft"><div><strong>Continue your unsaved changes?</strong><p>Your saved profile is shown below. Restore the draft from this tab to continue editing.</p></div><button type="button" onClick={restoreDraft}>Restore draft</button><button type="button" onClick={() => { navigationDraft = null; setRecovery(null); }}>Discard draft</button></section> : null}
    <form onSubmit={save} className={styles.form}>
      <fieldset disabled={busy || checkingPhoto || !!recovery} className={styles.fields}>
        <legend className="sr-only">Profile information</legend>
        <div className={styles.cover}>
          {banner ? <img src={banner} alt="Cover photo preview" /> : <span>Make room for your story.</span>}
          <div className={styles.coverTools}><button type="button" onClick={() => bannerInput.current?.click()}><Camera size={16} aria-hidden />{banner ? 'Change cover' : 'Add cover'}</button>{banner ? <button type="button" onClick={() => removePhoto('banner')} aria-label="Remove cover photo"><X size={16} /></button> : null}</div>
        </div>
        <div className={styles.photoRow}>
          <button type="button" className={styles.avatar} onClick={() => avatarInput.current?.click()} aria-label="Choose profile photo">{avatar ? <img src={avatar} alt="Profile photo preview" /> : <span>{draft.full_name.slice(0, 1).toUpperCase()}</span>}<i><Camera size={17} aria-hidden /></i></button>
          <div><strong>Profile photo</strong><p>JPG, PNG or WebP, up to 10 MB.</p>{avatar ? <button type="button" onClick={() => removePhoto('avatar')} className={styles.textButton}>Remove photo</button> : null}</div>
        </div>
        <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Profile photo file" onChange={event => { void choosePhoto('avatar', event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Cover photo file" onChange={event => { void choosePhoto('banner', event.target.files?.[0]); event.target.value = ''; }} />
        <div className={styles.grid}>
          <label>Name<input required maxLength={100} autoComplete="name" value={draft.full_name} onChange={event => change('full_name', event.target.value)} /></label>
          <div className={styles.username}><span>Username</span><strong>{username ? '@' + username : 'No username yet'}</strong><Link href="/settings/username">Change username</Link></div>
          <label className={styles.full}>Headline<input maxLength={120} placeholder="What you do or what you care about" value={draft.headline} onChange={event => change('headline', event.target.value)} /></label>
          <label className={styles.full}>Bio<textarea aria-label="Bio" aria-describedby="profile-bio-count" rows={4} maxLength={500} placeholder="A little about you" value={draft.bio} onChange={event => change('bio', event.target.value)} /><small id="profile-bio-count">{draft.bio.length}/500 characters</small></label>
          <label>Workplace<input maxLength={120} autoComplete="organization" value={draft.workplace} onChange={event => change('workplace', event.target.value)} /></label>
          <label>Location<input maxLength={120} placeholder="City or region" value={draft.location} onChange={event => change('location', event.target.value)} /></label>
        </div>
        <section className={styles.links}>
          <header><div><h2><LinkIcon size={18} aria-hidden />Profile links</h2><p>Your portfolio, business or favorite corner of the web.</p></div><button type="button" disabled={draft.links.length >= 5} onClick={() => change('links', [...draft.links, { title: '', url: '' }])}><Plus size={16} aria-hidden />Add link</button></header>
          {draft.links.map((link, index) => <div className={styles.linkRow} key={index}>
            <label>Link {index + 1} title<input maxLength={80} value={link.title} placeholder="Website" onChange={event => change('links', draft.links.map((value, at) => at === index ? { ...value, title: event.target.value } : value))} /></label>
            <label>Address<input aria-label={`Link ${index + 1} address`} maxLength={2048} inputMode="url" value={link.url} placeholder="https://" onChange={event => change('links', draft.links.map((value, at) => at === index ? { ...value, url: event.target.value } : value))} /></label>
            <button type="button" aria-label={`Remove link ${index + 1}`} onClick={() => change('links', draft.links.filter((_value, at) => at !== index))}><Trash2 size={18} /></button>
          </div>)}
        </section>
        <div className={styles.visibility}><label>Profile visibility<select value={draft.profile_visibility} onChange={event => change('profile_visibility', event.target.value as 'public' | 'private')}><option value="public">Public</option><option value="private">Private account</option></select></label><p>With a private account, you approve new followers. Your name, username and profile photos may still identify your account.</p></div>
      </fieldset>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {saved ? <p role="status" className={styles.success}><Check size={17} aria-hidden />Your profile has been saved. <Link href={destination}>View profile</Link></p> : null}
      <footer className={styles.footer}><span aria-live="polite">{busy ? 'Saving your profile…' : checkingPhoto ? 'Checking photo…' : recovery ? 'Unsaved draft available' : dirty ? 'Unsaved changes' : 'All changes saved'}</span><button type="button" disabled={busy} onClick={cancel}>{dirty ? 'Cancel' : 'Back to profile'}</button><button type="submit" disabled={busy || checkingPhoto || !dirty} className={styles.save}>{busy ? 'Saving…' : 'Save changes'}</button></footer>
    </form>
  </section>;
}
