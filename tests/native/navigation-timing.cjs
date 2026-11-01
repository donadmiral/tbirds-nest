/** Installed exclusively by the disposable native UI entry. No user data is recorded. */
function createNavigationTimingRecorder({ write, now = () => performance.now(), wallNow = Date.now }) {
  const origin = now();
  const events = [];
  let dropped = 0;
  let pending = Promise.resolve();
  const screens = new Set(['Feed', 'Market', 'Jobs', 'Studio', 'Messages', 'Profile']);
  const phases = new Set(['tab-press', 'inbox-commit', 'inbox-frame', 'inbox-row-layout']);
  function record(phase, screen, rowCount = 0) {
    if (!phases.has(phase) || !screens.has(screen) || !Number.isInteger(rowCount) || rowCount < 0) return;
    if (events.length >= 128) dropped++;
    else events.push({ sequence: events.length + 1, phase, screen, rowCount,
      atMs: Math.round((now() - origin) * 1000) / 1000, atUnixMs: wallNow() });
    const snapshot = JSON.stringify({ schemaVersion: 1, mode: 'synthetic-native-navigation-timing',
      events, dropped, meaning: 'App JS tab press, committed inbox and scheduled frame. Visual assertions remain separate.' });
    pending = pending.then(() => write(snapshot)).catch(() => {});
  }
  return { record, flush: () => pending };
}
module.exports = { createNavigationTimingRecorder };
