import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import {workerConfig} from './config.mjs';
import {backend} from './backend.mjs';
import {createWorker} from './worker.mjs';
import {runJob} from './run-job.mjs';
import {startHostMetrics} from './host-metrics.mjs';

export async function runSandboxJob({env=process.env,report=value=>console.log(JSON.stringify(value))}={}){
 const config=workerConfig(env),root=env.TMPDIR||os.tmpdir();await mkdir(root,{recursive:true});
 const finishMetrics=await startHostMetrics(root),controller=new AbortController(),stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);let event={state:'unavailable'},exitCode=1;
 try{exitCode=await runJob(createWorker(backend(config),{...config,tempRoot:root}),{signal:controller.signal,deadlineMs:config.deadlineMs,report:value=>{event=value;}});return exitCode;}
 finally{
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  const result={...event,event:'media_sandbox_job',metrics:await finishMetrics()};
  // Only counts and resource measurements are stored, never capability URLs,
  // object paths, identity, credentials, or raw subprocess diagnostics.
  await writeFile('/vercel/sandbox/media-result.json',JSON.stringify(result)+'\n',{mode:0o600});report(result);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await runSandboxJob();}catch{console.error(JSON.stringify({event:'media_sandbox_job',state:'unavailable'}));process.exitCode=1;}
}
