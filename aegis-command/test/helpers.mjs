import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
export const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
function header(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(n, 1); return result;
}
function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([header(2, value.length), value]);
  if (typeof value === 'string') return Buffer.concat([header(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (typeof value === 'number') return header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  const map = value instanceof Map ? value : new Map(Object.entries(value));
  return Buffer.concat([header(5, map.size), ...[...map].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}
// Test-only authenticator: the production verifier receives real P-256 signatures,
// COSE public keys and CBOR attestation data; authentication is never mocked.
export class Authenticator {
  constructor() { Object.assign(this, generateKeyPairSync('ec', { namedCurve: 'prime256v1' })); this.id = randomBytes(32); this.counter = 0; }
  register(options, origin, { flags = 0x45 } = {}) {
    this.userHandle = options.user.id;
    const jwk = this.publicKey.export({ format: 'jwk' });
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const length = Buffer.alloc(2); length.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([hash(options.rp.id), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), length, this.id, cose]);
    return { id: b64(this.id), rawId: b64(this.id), type: 'public-key', response: { clientDataJSON: b64(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false })), attestationObject: b64(cbor({ fmt: 'none', attStmt: new Map(), authData })), transports: ['usb'] }, clientExtensionResults: {} };
  }
  authenticate(options, origin, { flags = 0x05, counter, invalid = false } = {}) {
    const count = Buffer.alloc(4); count.writeUInt32BE(counter ?? ++this.counter);
    const authData = Buffer.concat([hash(options.rpId), Buffer.from([flags]), count]);
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, hash(client)]), this.privateKey);
    if (invalid) signature[signature.length - 1] ^= 1;
    return { id: b64(this.id), rawId: b64(this.id), type: 'public-key', response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature), userHandle: this.userHandle }, clientExtensionResults: {} };
  }
}
export function certificates(root) {
  function openssl(...args) { execFileSync('openssl', args, { stdio: 'pipe' }); }
  const p = name => join(root, name); mkdirSync(root, { recursive: true });
  openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.crt'), '-days', '1', '-subj', '/CN=Test enclave root', '-addext', 'basicConstraints=critical,CA:TRUE');
  for (const name of ['server', 'first', 'second', 'responder', 'observer', 'unknown', 'replacement']) {
    openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', p(name + '.key'), '-out', p(name + '.csr'), '-subj', '/CN=' + name);
    writeFileSync(p(name + '.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=' + (name === 'server' ? 'serverAuth\nsubjectAltName=DNS:localhost' : 'clientAuth'));
    openssl('x509', '-req', '-in', p(name + '.csr'), '-CA', p('ca.crt'), '-CAkey', p('ca.key'), '-CAcreateserial', '-out', p(name + '.crt'), '-days', '1', '-extfile', p(name + '.ext'));
  }
  return { p, read: name => readFileSync(p(name)) };
}
export function client(cfg, port, certs, name) {
  return { cookie: '', csrf: '',
    async call(path, body, extra = {}, raw = false) {
      const headers = { Host: new URL(cfg.origin).host, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { Origin: cfg.origin, 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-CSRF-Token': this.csrf }), ...extra };
      const response = await new Promise((resolve, reject) => {
        const req = httpsRequest({ hostname: 'localhost', servername: 'localhost', port, path, method: body === undefined ? 'GET' : 'POST', headers, ca: certs.read('ca.crt'), ...(name ? { cert: certs.read(name + '.crt'), key: certs.read(name + '.key') } : {}), minVersion: 'TLSv1.3', agent: false }, res => {
          const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const bytes = Buffer.concat(chunks), text = bytes.toString(); let json; try { json = JSON.parse(text); } catch { json = text; } resolve({ status: res.statusCode, headers: res.headers, body: json, bytes }); });
        }); req.on('error', reject); if (body !== undefined) req.write(raw ? body : JSON.stringify(body)); req.end();
      });
      if (response.headers['set-cookie']) this.cookie = response.headers['set-cookie'][0].split(';')[0];
      if (path === '/api/v1/me' && response.status === 200) this.csrf = response.body.csrf;
      return response;
    },
  };
}
