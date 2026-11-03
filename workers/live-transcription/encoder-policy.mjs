import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ROOT='/usr/local/share/pc-live-transcription';
export const COMPONENTS=Object.freeze({
 PROTOCOL:['FILE','PIPE'],DEMUXER:['MOV','FLAC'],MUXER:['FLAC','NULL'],DECODER:['AAC','FLAC'],ENCODER:['FLAC','PCM_S16LE'],
 PARSER:['AAC','FLAC'],BSF:[],INDEV:[],OUTDEV:[],HWACCEL:[],FILTER:['ARESAMPLE','AFORMAT','ANULL','ATRIM','ASETPTS','ABUFFER','ABUFFERSINK','CROP','FORMAT','HFLIP','NULL','ROTATE','TRANSPOSE','TRIM','VFLIP'],
});
const REQUIRED={...COMPONENTS,FILTER:COMPONENTS.FILTER.filter(name=>!['ABUFFER','ABUFFERSINK'].includes(name))};
export function validateComponents(config,componentConfig,configuration,packages){
 if(!/#define CONFIG_NETWORK 0(?:\n|$)/.test(config))throw Error('caption_encoder_network_enabled');
 const counts={};
 for(const[kind,allowed]of Object.entries(COMPONENTS)){
  // FFmpeg writes ALL_COMPONENTS to config_components.h. config.h also has
  // internal support names such as FRAME_THREAD_ENCODER, which are not codecs.
  const enabled=[...componentConfig.matchAll(new RegExp('^#define CONFIG_([A-Z0-9_]+)_'+kind+' 1$','gm'))].map(row=>row[1]);
  if(enabled.some(value=>!allowed.includes(value)))throw Error('caption_encoder_unapproved_'+kind.toLowerCase());
  if(REQUIRED[kind].some(value=>!enabled.includes(value)))throw Error('caption_encoder_missing_'+kind.toLowerCase());
  counts[kind.toLowerCase()]=enabled.length;
 }
 for(const flag of ['--disable-everything','--disable-autodetect','--disable-network','--enable-static','--disable-avdevice','--disable-swscale','--disable-gpl'])if(!configuration.split(/\s+/).includes(flag))throw Error('caption_encoder_build_policy_invalid');
 if(!Array.isArray(packages)||!packages.length||packages.some(value=>/^(?:ffmpeg|libavcodec|libavformat|tiff|libtiff|librist|librsvg|libjxl|cjson|speex|libxi|libx11|glibc|util-linux|x264|libass)(?:-[0-9]|-)/.test(value)))throw Error('caption_encoder_unapproved_package');
 return counts;
}
export function inspectEncoder(){
 if(process.versions.node!=='24.22.2')throw Error('caption_encoder_node_version_invalid');
 const run=args=>execFileSync('ffmpeg',['-hide_banner',...args],{encoding:'utf8',timeout:10000,maxBuffer:1048576});
 if(!/^ffmpeg version 9\.0\.2(?:\s|$)/.test(run(['-version']).split('\n')[0]))throw Error('caption_encoder_version_invalid');
 const configuration=readFileSync(ROOT+'/ffmpeg-buildconf.txt','utf8');
 const config=readFileSync(ROOT+'/config.h','utf8');
 const componentConfig=readFileSync(ROOT+'/config_components.h','utf8');
 const packages=execFileSync('apk',['info','-v'],{encoding:'utf8',timeout:10000,maxBuffer:1048576}).trim().split('\n').sort();
 const counts=validateComponents(config,componentConfig,configuration,packages);
 const protocols=[...new Set(run(['-protocols']).split('\n').map(value=>value.trim()).filter(value=>/^[a-z][a-z0-9_]*$/.test(value)))].sort();
 if(protocols.join(',')!=='file,pipe')throw Error('caption_encoder_protocol_binary_mismatch');
 const source=readFileSync(ROOT+'/ffmpeg-source.sha256','utf8').split(/\s+/)[0];
 if(source!=='8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e')throw Error('caption_encoder_source_digest_invalid');
 const base=JSON.parse(readFileSync(ROOT+'/base-image.json','utf8'));
 if(!/^node@sha256:[a-f0-9]{64}$/.test(base.image)||base.node_version!=='24.22.2'||base.architecture!=='amd64')throw Error('caption_encoder_base_invalid');
 const binaries=Object.fromEntries(['ffmpeg','ffprobe'].map(name=>[name,createHash('sha256').update(readFileSync('/usr/local/bin/'+name)).digest('hex')]));
 return{schema_version:1,ok:true,ffmpeg_version:'9.0.2',ffmpeg_source:'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',ffmpeg_source_sha256:source,
 source_signature_verified_at_build:true,release_signing_key:'FCF986EA15E6E293A5644F10B4322F04D67658D8',
 source_component:{type:'application',name:'ffmpeg',version:'9.0.2',purl:'pkg:generic/ffmpeg@9.0.2',cpe:'cpe:2.3:a:ffmpeg:ffmpeg:9.0.2:*:*:*:*:*:*:*'},
 base,node_version:process.versions.node,alpine_version:readFileSync('/etc/alpine-release','utf8').trim(),component_counts:counts,protocols,binaries,packages,
 remaining_review:['Actual immutable image scan and source-component vulnerability review required.','AAC and MOV parsing remain reachable; network and video codecs are excluded.'],vulnerability_free_claim:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const receipt=inspectEncoder();if(process.argv.includes('--write-inventory'))writeFileSync(ROOT+'/inventory.json',JSON.stringify(receipt,null,2)+'\n');process.stdout.write(JSON.stringify(receipt)+'\n');}
 catch(error){const code=/^caption_encoder_[a-z_]+$/.test(error?.message||'')?error.message:'caption_encoder_policy_failed';process.stderr.write(JSON.stringify({ok:false,error:code})+'\n');process.exitCode=1;}
}
