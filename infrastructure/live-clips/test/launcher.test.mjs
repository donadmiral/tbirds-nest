import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendererLauncherTemplate } from '../launcher-template.mjs';
import { rendererServiceTemplate } from '../service-template.mjs';
import { finiteRendererTask, finiteRendererCommand } from '../finite-task.mjs';

test('finite renderer cannot start with missing, future, or already expired deadline', async () => {
  let starts = 0; const now = () => 1793707200000, run = async () => { starts++; };
  await assert.rejects(finiteRendererTask(run, { deadline: undefined, now }), /deadline_invalid/);
  await assert.rejects(finiteRendererTask(run, { deadline: String(now() + 600001), now }), /deadline_invalid/);
  await finiteRendererTask(run, { deadline: String(now() - 1), now });
  await finiteRendererTask(run, { deadline: String(now() + 1000), now });
  assert.equal(starts, 0);
});
test('finite renderer schedules graceful then hard termination and clears both after completion', async () => {
  const calls = [], cancelled = []; let stops = 0, kills = 0;
  await finiteRendererTask(async () => { assert.equal(calls.length, 2); calls[0].fn(); calls[1].fn(); }, {
    deadline: '1793707800000', now: () => 1793707200000,
    schedule: (fn, delay) => { calls.push({ fn, delay }); return calls.length; }, cancel: id => cancelled.push(id),
    stop: () => { stops++; }, kill: () => { kills++; },
  });
  assert.deepEqual(calls.map(c => c.delay), [575000, 600000]);
  assert.deepEqual(cancelled, [1, 2]); assert.equal(stops, 1); assert.equal(kills, 1);
});
test('service cannot accidentally leave always-on workers and its finite command fits ECS bounds', () => {
  const service = rendererServiceTemplate();
  assert.deepEqual(service.Parameters.DesiredCount.AllowedValues, [0]);
  const container = service.Resources.Task.Properties.ContainerDefinitions[0];
  assert.deepEqual(container.Command, finiteRendererCommand);
  assert.ok(JSON.stringify(finiteRendererCommand).length < 6000);
  assert.equal(service.Resources.Task.Properties.TaskRoleArn, undefined);
  assert.equal(container.Command.join(' ').includes('LIVE_CLIP_TASK_DEADLINE_MS'), true);
});
test('launcher is disabled by default and has one slot, no broker secret, fixed budget and strict roles', () => {
  const template = rendererLauncherTemplate(), resources = template.Resources;
  assert.equal(template.Parameters.ScheduleEnabled.Default, 'false');
  assert.equal(template.Parameters.AsrEnabled.Default, 'false');
  assert.equal(resources.Launcher.Properties.ReservedConcurrentExecutions, 1);
  assert.equal(resources.Tick.Properties.ScheduleExpression, 'rate(1 minute)');
  assert.equal(resources.Launcher.Properties.Environment.Variables.LIVE_CLIP_WORKER_SECRET, undefined);
  const policies = JSON.stringify(resources.LauncherRole.Properties.Policies);
  assert.ok(!policies.includes('BrokerSecretArn'));
  assert.ok(!policies.includes('ecs:UpdateService'));
  assert.ok(!policies.includes('s3:'));
  assert.ok(policies.includes('iam:PassedToService'));
  assert.ok(policies.includes('ecs:cluster'));
  assert.ok(resources.Launcher.Properties.Code.ZipFile.includes('DAY_BUDGET = 7200'));
  assert.equal(resources.Ledger.Properties.TimeToLiveSpecification.AttributeName, 'expires_at');
  assert.equal(resources.AllowTick.Properties.SourceAccount.Ref, 'AWS::AccountId');
});
