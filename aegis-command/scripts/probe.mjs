import { request } from 'node:https';
import { readFileSync } from 'node:fs';
const origin = new URL(process.env.AEGIS_ORIGIN);
if (origin.protocol !== 'https:') throw new Error('Use the production HTTPS origin.');
const options = { ca: readFileSync(process.env.AEGIS_SERVER_CA), minVersion: 'TLSv1.3', agent: false };
function get(path, authenticatedDevice) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { ...options, ...(authenticatedDevice ? { cert: readFileSync(process.env.AEGIS_PROBE_CERT), key: readFileSync(process.env.AEGIS_PROBE_KEY) } : {}) }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.setTimeout(5000, () => req.destroy(new Error('Probe timed out.'))); req.on('error', reject); req.end();
  });
}
let rejected = false;
try { await get('/healthz', false); } catch { rejected = true; }
if (!rejected) throw new Error('FAIL: server accepted a client without a device certificate.');
if (await get('/healthz', true) !== 200) throw new Error('FAIL: approved device cannot reach health check.');
if (await get('/api/v1/state', true) !== 401) throw new Error('FAIL: incident API is not enforcing person authentication.');
console.log('PASS: server certificate trusted, client certificate required, approved device admitted, unauthenticated incident read rejected.');
