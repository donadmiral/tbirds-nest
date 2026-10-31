/* Actual server pages/helpers and installed Supabase SDK. Auth and PostgREST
 * responses are controlled; every request is trapped at a synthetic origin.
 * Client components remain named leaves for the server contract tests. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../..');
const ADMIN = path.join(ROOT, 'admin-web');
const req = createRequire(path.join(ADMIN,'package.json'));
const ts = req('typescript');
const SDK = req('@supabase/supabase-js');
const NOW = Date.parse('2026-10-31T17:50:00Z');
const ACTOR = '10000000-0000-4000-8000-000000000001';
const TARGET = '20000000-0000-4000-8000-000000000002';
const SESSION = '30000000-0000-4000-8000-000000000003';
const KEY = '40000000-0000-4000-8000-000000000004';
const token = 'audit.'+Buffer.from(JSON.stringify({sub:ACTOR,exp:4102444800,session_id:SESSION,aal:'aal1'})).toString('base64url')+'.synthetic';
const compiled = new Map();
function source(file) {
  if (!compiled.has(file)) compiled.set(file,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText);
  return compiled.get(file);
}
const jsx = {Fragment:'fragment',jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
function ui(name) {return new Proxy({__esModule:true,default:'component:'+name},{get:(obj,key)=>Object.hasOwn(obj,key)?obj[key]:'component:'+String(key)});}
function resolveFile(name,from) {
  let full = name.startsWith('@/') ? path.join(ADMIN,name.slice(2)) : path.resolve(path.dirname(from),name);
  for (const suffix of ['', '.ts','.tsx','.js','.cjs','/index.ts','/index.tsx']) if(fs.existsSync(full+suffix)&&fs.statSync(full+suffix).isFile())return full+suffix;
  throw new Error('Unresolved local import '+name+' from '+from);
}
function copy(value) {return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function makeHarness(options={}) {
  const calls=[], cookiesChanged=[], revalidated=[], loaded=[];
  const role=options.role===undefined?'super_admin':options.role;
  const environment={NEXT_PUBLIC_SUPABASE_URL:'https://platinum-admin-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-audit-key',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-audit-key',NODE_ENV:'test',VERCEL_ENV:'preview'};
  function response(body,status=200,headers={}) {return new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});}
  const baseRows = options.tables||{};
  async function fetchFixture(input,init={}) {
    const url=new URL(typeof input==='string'?input:input.url||String(input));
    if(url.origin!==environment.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Unexpected network origin '+url.origin);
    const method=init.method||'GET';
    const body=init.body?JSON.parse(init.body):null;
    const call={method,path:url.pathname,query:Object.fromEntries(url.searchParams),entries:[...url.searchParams],headers:Object.fromEntries(new Headers(init.headers)),body}; calls.push(call);
    if(url.pathname==='/auth/v1/user') return role===null?response({message:'synthetic unauthenticated'},401):response({id:ACTOR,email:'audit@example.invalid'});
    if(url.pathname.startsWith('/auth/v1/admin/users/')&&method==='GET')return response({id:url.pathname.split('/').pop(),email:'staff-'+url.pathname.split('/').pop().slice(-4)+'@example.invalid',last_sign_in_at:new Date(NOW-60000).toISOString()});
    if(url.pathname==='/rest/v1/rpc/triniti_admin_session_check') return response(options.sessionActive===false?false:true);
    if(url.pathname==='/rest/v1/admin_users' && (url.searchParams.get('select')||'')==='role,active') return response(role===null?[]:[{role,active:true}]);
    if(options.beforeRead) await options.beforeRead(call);
    const override = options.respond ? await options.respond(call) : undefined;
    if (override !== undefined) return override;
    if(options.rejectReads) throw new TypeError('Synthetic transport offline');
    if(options.failReads) return response({code:'XXAUD',message:'Synthetic provider read failure',details:null,hint:null},400);
    if(url.pathname.startsWith('/rest/v1/rpc/')) {
      const name=url.pathname.split('/').pop();
      let value=options.rpc?.[name];
      if(typeof value==='function') value=value(body,call);
      if(value?.__status) return response(value.body,value.__status);
      if(value!==undefined) return response(value);
      const defaults={
        admin_market_orders:{rows:[],has_more:false,next_cursor:null},
        admin_market_order_detail:null,
        admin_payment_report:{rows:[],has_more:false,next_cursor:null},
        admin_payment_summary:{status_counts:{},completed_week:0,failed_week:0,failed_previous_week:0,volume_week:[],volume_all:[],days:[],top_recipients:[]},
        admin_support_triage_read:[],
        admin_review_reports:[],
        admin_account_erasure_queue:[],
      };
      return response(Object.hasOwn(defaults,name)?defaults[name]:null);
    }
    if(url.pathname.startsWith('/rest/v1/')) {
      const table=url.pathname.split('/').pop();
      let rows=copy(baseRows[table]||[]);
      for(const [column,value]of url.searchParams) {
        if(['select','order','limit','offset','or','and'].includes(column))continue;
        const dot=value.indexOf('.'), op=value.slice(0,dot), operand=value.slice(dot+1);
        if(op==='eq')rows=rows.filter(r=>String(r[column])===operand);
        else if(op==='imatch')rows=rows.filter(r=>r[column]!=null && new RegExp(operand,'i').test(String(r[column])));
        else if(op==='gte')rows=rows.filter(r=>String(r[column])>=operand);
        else if(op==='gt')rows=rows.filter(r=>String(r[column])>operand);
        else if(op==='lt')rows=rows.filter(r=>String(r[column])<operand);
        else if(op==='lte')rows=rows.filter(r=>String(r[column])<=operand);
        else if(op==='is')rows=rows.filter(r=>operand==='null'?r[column]==null:String(r[column])===operand);
        else if(op==='not'&&operand==='is.null')rows=rows.filter(r=>r[column]!=null);
        else if(op==='in') {const members=operand.slice(1,-1).split(',').map(s=>s.replace(/^"|"$/g,''));rows=rows.filter(r=>members.includes(String(r[column])));}
      }
      const count=rows.length;
      const order=(url.searchParams.get('order')||'').split(',').filter(Boolean);
      rows.sort((a,b)=>{for(const spec of order){const [k,dir]=spec.split('.');if(a[k]===b[k])continue;return (a[k]>b[k]?1:-1)*(dir==='desc'?-1:1);}return 0;});
      const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(options.maxRows??1000,Number(url.searchParams.get('limit')||rows.length));
      rows=rows.slice(offset,offset+limit);
      const headers=new Headers(init.headers);
      const accept=headers.get('accept')||'';
      const prefer=headers.get('prefer')||'';
      const extra=prefer.includes('count=exact')?{'content-range':`0-${Math.max(0,rows.length-1)}/${count}`}:{'content-range':`0-${Math.max(0,rows.length-1)}/*`};
      if(options.omitCount?.(call)) delete extra['content-range'];
      if(method==='HEAD')return response(null,200,extra);
      if(method!=='GET')return response({code:'READ_ONLY_AUDIT',message:'Unplanned table write rejected'},400);
      if(accept.includes('application/vnd.pgrst.object+json')) {
        if(rows.length!==1)return response({code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:`The result contains ${rows.length} rows`},406);
        return response(rows[0],200,extra);
      }
      return response(rows,200,extra);
    }
    throw new Error('Unhandled fixture request '+method+' '+url.pathname);
  }
  const jar={get:key=>key==='pc_admin_token'&&role!==null?{value:token}:undefined,set:(...args)=>cookiesChanged.push(['set',...args]),delete:key=>cookiesChanged.push(['delete',key])};
  const cache=new Map();
  function load(file) {
    file=path.resolve(file);
    if(cache.has(file))return cache.get(file).exports;
    const mod={exports:{}};cache.set(file,mod);loaded.push(path.relative(ROOT,file));
    const local=name=>{
      if(name==='react/jsx-runtime')return jsx;
      if(name==='react')return {...req('react'),cache:f=>f};
      if(name==='@supabase/supabase-js')return SDK;
      if(name==='server-only')return {};
      if(name==='next/headers')return {cookies:async()=>jar,headers:async()=>new Headers({'origin':'https://admin-fixture.invalid','host':'admin-fixture.invalid'})};
      if(name==='next/cache')return {revalidatePath:(...args)=>revalidated.push(args)};
      if(name==='next/navigation')return {redirect:url=>{throw Object.assign(new Error('REDIRECT '+url),{auditRedirect:url});},notFound:()=>{throw Object.assign(new Error('NOT_FOUND'),{auditNotFound:true});}};
      if(name==='next/server')return {connection:async()=>{},NextResponse:{redirect:url=>Response.redirect(url)}};
      if(name==='next/link'||name==='next/image')return ui(name==='next/link'?'Link':'Image');
      if(name==='@/lib/requestTime')return {requestTime:async()=>NOW,measureRead:async f=>({value:await f(),elapsedMs:1})};
      if(name.startsWith('@/components/')&&!name.endsWith('/PermissionGate')&&!name.endsWith('/RecordPages'))return ui(name.split('/').pop());
      if(name.startsWith('@/')||name.startsWith('.')) {
        const target=resolveFile(name,file);
        if(/\/(SecurityForm|RecoveryForms|ReviewForm|OperationsPanel)\.tsx$/.test(target))return ui(path.basename(target,'.tsx'));
        return load(target);
      }
      return req(name);
    };
    const context={module:mod,exports:mod.exports,require:local,process:{env:environment},Buffer,Date,URL,URLSearchParams,Request,Response,Headers,FormData,File,Blob,AbortSignal,AbortController,Promise,Number,Math,Set,Map,WeakMap,Uint8Array,Array,Object,String,Error,TypeError,RegExp,JSON,crypto:crypto.webcrypto,performance,fetch:fetchFixture,setTimeout,clearTimeout,console};
    vm.runInNewContext(source(file),context,{filename:path.relative(ROOT,file)});
    return mod.exports;
  }
  return {load,calls,cookiesChanged,revalidated,loaded,fetchFixture,options};
}
async function projectTree(tree) {
  const text=[],components=[],controls=[],forms=[],cards=[],desks=[];
  async function walk(node,form) {
    if(node==null||typeof node==='boolean')return node;
    if(typeof node==='string'||typeof node==='number'){text.push(String(node));return node;}
    if(Array.isArray(node)){const list=[];for(const n of node)list.push(await walk(n,form));return list;}
    if(!node.props)return null;
    if(typeof node.type==='function')return walk(await node.type(node.props),form);
    const p=node.props,t=typeof node.type==='string'?node.type:node.type?.name||'unknown';
    if(t.startsWith('component:'))components.push({type:t,props:Object.keys(p)});
    if(t==='component:StatStrip')cards.push(...p.cards.map(c=>({label:c.label,value:c.value,note:c.note})));
    if(t==='component:Desk')desks.push({key:node.key,pageSize:p.pageSize,rows:p.rows,tabs:p.tabs,columns:p.columns,filters:p.filters,searchHint:p.searchHint,actions:(p.actions||[]).map(a=>({...a,action:a.action.name}))});
    if(t==='form'||t==='component:CommandForm') {form={action:typeof p.action==='function'?p.action.name:p.action,scope:p.scope,fields:[],buttons:[]};forms.push(form);}
    if(['input','textarea','select'].includes(t)&&form)form.fields.push({tag:t,name:p.name,type:p.type,defaultValue:p.defaultValue,value:p.value,required:p.required,minLength:p.minLength,maxLength:p.maxLength});
    if(['button','a','component:Link','input','select','textarea'].includes(t))controls.push({tag:t,href:p.href,name:p.name,type:p.type,disabled:p.disabled,label:p['aria-label'],title:p.title,text:flattenText(p.children),formAction:form?.action});
    if(t==='button'&&form)form.buttons.push({text:flattenText(p.children),name:p.name,value:p.value,type:p.type});
    const children=await walk(p.children,form);
    return {type:t,key:node.key,props:{...serialize(p),children}};
  }
  const renderedTree=await walk(tree,null);
  return {text:text.join(' ').replace(/\s+/g,' ').trim(),cards,desks,forms,controls,components,tree:renderedTree};
}
function serialize(v){if(typeof v==='function')return {__auditAction:v.name};if(Array.isArray(v))return v.map(serialize);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='children').map(([k,x])=>[k,serialize(x)]));return v;}
function flattenText(n) {if(n==null||typeof n==='boolean')return '';if(typeof n==='string'||typeof n==='number')return String(n);if(Array.isArray(n))return n.map(flattenText).join(' ');return flattenText(n.props?.children);}
async function runPage(file,options={}) {
  const h=makeHarness(options);let result;
  try{const page=h.load(path.join(ROOT,file)).default;const tree=await page({params:Promise.resolve({id:TARGET,uid:TARGET,tid:TARGET}),searchParams:Promise.resolve(options.search||{})});result={outcome:'rendered',...await projectTree(tree)};}
  catch(e){result={outcome:e.auditRedirect?'redirect':e.auditNotFound?'not-found':'threw',error:e.message||String(e),redirect:e.auditRedirect};}
  return {file,scenario:options.name||'empty',role:options.role===undefined?'super_admin':options.role,...result,calls:h.calls,loaded:h.loaded};
}
module.exports={ROOT,ADMIN,NOW,ACTOR,TARGET,SESSION,KEY,makeHarness,runPage,projectTree};
