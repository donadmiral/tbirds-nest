/** Included in the ECS task command; changing this does not change the encoder image. */
export async function finiteRendererTask(run, {
  deadline = process.env.LIVE_CLIP_TASK_DEADLINE_MS, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout,
  stop = () => process.kill(process.pid, 'SIGTERM'), kill = () => process.exit(124),
} = {}) {
  if (!/^\d{13}$/.test(String(deadline))) throw Error('renderer_task_deadline_invalid');
  const remaining = Number(deadline) - now();
  if (remaining > 600000) throw Error('renderer_task_deadline_invalid');
  // A delayed task must not claim work after its pre-reserved window has expired.
  if (remaining <= 25000) return;
  const soft = schedule(stop, remaining - 25000), hard = schedule(kill, remaining);
  try { await run(); } finally { cancel(soft); cancel(hard); }
}
export const finiteRendererCommand = [
  'node', '--input-type=module', '-e',
  `import { startPullWorker } from '/app/workers/live-clips/pull.mjs';\n${finiteRendererTask.toString()}\ntry { await finiteRendererTask(startPullWorker); } catch { process.stderr.write('{"event":"live_clip_worker","kind":"fatal","code":"renderer_finite_task_failed"}\\n'); process.exitCode=1; }`,
];
