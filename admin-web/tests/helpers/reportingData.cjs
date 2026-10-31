const { ACTOR, TARGET, NOW } = require('./reportingFixture.cjs');
const id = n => `20000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
const stamp = minutes => new Date(NOW - minutes * 60000).toISOString();
const profiles = count => Array.from({ length: count }, (_, i) => ({
  id: id(i), full_name: `Applicant ${i}`, username: `applicant${i}`, avatar_url: null,
  account_type: 'personal', created_at: stamp(60000), location: 'Austin',
}));
const jobs = count => Array.from({ length: count }, (_, i) => ({
  id: id(i), title: `Role ${i}`, company: `Company ${i % 5}`, posted_by: TARGET,
  job_type: 'full_time', location: i % 2 ? 'Hybrid' : 'Remote', created_at: stamp(i),
}));
const calls = count => Array.from({ length: count }, (_, i) => ({
  id: id(i), initiator_id: TARGET, receiver_id: ACTOR, created_at: stamp(i),
  started_at: stamp(i), duration_sec: 60, status: 'ended', is_video: false, is_group_call: false,
}));
const stories = count => Array.from({ length: count }, (_, i) => ({
  id: id(i), user_id: TARGET, content: `Story ${i}`, type: 'text', media_type: 'text',
  created_at: stamp(i), expires_at: stamp(-60), views_count: 2,
}));
const applications = count => Array.from({ length: count }, (_, i) => ({
  id: id(i), applicant_id: id(i), status: i % 2 ? 'under_review' : 'submitted',
  tier: 'public_figure', category: 'community', created_at: stamp(count - i), decided_at: null,
}));
function support() {
  return {
    tables: {
      profiles: profiles(2),
      support_tickets: [{ id: TARGET, user_id: TARGET, kind: 'support', subject: 'Owner assignment', status: 'open', created_at: stamp(10), updated_at: stamp(1) }],
      support_messages: [{ id: id(80), ticket_id: TARGET, sender: 'member', sender_id: TARGET, body: 'Synthetic member question', created_at: stamp(9) }],
      admin_users: [{ user_id: ACTOR, role: 'super_admin', active: true }, { user_id: id(400), role: 'support_agent', active: true }],
    },
    rpc: {
      admin_support_triage_read: args => args.p_ids.map(ticket_id => ({ ticket_id, assigned_to: null, assigned_name: null, priority: 'normal', queue: 'general', escalated: false, version: 1, response_due_at: null, support_commands_available: true })),
      admin_support_triage_update: args => ({ success: true, command_key: args.p_key }),
    },
  };
}
module.exports = { id, stamp, profiles, jobs, calls, stories, applications, support };
