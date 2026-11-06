import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
/** Parses owner-obtained ECR metadata only. Makes no AWS request or activation decision. */
export function reviewScan(input, imageDigest, repository) {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest || '') || !/^[a-z0-9][a-z0-9._/-]{1,255}$/.test(repository || '')
    || input?.imageId?.imageDigest !== imageDigest || input.repositoryName !== repository) throw Error('scan_identity_invalid');
  const status = input.imageScanStatus?.status;
  if (!['COMPLETE', 'IN_PROGRESS', 'PENDING', 'FAILED', 'UNSUPPORTED_IMAGE', 'FINDINGS_UNAVAILABLE', 'LIMIT_EXCEEDED', 'SCAN_ELIGIBILITY_EXPIRED'].includes(status)) throw Error('scan_status_invalid');
  const counts = {};
  for (const level of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL', 'UNDEFINED']) {
    const count = input.imageScanFindings?.findingSeverityCounts?.[level] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) throw Error('scan_counts_invalid');
    counts[level] = count;
  }
  if (status === 'COMPLETE' && (!input.imageScanFindings || !input.imageScanFindings.findingSeverityCounts)) throw Error('scan_findings_missing');
  return { schema_version: 1, service: 'live-social', image_digest: imageDigest, repository,
    source: 'owner_supplied_ecr_describe_image_scan_findings', scan_status: status, severity_counts: counts,
    passes_high_critical_gate: status === 'COMPLETE' && counts.HIGH === 0 && counts.CRITICAL === 0,
    vulnerability_free_claim: false, deployed: false, runtime_admission_changed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bytes = readFileSync(process.argv[2]);
    if (bytes.length > 5242880) throw Error('scan_input_too_large');
    process.stdout.write(JSON.stringify(reviewScan(JSON.parse(bytes), process.argv[3], process.argv[4])) + '\n');
  } catch { process.stderr.write('{"ok":false,"error":"social_scan_review_failed"}\n'); process.exitCode = 1; }
}
