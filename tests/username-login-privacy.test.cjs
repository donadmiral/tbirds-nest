const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../supabase/functions/sign-in-with-username/index.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let handle;
  const lookups = [];
  const createClient = (_, key) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? {
    rpc: async (name, args) => {
      assert.equal(name, 'email_for_username');
      lookups.push(args.p_username);
      return args.p_username === 'unavailable' ? {error:{message:'private diagnostic'}} :
        {data: args.p_username === 'test.member' ? 'private@example.invalid' : null};
    },
  } : {auth: {signInWithPassword: async ({email,password}) => {
    assert.equal(email, 'private@example.invalid');
    return password === 'correct' ? {data:{user:{id:'member'},session:{access_token:'fixture'}}} : {error:{message:'wrong'}};
  }}};
  const context = { exports:{}, require:()=>({createClient}), Response,
    Deno:{ env:{get:key=>key}, serve:fn=>{handle=fn;} } };
  vm.runInNewContext(compiled, context);
  return {lookups,request:(username,password='wrong')=>handle(new Request('https://test.invalid/',{method:'POST',body:JSON.stringify({username,password})}))};
}

test('case folded handles use exact service lookup and wildcards cannot match profiles', async () => {
 const h=fixture();
 const good=await h.request('@Test.Member','correct');assert.equal(good.status,200);
 assert.equal(good.headers.get('cache-control'),'private, no-store');
 const wrong=await h.request('Test.Member'), absent=await h.request('%');
 assert.equal(absent.status,401);assert.equal(wrong.status,401);assert.deepEqual(await wrong.json(),await absent.json());
 assert.deepEqual(h.lookups,['test.member','test.member','%']);
 const unavailable=await h.request('unavailable');assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/private diagnostic/);
});
