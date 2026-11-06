const fs = require('node:fs');
function finite(value, name, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw Error(`Invalid ${name}`); return value;
}
function liveCapacity(input) {
  const users = finite(input.registeredUsers, 'registeredUsers', 1);
  const viewers = finite(input.concurrentViewers, 'concurrentViewers');
  const broadcasts = finite(input.concurrentBroadcasts, 'concurrentBroadcasts');
  const bitrate = finite(input.averageVideoMbps, 'averageVideoMbps', .1);
  const headroom = finite(input.headroom, 'headroom', 1);
  const chat = finite(input.chatMessagesPerSecond, 'chatMessagesPerSecond');
  const subscribers = finite(input.averageChatSubscribers, 'averageChatSubscribers');
  const clips = finite(input.clipJobsPerMinute, 'clipJobsPerMinute');
  const render = finite(input.clipRenderP95Seconds, 'clipRenderP95Seconds');
  if (viewers > users) throw Error('concurrentViewers exceeds registeredUsers');
  return {
    assumptions: { ...input }, measured: false,
    videoEgressGbps: viewers * bitrate / 1000,
    reservedVideoEgressGbps: viewers * bitrate * headroom / 1000,
    viewerHoursPerPeakHour: viewers,
    videoEgressGBPerPeakHour: viewers * bitrate * 3600 / 8 / 1000,
    playbackAuthorizationRps: Math.ceil(viewers / 90),
    reservedPlaybackAuthorizationRps: Math.ceil(viewers / 90 * headroom),
    chatFanoutMessagesPerSecond: chat * subscribers,
    reservedChatFanoutMessagesPerSecond: chat * subscribers * headroom,
    reservedConcurrentBroadcasts: Math.ceil(broadcasts * headroom),
    reservedClipWorkers: Math.ceil(clips / 60 * render * headroom),
  };
}
function checkLiveEvidence(plan, evidence) {
  const missing = [];
  const atLeast = (key, required) => {
    if (!Number.isFinite(evidence[key]) || evidence[key] < required) missing.push(`${key} must be at least ${required}`);
  };
  atLeast('measuredConcurrentViewers', plan.assumptions.concurrentViewers);
  atLeast('reservedVideoEgressGbps', plan.reservedVideoEgressGbps);
  atLeast('measuredPlaybackAuthorizationRps', plan.reservedPlaybackAuthorizationRps);
  atLeast('measuredChatFanoutMessagesPerSecond', plan.reservedChatFanoutMessagesPerSecond);
  atLeast('reservedConcurrentBroadcasts', plan.reservedConcurrentBroadcasts);
  atLeast('reservedClipWorkers', plan.reservedClipWorkers);
  atLeast('soakHours', 24);
  for (const key of ['regionalPlaybackPassed', 'reconnectBurstPassed', 'failedWorkerRecoveryPassed', 'revokedMediaAccessPassed', 'billingBudgetApproved']) {
    if (evidence[key] !== true) missing.push(`${key} requires observed acceptance`);
  }
  if (typeof evidence.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(evidence.sourceCommit)) missing.push('sourceCommit must identify the tested code');
  if (typeof evidence.receipt !== 'string' || !evidence.receipt.trim()) missing.push('receipt must identify retained measurement evidence');
  return { accepted: missing.length === 0, missing };
}
module.exports = { liveCapacity, checkLiveEvidence };
if (require.main === module) {
  if (!process.argv[2]) throw Error('Usage: node live-capacity.cjs scenario.json [measured-evidence.json]');
  const plan = liveCapacity(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  const gate = process.argv[3] ? checkLiveEvidence(plan, JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))) : { accepted: false, missing: ['No measured capacity evidence supplied'] };
  console.log(JSON.stringify({ ...plan, acceptance: gate }, null, 2));
  if (process.argv[3] && !gate.accepted) process.exitCode = 1;
}
