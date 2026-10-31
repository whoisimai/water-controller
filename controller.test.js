const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('./controller');

test('leak lifecycle, event stream, validation, acknowledgements and CORS', async () => {
  const app = createController({ allowedOrigins: ['http://localhost:3000'] });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
  const abort = new AbortController();
  try {
    let state = await (await fetch(url+'/api/state')).json();
    assert.equal(state.perHouseholdLps,1); assert.equal(state.blender.connected,false);
    const stream = await fetch(url+'/api/stream',{signal:abort.signal});
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/event: state/);
    const response = await post('/api/leak',{active:true,lossLps:3.6});
    assert.equal(response.status,200);state=await response.json();
    assert.equal(state.householdTotalLps,4.4);assert.equal(state.flowMultiplier,.55);
    assert.equal(state.supplyLps,state.householdTotalLps+state.leak.lossLps);
    assert.match(new TextDecoder().decode((await reader.read()).value),/leak_started/);
    await post('/api/leak',{active:true,lossLps:3.6});
    assert.equal(app.state().revision,1,'Idempotent requests do not duplicate incidents');
    for(const body of [{active:'true'},{active:true,lossLps:-1},{active:true,lossLps:9},{active:true,lossLps:0},{active:false,lossLps:2},{active:true,pipeId:'unknown'},{active:true,lossLps:'3'}])
      assert.equal((await post('/api/leak',body)).status,400);
    assert.equal(app.state().revision,1,'Invalid requests cannot change state');
    const malformed=await fetch(url+'/api/leak',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'});
    assert.equal(malformed.status,400);
    assert.equal((await post('/api/leak',{active:true,padding:'x'.repeat(5000)})).status,413);
    assert.equal((await post('/api/leak',{active:true},{Origin:'https://untrusted.example'})).status,403);
    const preflight=await fetch(url+'/api/leak',{method:'OPTIONS',headers:{Origin:'http://localhost:3000'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:3000');
    assert.equal((await post('/api/blender',{instanceId:state.instanceId,revision:state.revision})).status,200);
    assert.equal(app.state().blender.synchronized,true);
    await post('/api/leak',{active:true,lossLps:8});
    assert.equal(app.state().flowMultiplier,0);assert.equal(app.state().blender.synchronized,false);
    await post('/api/leak',{active:false});
    assert.equal(app.state().perHouseholdLps,1);assert.equal(app.state().leak.active,false);
    const history=await (await fetch(url+'/api/events')).json();
    assert.deepEqual(history.map(e=>e.type),['leak_started','leak_updated','leak_repaired']);
    await new Promise(resolve=>setTimeout(resolve,4100));
    assert.equal(app.state().blender.connected,false,'Stale bridge heartbeat is disconnected');
  } finally { abort.abort(); await app.close(); }
});
