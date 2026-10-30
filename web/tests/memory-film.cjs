const test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
const {createFilmHarness}=require('../../tests/helpers/memoryFilmHarness.cjs');

test('web film advances and loops its hydrated photos while retaining one continuous score',async()=>{
 const h=createFilmHarness(ts,'web');await h.settle();h.mediaReady();await h.settle();await h.tick(6000);assert.match(h.words(),/2 \/ 2/);h.mediaReady();await h.settle();await h.tick(6000);assert.match(h.words(),/1 \/ 2/);assert.equal(h.audioNode.paused,false);assert.ok(h.nodes().some(n=>n.props['aria-label']==='Pause memory film'));h.dispose();assert.equal(h.audioNode.paused,true);
});
test('web film has working pause, previous/next, music mute, read-book and close controls',async()=>{
 const h=createFilmHarness(ts,'web');await h.settle();h.press('Previous memory');await h.settle();assert.match(h.words(),/2 \/ 2/);h.press('Next memory');await h.settle();assert.match(h.words(),/1 \/ 2/);h.press('Pause memory film');await h.settle();assert.equal(h.audioNode.paused,true);h.press('Play memory film');await h.settle();assert.equal(h.audioNode.paused,false);h.press('Turn off background music');await h.settle();assert.equal(h.audioNode.paused,true);h.press('Read memory book');h.press('Close memory film');assert.equal(h.read,1);assert.equal(h.closed,1);h.dispose();
});
test('web film pauses on background/call state and requires a click when browser audio permission rejects',async()=>{
 const h=createFilmHarness(ts,'web');h.audioNode.playReject={name:'NotAllowedError'};await h.settle();assert.match(h.words(),/Play background music/);h.audioNode.playReject=null;const retry=h.nodes().find(n=>n.type==='button'&&n.props.className==='audioRetry');retry.props.onClick();await h.settle();assert.equal(h.audioNode.paused,false);h.setForeground(false);await h.settle();assert.equal(h.audioNode.paused,true);h.setForeground(true);await h.settle();h.setCall('connected');await h.settle();assert.equal(h.audioNode.paused,true);h.dispose();
});
test('web film waits for each photo and exposes retry after its bounded loading deadline',async()=>{
 const h=createFilmHarness(ts,'web');await h.settle();await h.tick(20000);assert.match(h.words(),/taking too long/);assert.match(h.words(),/1 \/ 2/);h.nodes().find(n=>n.type==='button'&&n.props.children==='Retry').props.onClick();await h.settle();assert.equal(h.retries,1);assert.doesNotMatch(h.words(),/taking too long/);h.dispose();
});
test('web film video uses the saved excerpt and speed, and emits one completion across time/end events',async()=>{
 const h=createFilmHarness(ts,'web',{component:'video'});await h.settle();const node=h.nodes().find(n=>n.type==='video');node.props.onLoadedMetadata();await h.settle();assert.equal(h.videoNode.currentTime,2);assert.equal(h.videoNode.playbackRate,2);h.videoNode.currentTime=3.5;h.nodes().find(n=>n.type==='video').props.onTimeUpdate({currentTarget:h.videoNode});assert.equal(h.progress.at(-1),.5);h.videoNode.currentTime=5;h.nodes().find(n=>n.type==='video').props.onTimeUpdate({currentTarget:h.videoNode});h.nodes().find(n=>n.type==='video').props.onEnded();assert.equal(h.ended,1);h.dispose();
});
test('web film video pauses immediately on visibility changes and cannot finish an inactive page',async()=>{
 const h=createFilmHarness(ts,'web',{component:'video'});await h.settle();h.setForeground(false);await h.settle();assert.equal(h.videoNode.paused,true);h.nodes().find(n=>n.type==='video').props.onEnded();assert.equal(h.ended,0);h.setForeground(true);h.setActive(false);await h.settle();h.nodes().find(n=>n.type==='video').props.onEnded();assert.equal(h.ended,0);h.dispose();
});
test('a late successful browser play cannot reactivate audio after the film unmounts',async()=>{
 const h=createFilmHarness(ts,'web');let resolve;h.audioNode.playPending=new Promise(done=>{resolve=done;});await h.settle();h.dispose();h.audioNode.paused=false;resolve();await h.settle();assert.equal(h.audioNode.paused,true);
});
