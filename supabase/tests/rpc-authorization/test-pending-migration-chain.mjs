import {PGlite} from '@electric-sql/pglite';
import {extensions,loadLiveSchema} from './live-schema-fixture.mjs';
import {readFile,readdir} from 'node:fs/promises';
const db=new PGlite({extensions});
let phase='managed-schema-fixture';
const applied=[];
try{
 await loadLiveSchema(db);
 const files=(await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>/^202610(22|23|25|26|28)\d+.*\.sql$/.test(n)).sort();
 for(const file of files){phase=file;await db.exec(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));applied.push(file);}
 console.log(JSON.stringify({suite:'pending-migration-chain',passed:applied.length,applied,hostedWrites:false,limitations:['Managed auth/storage/Vault are local fixtures. This checks schema and DDL compatibility; provider integrations and hosted privileges still require deployment tests.']},null,2));
}catch(error){console.error(JSON.stringify({phase,error:error.message,detail:error.detail,where:error.where,applied}));process.exitCode=1;}
finally{await db.close();}
