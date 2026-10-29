export type CountdownReminderInput = { userId: string; storyId: string; stickerId: string; title: string; target: string };
type ScheduledReminder = { identifier: string };
export type CountdownReminderPorts = {
  getPermissions(): Promise<{ granted: boolean }>;
  requestPermissions(): Promise<{ granted: boolean }>;
  scheduled(): Promise<ScheduledReminder[]>;
  schedule(input: { identifier: string; title: string; date: Date; storyId: string; stickerId: string }): Promise<string>;
  cancel(identifier: string): Promise<void>;
  record(): Promise<unknown>;
};
export function countdownReminderId(userId: string, storyId: string, stickerId: string): string {
  return `story-countdown:${userId}:${storyId}:${stickerId}`;
}
/** Only report success once this device has a scheduled reminder and its
 * response is saved. Roll back a new local reminder if that write fails. */
export async function setStoryCountdownReminder(input: CountdownReminderInput, ports: CountdownReminderPorts): Promise<string> {
  const when = new Date(input.target);
  if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) throw new Error('This countdown has already ended or has no valid end time.');
  let permissions = await ports.getPermissions();
  if (!permissions.granted) permissions = await ports.requestPermissions();
  if (!permissions.granted) throw new Error('Allow notifications in Settings to receive a countdown reminder.');
  const identifier = countdownReminderId(input.userId, input.storyId, input.stickerId);
  const existing = (await ports.scheduled()).some(request => request.identifier === identifier);
  let scheduled: string | null = null;
  try {
    if (!existing) scheduled = await ports.schedule({ identifier, title: input.title, date: when, storyId: input.storyId, stickerId: input.stickerId });
    const response = await ports.record();
    if (!response) throw new Error('The reminder could not be confirmed. Please try again.');
    return scheduled || identifier;
  } catch (error) {
    if (scheduled) await ports.cancel(scheduled).catch(() => {});
    throw error;
  }
}
