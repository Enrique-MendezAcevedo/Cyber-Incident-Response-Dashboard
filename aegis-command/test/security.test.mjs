import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server.mjs';
import { config } from '../lib/config.mjs';
import { newInvite, INCIDENT } from '../lib/access.mjs';
import { sha256, MAX_UPLOAD } from '../lib/blobs.mjs';
import { seal, unseal } from '../lib/store.mjs';
import { certificates, client, Authenticator } from './helpers.mjs';

test('configuration fails closed and encrypted storage detects modification', () => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-config-')); const keyPath = join(root, 'storage.key');
  writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  const env = { AEGIS_MODE: 'development', AEGIS_KEY_FILE: keyPath, AEGIS_DATABASE: join(root, 'data/vault.sqlite') };
  assert.throws(() => config({}), /Invalid URL/);
  assert.throws(() => config({ ...env, AEGIS_HOST: '0.0.0.0' }), /cannot bind/);
  assert.throws(() => config({ ...env, AEGIS_MODE: 'production', AEGIS_ORIGIN: 'http://localhost' }), /HTTPS/);
  assert.throws(() => config({ ...env, AEGIS_DATABASE: join(root, 'vault.sqlite') }), /outside/);
  assert.equal(config(env).rpID, 'localhost');
  const key = randomBytes(32), encrypted = seal({ secret: 'incident data' }, key);
  assert(!encrypted.includes(Buffer.from('incident data'))); assert.deepEqual(unseal(encrypted, key), { secret: 'incident data' });
  encrypted[35] ^= 1; assert.throws(() => unseal(encrypted, key));
});

