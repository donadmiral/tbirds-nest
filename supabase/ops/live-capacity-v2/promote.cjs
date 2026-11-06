'use strict';
// Creates a reviewable SQL transaction locally. Does not contact a database.
// Operators must independently inspect/provider-verify the linked evidence.
const fs=require('node:fs'),crypto=require('node:crypto');
const {planFor,verify}=require('../../../tools/performance/live-standard.cjs');
const tiers=require('../../../tools/performance/live-capacity-stages.json');
async function main(){
const [file,source,url,requestedTier,snapshots]=process.argv.slice(2);
if(!file||!source||!url||!requestedTier||!snapshots||process.argv.length!==7)throw Error('Usage: node promote.cjs report.json expected-source-sha https://retained/report expected-tier audience.ndjson');
const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||url.length>1000||!/^[\x21-\x7e]+$/.test(url))throw Error('Expected a permanent HTTPS receipt without credentials or a query');
const bytes=fs.readFileSync(file);const evidence=JSON.parse(bytes);const plan=planFor(Number(requestedTier));const check=verify(plan,evidence,source);
if(!check.accepted)throw Error('Refusing promotion: '+check.missing.join(', '));
const observed=await require('../../../tools/performance/live-audience-window.cjs').measureFile(snapshots,plan,source);
if(evidence.artifacts.simultaneousAudience.sha256!==observed.sha256 || Date.parse(evidence.observedFrom)!==Date.parse(observed.observedFrom)||Date.parse(evidence.observedTo)!==Date.parse(observed.observedTo)||Object.entries(observed.simultaneous).some(([k,v])=>evidence.simultaneous[k]!==v))throw Error('Signed report disagrees with retained simultaneous snapshots');
const hash=crypto.createHash('sha256').update(bytes).digest('hex'),stage=tiers.stages.findIndex(s=>s.broadcasts===plan.broadcasts);
const before=stage===0?10:tiers.stages[stage-1].broadcasts;
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
console.log(`begin;
set local lock_timeout='3s';
set local standard_conforming_strings=on;
do $capacity$
begin
 if (select max_active_broadcasts from live_streams.settings where singleton for update) is distinct from ${before} then raise exception 'LIVE_CAPACITY_TIER_ORDER';end if;
end $capacity$;
insert into live_streams.capacity_qualifications(evidence_sha256,source_revision,tier,report_url,observed_until)
 values (${quote(hash)},${quote(source)},${plan.broadcasts},${quote(url)},${quote(new Date(evidence.observedTo).toISOString())});
 update live_streams.settings set max_active_broadcasts=${plan.broadcasts},capacity_evidence_ref=${quote(hash)},updated_at=now() where singleton;
commit;`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
