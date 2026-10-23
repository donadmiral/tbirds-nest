import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATION_CV_BUCKET, applicationCvPath, legacyApplicationCvPath } from "../../shared/applicationCv";

/** Signing runs as the reader. Storage RLS checks the current application. */
export async function applicationCvDownload(client: SupabaseClient, reference: string, name?: string | null): Promise<string> {
  const path = applicationCvPath(reference);
  if (path) {
    const { data, error } = await client.storage.from(APPLICATION_CV_BUCKET)
      .createSignedUrl(path, 60, { download: name || "CV" });
    if (error || !data?.signedUrl) throw new Error("The CV could not be opened. Please try again.");
    return data.signedUrl;
  }
  const legacyPath = legacyApplicationCvPath(reference, process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (legacyPath) {
    const { data, error } = await client.storage.from('chat-files').createSignedUrl(legacyPath, 60, { download: name || "CV" });
    if (error || !data?.signedUrl) throw new Error("The CV could not be opened. Please try again.");
    return data.signedUrl;
  }
  throw new Error("This CV reference is not supported. Ask the applicant to attach it again.");
}
