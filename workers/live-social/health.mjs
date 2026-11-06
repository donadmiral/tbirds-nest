import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
try{const value=JSON.parse(await readFile(join(tmpdir(),'pc-social-health.json'),'utf8'));if(!Number.isFinite(value.at)||Date.now()-value.at>430000||value.at>Date.now()+5000)process.exitCode=1;}catch{process.exitCode=1;}
