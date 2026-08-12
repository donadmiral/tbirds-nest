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