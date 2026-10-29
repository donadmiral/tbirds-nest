/** Parse the user's local date without silently normalizing Feb 31 or 25:90. */
export function parseStudioLocalDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute ? date : null;
}

export function validateCampaignInput(input: { name: string; budget: string; currency: string; starts_at: string; ends_at: string }) {
  if (!input.name.trim() || input.name.trim().length > 80) throw new Error('Enter a campaign name of up to 80 characters.');
  const rawBudget = input.budget.trim() || '0';
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawBudget) || !Number.isSafeInteger(Math.round(Number(rawBudget) * 100))) throw new Error('Enter a valid budget with up to two decimal places.');
  if (!['USD', 'ZWG'].includes(input.currency)) throw new Error('Choose a supported currency.');
  const startsAt = input.starts_at.trim() ? parseStudioLocalDate(input.starts_at) : null;
  const endsAt = input.ends_at.trim() ? parseStudioLocalDate(input.ends_at) : null;
  if ((input.starts_at.trim() && !startsAt) || (input.ends_at.trim() && !endsAt)) throw new Error('Enter valid dates using YYYY-MM-DD HH:mm.');
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('The campaign end must be after its start.');
  return { name: input.name.trim(), budget: Number(rawBudget), startsAt: startsAt?.toISOString() || null, endsAt: endsAt?.toISOString() || null };
}

export function parseImpressionCap(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw new Error('Enter a whole impression limit greater than zero.');
  return Number(value);
}
