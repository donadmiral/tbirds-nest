import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATION_CV_BUCKET, applicationCvPath } from "../../shared/applicationCv";

/** Signing runs as the reader. Storage RLS checks the current application. */
export async function applicationCvDownload(client: SupabaseClient, reference: string, name?: string | null): Promise<string> {
  const path = applicationCvPath(reference);
  if (path) {
    const { data, error } = await client.storage.from(APPLICATION_CV_BUCKET)
      .createSignedUrl(path, 60, { download: name || "CV" });
    if (error || !data?.signedUrl) throw new Error("The CV could not be opened. Please try again.");
    return data.signedUrl;
  }
  // Existing native applications may still contain old chat-files links.
  // Retain access without treating arbitrary schemes/hosts as trusted files.
  let url: URL;
  let storageOrigin: string;
  try {
    url = new URL(reference);
    storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  } catch {
    throw new Error("This CV reference is not supported. Ask the applicant to attach it again.");
  }
  if (url.protocol !== "https:" || url.origin !== storageOrigin ||
      !/^\/storage\/v1\/object\/(?:public|sign)\/chat-files\//.test(url.pathname)) {
    throw new Error("This CV reference is not supported. Ask the applicant to attach it again.");
  }
  return url.toString();
}
