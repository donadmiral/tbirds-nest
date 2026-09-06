/**
 * Signed-in accounts on this device, Instagram's model: up to five, each kept
 * as a refresh token in secure storage (one small item per account, never a
 * password), switchable without signing in again.
 *
 * Switching hands the stored token to the server for a fresh session and
 * then restarts the JavaScript app, so every cache and store starts clean
 * for the new account. The active account's token is re-saved on every
 * refresh, because refresh tokens rotate and the stored one must be current.
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform, DevSettings } from 'react-native';
import { supabase } from '../services/supabase';

export type SavedAccount = { id: string; username: string | null; full_name: string | null; avatar_url: string | null; refresh_token: string; saved_at: number };

const INDEX_KEY = 'pc.accounts.index';
const ADDING_KEY = 'pc.accounts.adding';
const itemKey = (id: string) => 'pc.account.' + id.replace(/[^a-zA-Z0-9._-]/g, '_');
export const MAX_ACCOUNTS = 5;

async function readIndex(): Promise<string[]> {
  try { const v = await SecureStore.getItemAsync(INDEX_KEY); const arr = v ? JSON.parse(v) : []; return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
async function writeIndex(ids: string[]) { try { await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids)); } catch {} }

type State = {
  accounts: SavedAccount[];
  currentId: string | null;
  switcherOpen: boolean;
  addOpen: boolean;
  busy: boolean;
  closeAdd: () => void;
  init: () => Promise<void>;
  remember: (session: { user: { id: string }; refresh_token: string } | null, info?: { username?: string | null; full_name?: string | null; avatar_url?: string | null }) => Promise<void>;
  forget: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<string | null>;
  startAddAccount: () => Promise<void>;
  consumeAddingFlag: () => Promise<boolean>;
  logOutCurrent: () => Promise<void>;
  openSwitcher: () => void;
  closeSwitcher: () => void;
};

async function restart() {
  // A clean state for the new account. expo-updates restarts a built app;
  // the dev client restarts through DevSettings.
  try {
    const Updates = require('expo-updates');
    if (Updates?.reloadAsync && !__DEV__) { await Updates.reloadAsync(); return; }
  } catch {}
  try { DevSettings.reload(); } catch {}
}

export const useAccountsStore = create<State>((set, get) => ({
  accounts: [],
  currentId: null,
  switcherOpen: false,
  addOpen: false,
  busy: false,

  init: async () => {
    const ids = await readIndex();
    const accounts: SavedAccount[] = [];
    for (const id of ids) {
      try { const v = await SecureStore.getItemAsync(itemKey(id)); if (v) { const a = JSON.parse(v); if (a?.id && a?.refresh_token) accounts.push(a); } } catch {}
    }
    accounts.sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0));
    const { data } = await supabase.auth.getSession();
    set({ accounts, currentId: data.session?.user?.id ?? null });
  },

  remember: async (session, info) => {
    if (!session?.user?.id || !session.refresh_token) return;
    const id = session.user.id;
    const prev = get().accounts.find((a) => a.id === id);
    const next: SavedAccount = {
      id,
      username: info?.username ?? prev?.username ?? null,
      full_name: info?.full_name ?? prev?.full_name ?? null,
      avatar_url: info?.avatar_url ?? prev?.avatar_url ?? null,
      refresh_token: session.refresh_token,
      saved_at: Date.now(),
    };
    try { await SecureStore.setItemAsync(itemKey(id), JSON.stringify(next)); } catch {}
    const others = get().accounts.filter((a) => a.id !== id);
    let accounts = [next, ...others];
    if (accounts.length > MAX_ACCOUNTS) {
      const dropped = accounts.slice(MAX_ACCOUNTS); accounts = accounts.slice(0, MAX_ACCOUNTS);
      for (const d of dropped) { try { await SecureStore.deleteItemAsync(itemKey(d.id)); } catch {} }
    }
    await writeIndex(accounts.map((a) => a.id));
    set({ accounts, currentId: id });
  },

  forget: async (id) => {
    try { await SecureStore.deleteItemAsync(itemKey(id)); } catch {}
    const accounts = get().accounts.filter((a) => a.id !== id);
    await writeIndex(accounts.map((a) => a.id));
    set({ accounts });
  },

  switchTo: async (id) => {
    const target = get().accounts.find((a) => a.id === id);
    if (!target) return 'That account is no longer on this phone.';
    if (id === get().currentId) { set({ switcherOpen: false }); return null; }
    set({ busy: true });
    try {
      // The current account is never signed out: a sign-out revokes its token
      // on the server. The other account's token simply becomes the session.
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: target.refresh_token });
      if (error || !data.session) {
        await get().forget(id);
        set({ busy: false });
        return 'That account needs to sign in again.';
      }
      await get().remember(data.session as any, target);
      set({ switcherOpen: false, busy: false });
      await restart();
      return null;
    } catch (e: any) {
      set({ busy: false });
      return e?.message || 'Could not switch.';
    }
  },

  startAddAccount: async () => {
    if (get().accounts.length >= MAX_ACCOUNTS) return;
    set({ switcherOpen: false, addOpen: true });
  },
  closeAdd: () => set({ addOpen: false }),

  consumeAddingFlag: async () => {
    try { const v = await SecureStore.getItemAsync(ADDING_KEY); if (v) { await SecureStore.deleteItemAsync(ADDING_KEY); return true; } } catch {}
    return false;
  },

  logOutCurrent: async () => {
    const id = get().currentId;
    if (id) await get().forget(id);
    const next = get().accounts[0];
    set({ switcherOpen: false });
    if (next) { await get().switchTo(next.id); return; }
    await supabase.auth.signOut();
  },

  openSwitcher: () => set({ switcherOpen: true }),
  closeSwitcher: () => set({ switcherOpen: false }),
}));

export const isIOS = Platform.OS === 'ios';