let releaseStage:(()=>Promise<void>)|null=null;

/** Daily is a single native media session. Calls await backstage teardown. */
export function registerLiveStageRelease(release:()=>Promise<void>):()=>void {
  releaseStage=release;
  return()=>{if(releaseStage===release)releaseStage=null;};
}
export async function releaseLiveStageMedia():Promise<void> {
  const release=releaseStage;
  if(release)await release();
}
