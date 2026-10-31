// Test-only bridge: actual server action runs in the loopback Node fixture.
type Field = [string, string | { name: string; type: string; content: string }];
declare global {
  interface Window {
    __CUSTOM_STATE__: { scenario: string; events: { name: string; result: unknown }[]; refreshes: number };
  }
}
async function invoke(name: string, form: FormData) {
  const fields: Field[] = [];
  for (const [key, value] of form.entries()) fields.push([key, typeof value === 'string' ? value : { name: value.name, type: value.type, content: await value.text() }]);
  const response = await fetch('/__custom_action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, fields, scenario: window.__CUSTOM_STATE__.scenario }) });
  if (!response.ok) throw new Error('Synthetic action transport unavailable');
  const record = await response.json();
  window.__CUSTOM_STATE__.events.push({ name, result: record });
  if (record.thrown) throw new Error(record.thrown);
  // Redirects are observed, not reimplemented as Next navigation in this fixture.
  return record.value;
}
export const stageMusicCatalogue = (form: FormData) => invoke('stageMusicCatalogue', form);
export const requestPasswordReset = (form: FormData) => invoke('requestPasswordReset', form);
export const verifyRecoveryAuthenticator = (form: FormData) => invoke('verifyRecoveryAuthenticator', form);
export const updateRecoveryPassword = (form: FormData) => invoke('updateRecoveryPassword', form);
export const reviewCreator = (_state: { error: string } | null, form: FormData) => invoke('reviewCreator', form);
