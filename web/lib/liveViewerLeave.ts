/** The leave a closing page sends for its viewer lease. Supabase REST needs the key and bearer
 * headers, which a beacon cannot carry, so this is a keepalive fetch that outlives the page. */
export function liveViewerLeaveRequest(baseUrl: string, anonKey: string, accessToken: string, sessionId: string, playbackId: string): { url: string; init: RequestInit } {
  return {
    url: baseUrl.replace(/\/$/, '') + '/rest/v1/rpc/live_viewer_heartbeat',
    init: { method: 'POST', keepalive: true, headers: { apikey: anonKey, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_session_id: sessionId, p_playback_id: playbackId, p_active: false }) },
  };
}
