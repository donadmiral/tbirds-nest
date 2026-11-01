import type { PermissionResponse } from 'expo-modules-core';
import type * as Library from 'expo-media-library';
import type * as Picker from 'expo-image-picker';
import { createPermissionBroker } from '../../shared/devicePermissions';

const ensure = createPermissionBroker();
const camera = () => require('expo-camera').Camera as typeof import('expo-camera').Camera;
const photosAccepted = (value: { granted: boolean; accessPrivileges?: string }) => value.granted || value.accessPrivileges === 'limited';
function photoResult<T extends { granted: boolean; status: string; accessPrivileges?: string }>(value: T): T {
  // Limited access is a valid grant for the user's selected photos. Preserve the
  // accessPrivileges field; never ask to broaden it just to open a picker.
  return value.accessPrivileges === 'limited' && !value.granted ? { ...value, granted: true, status: 'granted' } : value;
}

export const getCameraPermission = (): Promise<PermissionResponse> => camera().getCameraPermissionsAsync();
export const getMicrophonePermission = (): Promise<PermissionResponse> => camera().getMicrophonePermissionsAsync();
export const ensureCameraPermission = (): Promise<PermissionResponse> => ensure('camera', getCameraPermission, () => camera().requestCameraPermissionsAsync());
export const ensureMicrophonePermission = (): Promise<PermissionResponse> => ensure('microphone', getMicrophonePermission, () => camera().requestMicrophonePermissionsAsync());

export async function ensureImagePickerLibraryPermission(writeOnly = false): Promise<Picker.MediaLibraryPermissionResponse> {
  const picker = require('expo-image-picker') as typeof Picker;
  return photoResult(await ensure(`photos:${writeOnly ? 'write' : 'read'}`,
    () => picker.getMediaLibraryPermissionsAsync(writeOnly),
    () => picker.requestMediaLibraryPermissionsAsync(writeOnly), photosAccepted));
}

export async function ensureMediaLibraryPermission(options: { writeOnly?: boolean; granularPermissions?: Library.GranularPermission[] } = {}): Promise<Library.PermissionResponse> {
  const library = require('expo-media-library') as typeof Library;
  const { writeOnly = false, granularPermissions } = options;
  const scope = [...new Set(granularPermissions ?? ['audio', 'photo', 'video'])].sort().join(',');
  return photoResult(await ensure(`photos:${writeOnly ? 'write' : 'read'}:${scope}`,
    () => library.getPermissionsAsync(writeOnly, granularPermissions),
    () => library.requestPermissionsAsync(writeOnly, granularPermissions), photosAccepted));
}

export async function ensureForegroundLocationPermission() {
  const location = require('expo-location') as typeof import('expo-location');
  return ensure('location', () => location.getForegroundPermissionsAsync(), () => location.requestForegroundPermissionsAsync());
}

export async function ensureNotificationPermission() {
  const notifications = require('expo-notifications') as typeof import('expo-notifications');
  const accepted = (value: import('expo-notifications').NotificationPermissionsStatus) => value.granted
    || value.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL
    || value.ios?.status === notifications.IosAuthorizationStatus.EPHEMERAL;
  const value = await ensure('notifications', () => notifications.getPermissionsAsync(), () => notifications.requestPermissionsAsync(), accepted);
  return accepted(value) ? { ...value, granted: true, status: 'granted' as typeof value.status } : value;
}
