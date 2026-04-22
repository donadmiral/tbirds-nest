/**
 * meetingService.ts
 * Multi-party Video Con sessions built on Daily.co.
 * Rooms persist 24 hours by default, shareable via link.
 */

import { supabase } from './supabase';
import { callService, DailyTokenResult } from './callService';

export type Meeting = {
  id: string;
  room_name: string;
  title: string;
  host_id: string;
  host_name: string | null;
  host_avatar: string | null;
  institution_id: string | null;
  is_public: boolean;
  expires_at: string;
  ended_at: string | null;
  created_at: string;
  is_ended: boolean;
  participant_count: number;
};

export type MyActiveMeeting = {
  id: string;
  room_name: string;
  title: string;
  is_public: boolean;
  expires_at: string;
  created_at: string;
  participant_count: number;
};

export const meetingService = {

  async create(params: {
    title: string;
    isPublic?: boolean;
    durationHours?: number;
  }): Promise<{ meeting: any; token: DailyTokenResult }> {
    const { data, error } = await supabase.rpc('create_meeting', {
      p_title: params.title,
      p_is_public: params.isPublic ?? true,
      p_duration_hours: params.durationHours ?? 24,
    });
    if (error) throw error;
    if (!data) throw new Error('Could not create meeting');

    // Immediately fetch Daily token as owner
    const token = await callService.getDailyToken({
      roomName: data.room_name,
      kind: 'meeting',
      isOwner: true,
    });

    return { meeting: data, token };
  },

  async getByRoomName(roomName: string): Promise<Meeting | null> {
    const { data, error } = await supabase.rpc('get_meeting_by_room', {
      p_room_name: roomName,
    });
    if (error) { console.log('[getMeetingByRoom]', error.message); return null; }
    const arr = (data || []) as Meeting[];
    return arr[0] || null;
  },

  async listMyActive(): Promise<MyActiveMeeting[]> {
    const { data, error } = await supabase.rpc('list_my_active_meetings');
    if (error) { console.log('[listMyActive]', error.message); return []; }
    return (data || []) as MyActiveMeeting[];
  },

  /**
   * Fetch a token to join an existing meeting.
   * Caller must have permission (public meeting, or host, or previously joined).
   */
  async joinMeeting(params: {
    roomName: string;
    isHost?: boolean;
  }): Promise<DailyTokenResult> {
    return callService.getDailyToken({
      roomName: params.roomName,
      kind: 'meeting',
      isOwner: params.isHost ?? false,
    });
  },

  async recordJoin(meetingId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('record_meeting_join', {
      p_meeting_id: meetingId,
    });
    if (error) { console.log('[recordJoin]', error.message); return null; }
    return data as string;
  },

  async recordLeave(participantId: string): Promise<void> {
    await supabase.rpc('record_meeting_leave', {
      p_participant_id: participantId,
    });
  },

  async endForAll(meetingId: string): Promise<void> {
    const { error } = await supabase.rpc('end_meeting', {
      p_meeting_id: meetingId,
    });
    if (error) throw error;
  },

  shareLink(roomName: string): string {
    return `https://tbirdsnest.app/meeting/${roomName}`;
  },
};/**
 * meetingService.ts
 * Multi-party Video Con sessions built on Daily.co.
 * Rooms persist 24 hours by default, shareable via link.
 */

import { supabase } from './supabase';
import { callService, DailyTokenResult } from './callService';

export type Meeting = {
  id: string;
  room_name: string;
  title: string;
  host_id: string;
  host_name: string | null;
  host_avatar: string | null;
  institution_id: string | null;
  is_public: boolean;
  expires_at: string;
  ended_at: string | null;
  created_at: string;
  is_ended: boolean;
  participant_count: number;
};

export type MyActiveMeeting = {
  id: string;
  room_name: string;
  title: string;
  is_public: boolean;
  expires_at: string;
  created_at: string;
  participant_count: number;
};

export const meetingService = {

  async create(params: {
    title: string;
    isPublic?: boolean;
    durationHours?: number;
  }): Promise<{ meeting: any; token: DailyTokenResult }> {
    const { data, error } = await supabase.rpc('create_meeting', {
      p_title: params.title,
      p_is_public: params.isPublic ?? true,
      p_duration_hours: params.durationHours ?? 24,
    });
    if (error) throw error;
    if (!data) throw new Error('Could not create meeting');

    // Immediately fetch Daily token as owner
    const token = await callService.getDailyToken({
      roomName: data.room_name,
      kind: 'meeting',
      isOwner: true,
    });

    return { meeting: data, token };
  },

  async getByRoomName(roomName: string): Promise<Meeting | null> {
    const { data, error } = await supabase.rpc('get_meeting_by_room', {
      p_room_name: roomName,
    });
    if (error) { console.log('[getMeetingByRoom]', error.message); return null; }
    const arr = (data || []) as Meeting[];
    return arr[0] || null;
  },

  async listMyActive(): Promise<MyActiveMeeting[]> {
    const { data, error } = await supabase.rpc('list_my_active_meetings');
    if (error) { console.log('[listMyActive]', error.message); return []; }
    return (data || []) as MyActiveMeeting[];
  },

  /**
   * Fetch a token to join an existing meeting.
   * Caller must have permission (public meeting, or host, or previously joined).
   */
  async joinMeeting(params: {
    roomName: string;
    isHost?: boolean;
  }): Promise<DailyTokenResult> {
    return callService.getDailyToken({
      roomName: params.roomName,
      kind: 'meeting',
      isOwner: params.isHost ?? false,
    });
  },

  async recordJoin(meetingId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('record_meeting_join', {
      p_meeting_id: meetingId,
    });
    if (error) { console.log('[recordJoin]', error.message); return null; }
    return data as string;
  },

  async recordLeave(participantId: string): Promise<void> {
    await supabase.rpc('record_meeting_leave', {
      p_participant_id: participantId,
    });
  },

  async endForAll(meetingId: string): Promise<void> {
    const { error } = await supabase.rpc('end_meeting', {
      p_meeting_id: meetingId,
    });
    if (error) throw error;
  },

  shareLink(roomName: string): string {
    return `https://tbirdsnest.app/meeting/${roomName}`;
  },
};