const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { run, validateTarget } = require('../tools/performance/http-load.cjs');
test('load testing is local by default and remote staging requires exact explicit opt-in', () => {
  assert.equal(validateTarget('http://127.0.0.1:3000/home').local,true);
  assert.throws(()=>validateTarget('https://platinumcircles.app/home'),/Remote load is disabled/);
  assert.throws(()=>validateTarget('https://staging.example.test/home',{allowStaging:true,allowedHost:'other.example.test'}),/Remote load is disabled/);
  assert.equal(validateTarget('https://staging.example.test/home',{allowStaging:true,allowedHost:'staging.example.test'}).local,false);
  assert.throws(()=>validateTarget('https://user:password@staging.example.test'),/credentials/);
});
test('GET-only probe counts errors and missing initial content rather than treating redirects as success', async () => {
  let requests=0;const methods=[];
  const server=http.createServer((req,res)=>{methods.push(req.method);requests++;if(requests===2){res.writeHead(302,{Location:'/login'});res.end();}else{res.end('<div data-feed-content="true">A post</div>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const report=await run({url:`http://127.0.0.1:${server.address().port}/home`,requests:4,rate:200,concurrency:2,expect:'data-feed-content'});
    assert.deepEqual(methods,['GET','GET','GET','GET']);assert.equal(report.completed,4);assert.equal(report.failures,1);assert.equal(report.passed,false);assert.equal(report.statuses[302],1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('invalid thresholds and unbounded slow runs are rejected before any network request', async () => {
  for (const options of [{ maxErrorRate: 2 }, { maxErrorRate: -1 }, { maxErrorRate: 'oops' }, { maxP95: 0 }, { rate: 0.0001 }, { requests: 100000, rate: 0.1 }]) {
    await assert.rejects(run({ url: 'http://127.0.0.1:1/', ...options }), /load budget/);
  }
});
