"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES = [
  ["full_time", "Full Time"], ["part_time", "Part Time"], ["internship", "Internship"],
  ["volunteering", "Volunteering"], ["startup", "Startup"], ["freelance", "Freelance"],
  ["contract", "Contract"], ["temporary", "Temporary"],
] as const;

const inputCls = "rounded-md bg-surface px-4 py-3 text-[14px] text-ink placeholder:text-ink/30 outline-none focus:bg-surface-elevated";

export default function PostJobPage() {
  const supabase = createClient();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("full_time");
  const [remoteType, setRemoteType] = useState("on_site");
  const [experience, setExperience] = useState("mid");
  const [salary, setSalary] = useState("");
  const [industry, setIndustry] = useState("");
  const [benefits, setBenefits] = useState("");
  const [applyUrl, setApplyUrl] = useState("");
  const [deadline, setDeadline] = useState("");
  const [visa, setVisa] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    if (!title.trim() || !company.trim() || !description.trim()) { setError("Title, company and description are required."); return; }
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setError("Sign in to post a job."); setPending(false); return; }
    const { data, error: insErr } = await supabase
      .from("jobs")
      .insert({
        posted_by: uid,
        title: title.trim(),
        company: company.trim(),
        location: location.trim() || null,
        description: description.trim(),
        category,
        benefits: benefits.trim() || null,
        remote_type: remoteType,
        experience_level: experience,
        industry: industry.trim() || null,
        salary_range: salary.trim() || null,
        visa_sponsorship: visa,
        urgent,
        verified: false,
        applications_count: 0,
        apply_url: applyUrl.trim() || null,
        deadline: deadline || null,
        scope: "global",
      })
      .select()
      .single();
    if (insErr || !data) {
      setError(insErr?.message || "Could not post the job.");
      setPending(false);
      return;
    }
    router.push("/jobs/" + data.id);
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-1 pb-4">
        <Link href="/jobs" className="text-sm text-ink/50 hover:text-ink">← Jobs</Link>
        <h1 className="font-display text-xl text-porcelain">Post a job</h1>
      </div>
      <div className="flex flex-col gap-3 px-1">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" />
        <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
        <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (city)" />
        <textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the role, requirements and how to stand out" rows={7} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v} className="bg-navy">{l}</option>)}
          </select>
          <select className={inputCls} value={remoteType} onChange={(e) => setRemoteType(e.target.value)}>
            <option value="on_site" className="bg-navy">On site</option>
            <option value="hybrid" className="bg-navy">Hybrid</option>
            <option value="remote" className="bg-navy">Remote</option>
          </select>
          <select className={inputCls} value={experience} onChange={(e) => setExperience(e.target.value)}>
            <option value="entry" className="bg-navy">Entry</option>
            <option value="mid" className="bg-navy">Mid</option>
            <option value="senior" className="bg-navy">Senior</option>
            <option value="executive" className="bg-navy">Executive</option>
          </select>
        </div>
        <input className={inputCls} value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="Salary range, e.g. $800 - $1,200 per month" />
        <input className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (optional)" />
        <input className={inputCls} value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder="Benefits (optional)" />
        <input className={inputCls} value={applyUrl} onChange={(e) => setApplyUrl(e.target.value)} placeholder="External apply URL (optional)" />
        <label className="flex items-center gap-2 text-[14px] text-ink/70">
          Deadline
          <input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <div className="flex gap-5">
          <label className="flex items-center gap-2 text-[14px] text-ink/70">
            <input type="checkbox" checked={visa} onChange={(e) => setVisa(e.target.checked)} className="accent-[#C9BFB0]" /> Visa sponsorship
          </label>
          <label className="flex items-center gap-2 text-[14px] text-ink/70">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="accent-[#C9BFB0]" /> Urgent hiring
          </label>
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <button onClick={submit} disabled={pending} className="mt-2 self-start rounded-md bg-pearl px-6 py-3 text-[15px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
          {pending ? "Publishing" : "Publish job"}
        </button>
      </div>
    </div>
  );
}