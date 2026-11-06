/** Only return a video to the planner once both its real cover and source are ready. */
export async function preparePlannedMedia(
  video: boolean, uploadSource: () => Promise<string>, uploadCover: () => Promise<string>,
  isCurrent: () => boolean = () => true,
) {
  const check = () => { if (!isCurrent()) throw new Error('The media selection has changed.'); };
  check();
  if (!video) return { url: await uploadSource(), media_type: 'image' as const };
  const coverUrl = await uploadCover();
  if (!coverUrl) throw new Error('The video cover could not be saved. Please retry.');
  check();
  const url = await uploadSource();
  check();
  return { url, media_type: 'video' as const, edit: { coverUrl, coverAt: 0 } };
}
