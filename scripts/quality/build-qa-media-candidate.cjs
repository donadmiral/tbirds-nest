const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/quality/QA_MEDIA_BASELINE_20261029.json'),'utf8')).catalog;
const query=fs.readFileSync(path.join(root,'supabase/ops/check-qa-media-completion-preflight.sql'),'utf8').replace(') as preflight;',') into actual;');
if(!query.includes('into actual;'))throw new Error('Preflight query result anchor changed');
let sql="-- QA-ONLY forward adapter for uaulhuelcfkjwojtymmw.\n-- Exact inspected catalog, preserving every existing account and Storage object.\n-- Production candidates are unchanged. No bucket visibility change or data reset.\nbegin;\nset local lock_timeout='3s';\ndo $qa_preflight$\ndeclare actual jsonb;\nbegin\n"+query+"\n if actual is distinct from $qa_catalog$"+JSON.stringify(baseline)+"$qa_catalog$::jsonb then raise exception 'QA_MEDIA_BASELINE_CHANGED';end if;\nend $qa_preflight$;\n";
for(const t of baseline.triggers){if(!/^[a-z_]+$/.test(t.name)||!/^[a-z_]+$/.test(t.table))throw new Error('Unexpected catalog identifier');sql+=`drop trigger ${t.name} on public.${t.table};\n`;}
for(const p of baseline.policies)if(p.name.startsWith('chat_private_')){if(!/^[a-z_]+$/.test(p.name))throw new Error('Unexpected catalog identifier');sql+=`drop policy ${p.name} on storage.objects;\n`;}
for(const stem of ['20261029224813_private_media_cutover_compatibility','20261029231440_bounded_media_delivery']) {
 const source=fs.readFileSync(path.join(root,'supabase/migrations',stem+'.sql'),'utf8');
 sql+=`\n-- Reviewed candidate ${stem}; SHA-256 ${crypto.createHash('sha256').update(source).digest('hex')}\n`+source.replace(/^\s*(?:begin|commit);\s*$/gim,'')+'\n';
}
sql+='commit;\n';
const target='supabase/ops/qa/20261029233915_qa_media_completion_forward.sql';
fs.writeFileSync(path.join(root,target),sql);console.log(JSON.stringify({target,sha256:crypto.createHash('sha256').update(sql).digest('hex')}));
