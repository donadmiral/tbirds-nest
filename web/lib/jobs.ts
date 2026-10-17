// Mirrors src/services/jobsService.ts Job shape (columns used on web).
export type JobRow = {
  id: string;
  posted_by: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  job_type: string | null;
  salary_range: string | null;
  created_at: string;
  category: string | null;
  remote_type: string | null;
  experience_level: string | null;
  industry: string | null;
  visa_sponsorship: boolean;
  urgent: boolean;
  verified: boolean;
  applications_count: number;
  apply_url: string | null;
  deadline: string | null;
};

export type PosterLite = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export function jobMeta(j: JobRow): string {
  const bits = [j.location, j.remote_type, j.job_type, j.salary_range].filter(Boolean);
  return bits.join(" · ");
}

export type ApplicationStatus =
  | 'applied'
  | 'viewed'
  | 'shortlisted'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'withdrawn'
  | 'rejected'
  | 'accepted';

export const STATUS_META: Record<ApplicationStatus, { label: string; color: string; bg: string }> = {
  applied:     { label: 'Applied',     color: '#2563EB', bg: '#EFF6FF' },
  viewed:      { label: 'Viewed',      color: '#7C3AED', bg: '#F5F3FF' },
  shortlisted: { label: 'Shortlisted', color: '#059669', bg: '#ECFDF5' },
  screening:   { label: 'Screening',   color: '#7C3AED', bg: '#F5F3FF' },
  offer:       { label: 'Offer',       color: '#059669', bg: '#ECFDF5' },
  hired:       { label: 'Hired',       color: '#059669', bg: '#ECFDF5' },
  withdrawn:   { label: 'Withdrawn',   color: '#6B7280', bg: '#F3F4F6' },
  interview:   { label: 'Interview',   color: '#D97706', bg: '#FFFBEB' },
  rejected:    { label: 'Rejected',    color: '#DC2626', bg: '#FEF2F2' },
  accepted:    { label: 'Accepted',    color: '#059669', bg: '#ECFDF5' },
};

export const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  'applied', 'viewed', 'shortlisted', 'screening', 'interview', 'offer', 'hired', 'accepted', 'rejected', 'withdrawn',
];

export function isJobDeadlinePassed(deadline?: string | null, now = Date.now()): boolean {
  if (!deadline) return false;
  const expiresAt = Date.parse(deadline);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
