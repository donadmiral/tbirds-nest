/** Durable CV references never contain a public or expiring download URL. */
export const APPLICATION_CV_BUCKET = "application-cvs";
export const APPLICATION_CV_MAX_BYTES = 8 * 1024 * 1024;
export const APPLICATION_CV_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const pathPattern = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(pdf|doc|docx|txt)$`, "i");

export function applicationCvPath(reference: string | null | undefined): string | null {
  const prefix = APPLICATION_CV_BUCKET + "/";
  if (!reference?.startsWith(prefix)) return null;
  const path = reference.slice(prefix.length);
  return pathPattern.test(path) ? path : null;
}

export function applicationCvFile(name: string, size: number): { extension: string; contentType: string } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = Object.prototype.hasOwnProperty.call(APPLICATION_CV_MIME, extension) ? APPLICATION_CV_MIME[extension] : undefined;
  if (!contentType) throw new Error("Choose a PDF, Word document or text file.");
  if (!Number.isFinite(size) || size <= 0 || size > APPLICATION_CV_MAX_BYTES) {
    throw new Error("Choose a non-empty CV up to 8 MB.");
  }
  return { extension, contentType };
}