test('real mutual TLS and WebAuthn enforce enrollment, roles, approvals and revocation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-security-')); const certs = certificates(join(root, 'pki'));
  const keyPath = join(root, 'storage.key'); writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  const cfg = config({ AEGIS_ORIGIN: 'https://localhost:8443', AEGIS_HOST: '127.0.0.1', PORT: '0', AEGIS_KEY_FILE: keyPath, AEGIS_DATABASE: join(root, 'data/vault.sqlite'), AEGIS_TLS_KEY: certs.p('server.key'), AEGIS_TLS_CERT: certs.p('server.crt'), AEGIS_DEVICE_CA: certs.p('ca.crt') });
  const app = await createApp(cfg); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port; cfg.origin = 'https://localhost:' + port;
  t.after(() => app.close());
  const fp = name => new X509Certificate(certs.read(name + '.crt')).fingerprint256.replaceAll(':', '').toLowerCase();
  const first = client(cfg, port, certs, 'first'), second = client(cfg, port, certs, 'second'), responder = client(cfg, port, certs, 'responder'), observer = client(cfg, port, certs, 'observer');
  const keys = { first: new Authenticator(), second: new Authenticator(), responder: new Authenticator(), observer: new Authenticator() };
  let firstId, secondId, responderId, observerId;
  const initial = await app.store.run(data => ['first', 'second'].map(name => newInvite(data, { username: name, name: name + ' Custodian', fingerprint: fp(name) }, 'offline-custodians', cfg, { admin: true })));
  async function enroll(c, token, key, flags) {
    const challenge = await c.call('/api/v1/auth/enroll/options', { token }); assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const response = key.register(challenge.body.options, cfg.origin, flags ? { flags } : {});
    return c.call('/api/v1/auth/enroll/verify', { flowId: challenge.body.flowId, response });
  }
  async function login(c, username, key, overrides) {
    const challenge = await c.call('/api/v1/auth/login/options', { username }); assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const response = key.authenticate(challenge.body.options, cfg.origin, overrides);
    const result = await c.call('/api/v1/auth/login/verify', { flowId: challenge.body.flowId, response });
    if (result.status === 200) await c.call('/api/v1/me');
    return { ...result, flowId: challenge.body.flowId, response };
  }
  await t.test('untrusted, unapproved and unauthenticated clients are rejected', async () => {
    await assert.rejects(client(cfg, port, certs).call('/healthz'));
    assert.equal((await client(cfg, port, certs, 'unknown').call('/')).status, 403);
    assert.equal((await first.call('/api/v1/state')).status, 401);
    assert.equal((await first.call('/api/v1/auth/enroll/options', { token: initial[0].token }, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await first.call('/', undefined, { Host: 'attacker.test' })).status, 421);
    assert.equal((await first.call('http://[')).status, 400);
    assert.equal((await first.call('/healthz')).status, 200);
  });
  await t.test('deployment probe verifies the actual HTTPS boundary', async () => {
    const result = await promisify(execFile)(process.execPath, ['scripts/probe.mjs'], { env: { ...process.env, AEGIS_ORIGIN: cfg.origin, AEGIS_SERVER_CA: certs.p('ca.crt'), AEGIS_PROBE_CERT: certs.p('first.crt'), AEGIS_PROBE_KEY: certs.p('first.key') } });
    assert.match(result.stdout, /PASS:/);
  });
  await t.test('verified single-device keys enroll once; administrators have no default incident access', async () => {
    let result = await enroll(first, initial[0].token, keys.first); assert.equal(result.status, 200, JSON.stringify(result.body)); firstId = result.body.user.id;
    assert.match(result.headers['set-cookie'][0], /__Host-aegis=.*Secure/); assert.match(result.headers['set-cookie'][0], /HttpOnly/);
    result = await enroll(second, initial[1].token, keys.second); assert.equal(result.status, 200); secondId = result.body.user.id;
    await first.call('/api/v1/me'); await second.call('/api/v1/me');
    assert.equal((await first.call('/api/v1/state')).status, 403);
    assert.equal((await first.call('/api/v1/auth/enroll/options', { token: initial[0].token })).status, 401);
    assert.equal((await second.call('/api/v1/auth/enroll/options', { token: initial[0].token })).status, 401);
    const audit = await first.call('/api/v1/people'); assert(!JSON.stringify(audit.body).includes(initial[0].token));
  });
  await t.test('CSRF and explicit incident membership are enforced', async () => {
    assert.equal((await first.call('/api/v1/memberships', { userId: firstId, role: 'commander' }, { 'X-CSRF-Token': 'forged' })).status, 403);
    assert.equal((await first.call('/api/v1/memberships', { userId: firstId, role: 'commander' })).status, 200);
    assert.equal((await first.call('/api/v1/state')).status, 401); // grant invalidates the previous session
    assert.equal((await login(first, 'first', keys.first)).status, 200);
    assert.equal((await first.call('/api/v1/state')).status, 200);
  });
  await t.test('administrators invite responders/observers; synced keys and expired invites fail', async () => {
    let result = await first.call('/api/v1/admin/invites', { username: 'responder', name: 'Alex Rivera', fingerprint: fp('responder'), role: 'responder' }); assert.equal(result.status, 200);
    const token = result.body.token;
    assert.equal((await enroll(responder, token, new Authenticator(), 0x4d)).status, 401); // backup eligible
    result = await enroll(responder, token, keys.responder); assert.equal(result.status, 200, JSON.stringify(result.body)); responderId = result.body.user.id; await responder.call('/api/v1/me');
    result = await first.call('/api/v1/admin/invites', { username: 'observer', name: 'Read Only', fingerprint: fp('observer'), role: 'observer' });
    result = await enroll(observer, result.body.token, keys.observer); assert.equal(result.status, 200); observerId = result.body.user.id; await observer.call('/api/v1/me');
    const expired = await app.store.run(data => newInvite(data, { username: 'expired', name: 'Expired Person', fingerprint: fp('unknown') }, firstId, cfg, { ttl: -1 }));
    assert.equal((await client(cfg, port, certs, 'unknown').call('/api/v1/auth/enroll/options', { token: expired.token })).status, 403);
  });
  await t.test('roles cannot be bypassed by forged actor, endpoint or submission', async () => {
    assert.equal((await observer.call('/api/v1/state')).status, 200);
    assert.equal((await observer.call('/api/v1/state', { kind: 'message', id: 'observe', body: 'forbidden' })).status, 403);
    assert.equal((await responder.call('/api/v1/admin/invites', { username: 'evil', name: 'Evil Person', role: 'commander' })).status, 403);
    assert.equal((await responder.call('/api/v1/memberships', { userId: responderId, role: 'commander' })).status, 403);
    assert.equal((await responder.call('/api/v1/state', { kind: 'message', actor: 'first Custodian', id: 'forged', body: 'forbidden' })).status, 400);
    let result = await responder.call('/api/v1/state', { kind: 'message', id: 'real', body: 'Authenticated response' }); assert.equal(result.status, 200); assert.equal(result.body.messages.at(-1).authorId, responderId);
    const count = result.body.messages.length;
    result = await responder.call('/api/v1/state', { kind: 'message', id: 'real', body: 'Authenticated response' }); assert.equal(result.body.messages.length, count);
    assert.equal((await responder.call('/api/v1/export', {})).status, 403);
  });
  await t.test('new incident routes preserve isolation, creator session and separate grants over HTTPS', async () => {
    const command = { id: 'new-private-incident', title: 'Private service incident', severity: 'High', severityRationale: 'Service disruption', summary: 'Validated report of disruption', commanderId: firstId };
    const created = await first.call('/api/v1/incidents', command); assert.equal(created.status, 200, JSON.stringify(created.body));
    const incidentId = created.body.id;
    assert.equal((await first.call('/api/v1/incidents/' + incidentId)).status, 200);
    assert.equal((await responder.call('/api/v1/incidents/' + incidentId)).status, 403);
    assert.equal((await second.call('/api/v1/incidents/' + incidentId)).status, 403);
    const listing = await responder.call('/api/v1/incidents'); assert(!listing.body.incidents.some(i => i.id === incidentId));
    assert.equal((await first.call('/api/v1/memberships', { userId: responderId, role: 'responder', incidentId })).status, 200);
    assert.equal((await responder.call('/api/v1/incidents/' + incidentId)).status, 401);
    assert.equal((await login(responder, 'responder', keys.responder)).status, 200);
    assert.equal((await responder.call('/api/v1/incidents/' + incidentId)).status, 200);
    assert.equal((await responder.call('/api/v1/incidents', { ...command, id: 'responder-create' })).status, 403);
    assert.equal((await observer.call('/api/v1/my-tasks')).body.tasks.length, 0);
  });
  await t.test('HTTPS evidence uploads are bounded, quarantined, scoped and idempotent; report downloads require a second commander', async () => {
    const bytes = Buffer.from('original log <script>this must never execute</script>');
    let result = await responder.call('/api/v1/state', { kind: 'evidence-create', id: 'register-evidence', reference: 'EV-HTTP', title: 'Gateway log', source: 'Test collector', collector: 'Alex Rivera', collectedAt: new Date().toISOString(), description: 'Controlled test original', storageReference: 'Test response kit', classification: 'Restricted', sourceDigest: sha256(bytes) }); assert.equal(result.status, 200, JSON.stringify(result.body));
    const evidence = result.body.evidenceRegister[0], upload = `/api/v1/incidents/${INCIDENT}/evidence/${evidence.id}/attachments`;
    const headers = { 'X-Aegis-File-Name': 'gateway.log', 'X-Submission-ID': 'http-upload-1' };
    assert.equal((await observer.call(upload, bytes, headers, true)).status, 403);
    assert.equal((await responder.call(upload, bytes, { ...headers, Origin: 'https://attacker.test' }, true)).status, 403);
    assert.equal((await responder.call(upload, bytes, { ...headers, 'X-CSRF-Token': 'forged' }, true)).status, 403);
    assert.equal((await responder.call(upload, bytes, { ...headers, 'X-Aegis-File-Name': '..%2Fevil.log' }, true)).status, 400);
    assert.equal((await responder.call(upload, bytes, { ...headers, 'X-Aegis-File-Name': 'active.html' }, true)).status, 415);
    assert.equal((await responder.call(upload, bytes, { ...headers, 'X-Aegis-File-Name': 'fake.png' }, true)).status, 415);
    assert.equal((await responder.call(upload, Buffer.alloc(0), { ...headers, 'Content-Length': String(MAX_UPLOAD + 1) }, true)).status, 413);
    result = await responder.call(upload, bytes, headers, true); assert.equal(result.status, 200, JSON.stringify(result.body)); const original = result.body.evidenceRegister[0].attachments[0];
    assert.equal(original.status, 'Quarantined'); assert.equal((await responder.call(upload, bytes, headers, true)).body.evidenceRegister[0].attachments.length, 1);
    const originalURL = upload + '/' + original.id;
    assert.equal((await first.call(originalURL)).status, 403); assert.equal((await second.call(originalURL)).status, 403);
    result = await first.call('/api/v1/state', { kind: 'evidence-review', id: 'review-http-original', entityId: evidence.id, attachmentId: original.id, status: 'Approved for controlled download', body: 'Reviewed through the independent forensic process' }); assert.equal(result.status, 200);
    result = await first.call(originalURL); assert.equal(result.status, 200); assert.deepEqual(result.bytes, bytes); assert.match(result.headers['content-disposition'], /^attachment/); assert.match(result.headers['content-type'], /application\/octet-stream/); assert.match(result.headers['content-security-policy'], /sandbox/);
    assert.equal((await observer.call(originalURL)).status, 403);
    result = await first.call('/api/v1/state', { kind: 'export-request', id: 'request-http-report', format: 'html', body: 'After-action briefing' }); assert.equal(result.status, 200); const reportId = result.body.exports[0].id;
    const reportURL = `/api/v1/incidents/${INCIDENT}/reports/${reportId}`;
    assert.equal((await first.call(reportURL + '/download')).status, 403);
    assert.equal((await first.call('/api/v1/export', {})).status, 403);
    assert.equal((await first.call('/api/v1/memberships', { userId: secondId, role: 'commander', incidentId: INCIDENT })).status, 200);
    assert.equal((await login(second, 'second', keys.second)).status, 200);
    result = await second.call(reportURL + '/preview'); assert.equal(result.status, 200); assert.match(result.body, /Evidence register and chain of custody/);
    result = await second.call('/api/v1/state', { kind: 'export-approve', id: 'approve-http-report', exportId: reportId, body: 'Reviewed fixed snapshot and recipient scope' }); assert.equal(result.status, 200);
    const downloaded = await first.call(reportURL + '/download'), manifest = await first.call(reportURL + '/manifest'); assert.equal(downloaded.status, 200); assert.equal(sha256(downloaded.bytes), manifest.body.sha256);
    assert.equal((await responder.call(reportURL + '/download')).status, 403);
  });
  await t.test('WebAuthn rejects bad signatures, missing verification, wrong origin and replay', async () => {
    assert.equal((await login(responder, 'responder', keys.responder, { invalid: true })).status, 401);
    assert.equal((await login(responder, 'responder', keys.responder, { flags: 0x01 })).status, 400);
    let challenge = await responder.call('/api/v1/auth/login/options', { username: 'responder' });
    assert.equal((await responder.call('/api/v1/auth/login/verify', { flowId: challenge.body.flowId, response: keys.responder.authenticate(challenge.body.options, 'https://attacker.test') })).status, 400);
    const result = await login(responder, 'responder', keys.responder); assert.equal(result.status, 200);
    assert.equal((await responder.call('/api/v1/auth/login/verify', { flowId: result.flowId, response: result.response })).status, 401);
    const stolen = client(cfg, port, certs, 'second'); stolen.cookie = responder.cookie;
    assert.equal((await stolen.call('/api/v1/state')).status, 401);
  });
  await t.test('suspension revokes an existing cookie immediately and audit records the action', async () => {
    assert.equal((await first.call('/api/v1/admin/suspend', { userId: responderId, suspended: true })).status, 200);
    assert.equal((await responder.call('/api/v1/state')).status, 401);
    assert.equal((await responder.call('/api/v1/auth/login/options', { username: 'responder' })).status, 401);
    assert.equal((await first.call('/api/v1/admin/suspend', { userId: responderId, suspended: false })).status, 200);
    assert.equal((await login(responder, 'responder', keys.responder)).status, 200);
    const result = await first.call('/api/v1/people'); assert(result.body.audit.some(e => e.action === 'user.suspended'));
  });
  await t.test('two different custodians approve administrator elevation', async () => {
    const result = await first.call('/api/v1/admin/proposals', { kind: 'admin-grant', userId: observerId }); assert.equal(result.status, 200);
    assert.equal((await first.call('/api/v1/admin/approve', { id: result.body.proposal.id })).status, 400);
    assert.equal((await second.call('/api/v1/admin/approve', { id: result.body.proposal.id })).status, 200);
    assert.equal((await observer.call('/api/v1/me')).status, 401);
    assert.equal((await login(observer, 'observer', keys.observer)).status, 200);
    assert.equal((await observer.call('/api/v1/me')).body.user.admin, true);
  });
  await t.test('two-custodian recovery revokes old keys/devices and binds enrollment to a clean replacement', async () => {
    const result = await first.call('/api/v1/admin/proposals', { kind: 'recovery', userId: responderId, fingerprint: fp('replacement') }); assert.equal(result.status, 200);
    const approved = await second.call('/api/v1/admin/approve', { id: result.body.proposal.id }); assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal((await responder.call('/api/v1/state')).status, 403);
    const replacement = client(cfg, port, certs, 'replacement'); const key = new Authenticator();
    assert.equal((await enroll(replacement, approved.body.token, key)).status, 200);
    await replacement.call('/api/v1/me'); assert.equal((await replacement.call('/api/v1/state')).status, 200);
    assert.equal((await first.call('/api/v1/admin/revoke-device', { fingerprint: fp('replacement') })).status, 200);
    assert.equal((await replacement.call('/api/v1/state')).status, 403);
  });
  await t.test('recent verification, idle timeout and logout are enforced server-side', async () => {
    await app.store.run(data => { data.sessions.find(s => s.userId === firstId).verified = Date.now() - cfg.recentMs - 1; });
    assert.equal((await first.call('/api/v1/admin/invites', { username: 'recent', name: 'Recent Person', fingerprint: fp('unknown') })).status, 428);
    assert.equal((await login(first, 'first', keys.first)).status, 200);
    assert.equal((await first.call('/api/v1/auth/logout', {})).status, 200);
    assert.equal((await first.call('/api/v1/state')).status, 401);
    await app.store.run(data => { data.sessions.find(s => s.userId === secondId).lastSeen = Date.now() - cfg.idleMs - 1; });
    assert.equal((await second.call('/api/v1/me')).status, 401);
    assert(!readFileSync(cfg.database).includes(Buffer.from('Authenticated response')));
    assert(!readFileSync(cfg.database).includes(Buffer.from('Alex Rivera')));
  });
});
