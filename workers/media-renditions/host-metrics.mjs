import {readFile,statfs} from 'node:fs/promises';
import os from 'node:os';

const number=raw=>/^\d+$/.test(raw?.trim()||'')?Number(raw.trim()):null;
export function parseCpuStat(raw){return number(raw.match(/^usage_usec\s+(\d+)$/m)?.[1]);}
export function parseMemory(raw){const read=k=>Number(raw.match(new RegExp(`^${k}:\\s+(\\d+) kB$`,'m'))?.[1])*1024;const total=read('MemTotal'),available=read('MemAvailable');return Number.isFinite(total)&&Number.isFinite(available)?{total,used:total-available}:null;}
export async function startHostMetrics(root,{read=readFile,disk=statfs,intervalMs=250}={}){
 const began=Date.now();let stopped=false,busy=false,first,last,peakMemory=0,peakDisk=0;
 async function sample(){
  const [fs,cpu,mem]=await Promise.all([disk(root),read('/sys/fs/cgroup/cpu.stat','utf8').catch(()=>''),read('/proc/meminfo','utf8').catch(()=>'')]);
  const ram=parseMemory(mem),value={free:Number(fs.bavail)*Number(fs.bsize),diskTotal:Number(fs.blocks)*Number(fs.bsize),cpuUsec:parseCpuStat(cpu)};
  first??=value;last=value;peakDisk=Math.max(peakDisk,first.free-value.free);peakMemory=Math.max(peakMemory,ram?.used||0);return value;
 }
 await sample();
 const timer=setInterval(async()=>{if(stopped||busy)return;busy=true;try{await sample();}catch{}finally{busy=false;}},intervalMs);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);try{await sample();}catch{}
  return{wall_ms:Date.now()-began,host_vcpus:os.cpus().length,host_memory_bytes:os.totalmem(),scratch_total_bytes:first.diskTotal,scratch_start_free_bytes:first.free,scratch_peak_increment_bytes:peakDisk,
   sampled_host_memory_peak_bytes:peakMemory,node_peak_rss_bytes:process.resourceUsage().maxRSS*1024,
   active_cpu_ms:first.cpuUsec!==null&&last.cpuUsec!==null?Math.max(0,(last.cpuUsec-first.cpuUsec)/1000):null};
 };
}
