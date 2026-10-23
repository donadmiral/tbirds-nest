import 'react-native-get-random-values';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, SUPABASE_URL } from './supabase';
import { APPLICATION_CV_BUCKET, applicationCvFile, applicationCvPath, legacyApplicationCvPath } from '../../shared/applicationCv';

function uploadId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function uploadApplicationCv(ownerId: string, jobId: string, asset: { name: string; uri: string }) {
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || data.user?.id !== ownerId) throw new Error('The signed-in account changed. Open the application again.');
  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists || info.isDirectory) throw new Error('Choose the CV file again.');
  const file = applicationCvFile(asset.name, info.size);
  const path = `${ownerId}/${jobId}/${uploadId()}.${file.extension}`;
  if (!applicationCvPath(`${APPLICATION_CV_BUCKET}/${path}`)) throw new Error('The job or account could not be verified.');
  const bytes = decode(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }));
  applicationCvFile(asset.name, bytes.byteLength);
  const { error } = await supabase.storage.from(APPLICATION_CV_BUCKET).upload(path, bytes, {
    contentType: file.contentType, upsert: false, cacheControl: '60',
  });
  if (error) throw new Error('Could not upload your private CV. Please try again.');
  // Save a durable storage reference, never a public or expiring URL.
  return `${APPLICATION_CV_BUCKET}/${path}`;
}

export async function applicationCvUrl(reference: string, filename?: string | null): Promise<string> {
  const path = applicationCvPath(reference);
  if (path) {
    // Storage policies authorize the applicant and the hiring team for this application.
    const { data, error } = await supabase.storage.from(APPLICATION_CV_BUCKET).createSignedUrl(path, 60, { download: filename || 'CV' });
    if (error || !data?.signedUrl) throw new Error('This CV could not be opened. Please try again.');
    return data.signedUrl;
  }
  const legacyPath = legacyApplicationCvPath(reference, SUPABASE_URL);
  if (legacyPath) {
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(legacyPath, 60, { download: filename || 'CV' });
    if (error || !data?.signedUrl) throw new Error('This CV could not be opened. Please try again.');
    return data.signedUrl;
  }
  throw new Error('This CV is unavailable. Ask the applicant to upload it again.');
}
