// Local township prototype controller. Node.js 22+; no packages required.
const http = require('node:http');
const { randomUUID } = require('node:crypto');

function createController({ allowedOrigins = [] } = {}) {

  const instanceId = randomUUID();
  let revision = 0, active = false, lossLps = 0, changedAt = new Date().toISOString();


  let blender = { lastSeen: 0, revision: null, instanceId: null };
  const history = [], clients = new Set();


  const state = () => ({
    instanceId, revision, updatedAt: changedAt, mode: 'simulation',
    supplyLps: 8, householdCount: 8,
    leak: { id: 'L-01', active, lossLps, location: { x: -9, y: 0, z: 1.2 } },
    householdTotalLps: +(8 - lossLps).toFixed(4),
    perHouseholdLps: +((8 - lossLps) / 8).toFixed(4),
    flowMultiplier: (8 - lossLps) / 8,
    blender: { connected: Date.now() - blender.lastSeen < 4000,
      appliedRevision: blender.revision,
      synchronized: Date.now() - blender.lastSeen < 4000 && blender.revision === revision && blender.instanceId === instanceId }
  });


  function publish(event) {
    const packet = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      if (res.writableLength > 65536) { res.destroy(); clients.delete(res); }
      else res.write(packet);
    }
  }
  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Use Content-Type: application/json');
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4096) throw fail(413, 'JSON body exceeds 4096 bytes');
    }
    try {
       const value = JSON.parse(raw); 
      if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; 
    }
    catch { 
      throw fail(400, 'Expected a JSON object');
     }
  }



  const server = http.createServer(async (req, res) => {

    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const origin = req.headers.origin;
      const ownOrigin = `http://${req.headers.host}`;

      if (origin && origin !== ownOrigin && !allowedOrigins.includes(origin)) throw fail(403, 'Dashboard origin is not allowed; set DASHBOARD_ORIGIN');
      
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204); return res.end();
      }

      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && (path === '/api/state' || path === '/health')) return send(200, state());
      if (req.method === 'GET' && path === '/api/events') return send(200, history);
      if (req.method === 'GET' && path === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`); clients.add(res);
        res.on('close', () => clients.delete(res)); return;
      }
      
      if (req.method === 'POST' && path === '/api/leak') {
        const input = await body(req);
        if (typeof input.active !== 'boolean') throw fail(400, 'active must be a boolean');
        if (input.pipeId !== undefined && input.pipeId !== 'L-01') throw fail(400, 'This model supports only L-01');
        const loss = input.lossLps ?? (input.active ? 3.6 : 0);
        if (typeof loss !== 'number' || !Number.isFinite(loss) || loss < 0 || loss > 8 || (input.active && loss === 0) || (!input.active && loss !== 0))
          throw fail(400, 'Active leak lossLps must be > 0 and <= 8; repaired leak must be 0');
        if (active === input.active && lossLps === loss) return send(200, state());
        const type = !input.active ? 'leak_repaired' : active ? 'leak_updated' : 'leak_started';
        active = input.active; lossLps = loss; revision++; changedAt = new Date().toISOString();
        const event = { id: `${instanceId}:${revision}`, type, time: changedAt, state: state() };
        history.push(event); if (history.length > 200) history.shift(); publish(event);
        return send(200, state());
      }
      if (req.method === 'POST' && path === '/api/blender') {
        const input = await body(req);
        if (input.instanceId !== instanceId || !Number.isInteger(input.revision) || input.revision < 0 || input.revision > revision) throw fail(400, 'Invalid controller instance or revision');
        blender = { lastSeen: Date.now(), revision: input.revision, instanceId };
        return send(200, { ok: true });
      }
      return send(404, { error: 'Not found', endpoints: ['/api/state', '/api/leak', '/api/events', '/api/stream'] });
    } catch (error) { if (!res.headersSent && !res.destroyed) send(error.status || 500, { error: error.status ? error.message : 'Internal error' }); }
  });
  server.requestTimeout = 10000;
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  return { server, state, async close() {
    clearInterval(heartbeat); for (const res of clients) res.end();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  const app = createController({ allowedOrigins: (process.env.DASHBOARD_ORIGIN || '').split(',').filter(Boolean) });
  app.server.on('error', error => { console.error(`Controller failed: ${error.message}`); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => console.log(`Township controller: http://127.0.0.1:${port}/api/state`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
module.exports = { createController };
