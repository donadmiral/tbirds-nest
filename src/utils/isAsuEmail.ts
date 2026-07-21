/**
 * isAsuEmail.ts
 * Shared helper for ASU email detection.
 * Catches @asu.edu and all subdomains like @thunderbird.asu.edu, @students.asu.edu
 * Does NOT catch fake domains like @fakeasu.edu or @asu.edu.fake.com
 */
export function isAsuEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  return lower.endsWith('@asu.edu') || lower.endsWith('.asu.edu');
}