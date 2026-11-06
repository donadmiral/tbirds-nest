import {readFile,mkdtemp,rm,stat} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareAudio,runTool} from './audio.mjs';import {digest} from './protocol.mjs';import {inspectEncoder} from './encoder-policy.mjs';
const SOURCE=new URL('./test/assets/synthetic-h264-aac.mp4',import.meta.url);
export async function verifyBundledAudio(directory=process.env.TMPDIR||'/scratch'){
 const source=await readFile(SOURCE),sha=digest(source);if(sha!=='6921fe4c44361a62d42049b8d4eafdfedf9836a24db1dbb5c2921f9ef73bd293')throw Error('caption_fixture_invalid');
 const folder=await mkdtemp(path.join(directory,'caption-acceptance-'));try{
  const audio=await prepareAudio(fileURLToPath(SOURCE),path.join(folder,'source.flac'),2000,AbortSignal.timeout(20000));
  await runTool('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-i',audio.path,'-map','0:a:0','-f','null','-'],{signal:AbortSignal.timeout(10000)});
  return{ok:true,synthetic:true,source_sha256:sha,source_bytes:source.length,flac_bytes:audio.bytes,flac_sha256:audio.sha256,duration_ms:audio.duration_ms,audio_only:true,sample_rate:16000,channels:1};
 }finally{await rm(folder,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.getuid?.()!==1000)throw Error('caption_acceptance_nonroot_required');
  const metadata=await stat('/usr/local/share/pc-live-transcription/base-image.json');
  if(!metadata.isFile()||metadata.uid!==0||(metadata.mode&0o777)!==0o444)throw Error('caption_acceptance_metadata_permissions');
  const encoder=inspectEncoder(),audio=await verifyBundledAudio();
  process.stdout.write(JSON.stringify({schema_version:1,encoder,audio,runtime_uid:1000,base_metadata_owner_uid:metadata.uid,base_metadata_mode:'0444',hosted_transcription_accepted:false})+'\n');
 }
 catch{process.stderr.write('{"ok":false,"error":"caption_image_acceptance_failed"}\n');process.exitCode=1;}
}
