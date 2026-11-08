import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './lib/config.mjs';
import { Store, audit } from './lib/store.mjs';
import { Auth, administer, assign } from './lib/auth.mjs';
import { principal, requireThat, equal, publicUser, requireAdmin, requireMember, member, recent, revoke } from './lib/access.mjs';
import { visible, mutate, catalog, createIncident, canCreate } from './lib/incident.mjs';
import { INCIDENT } from './lib/access.mjs';
import { BlobStore, MAX_UPLOAD, sha256 } from './lib/blobs.mjs';
import { evidenceById, custody } from './lib/evidence.mjs';
import { authorizedJob, exportBytes, exportManifest, reportHTML } from './lib/reports.mjs';
import { text } from './lib/model.mjs';

export async function createApp(cfg) {
  const store = new Store(cfg.database, cfg.key);
  const auth = new Auth(cfg);
  const blobs = new BlobStore(cfg.evidenceRoot, cfg.key);
  const assets = new Map();
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'],
    ['/auth-ui.js', 'auth-ui.js', 'text/javascript'], ['/forms.js', 'forms.js', 'text/javascript'], ['/review-ui.js', 'review-ui.js', 'text/javascript'], ['/visuals.js', 'visuals.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
  ]) assets.set(path, { body: await readFile(new URL('./web/' + file, import.meta.url)), type });
  const limits = new Map();
  function rate(request, authRoute) {
    const developmentSession = cfg.development && request.headers.cookie ? sha256(Buffer.from(request.headers.cookie)).slice(0, 24) : request.device;
    const key = request.device + ':' + (authRoute ? 'auth' : 'api:' + developmentSession);
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    requireThat(limits.size < 5000 || limits.has(key), 'Service busy.', 429);
    let value = limits.get(key);
    if (!value) { value = { count: 0, until: now + 60_000 }; limits.set(key, value); }
    requireThat(++value.count <= (authRoute ? 30 : 240), 'Too many requests. Wait one minute.', 429);
  }
  async function bodyOf(request) {
    requireThat(request.headers['content-type']?.split(';')[0].trim() === 'application/json', 'JSON required.', 415);
    requireThat(request.headers.origin === cfg.origin && !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']), 'Request origin rejected.', 403);
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; requireThat(size <= 65536, 'Request too large.', 413); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString()); requireThat(body && typeof body === 'object' && !Array.isArray(body), 'Object required.'); return body; }
    catch { requireThat(false, 'Invalid JSON.'); }
  }
  const handler = async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!cfg.development) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let actorId = null;
    const route = request.url?.split('?')[0];
    let query;
    try {
      requireThat(request.url?.startsWith('/') && !request.url.startsWith('//'), 'Invalid request target.');
      query = new URL(request.url, cfg.origin).searchParams;
      requireThat(request.headers.host === new URL(cfg.origin).host, 'Host rejected.', 421);
      requireThat(!request.headers.origin || request.headers.origin === cfg.origin, 'Origin rejected.', 403);
      if (cfg.development) request.device = 'development';
      else {
        requireThat(request.socket.authorized, 'Approved device certificate required.', 403);
        const certificate = request.socket.getPeerCertificate();
        requireThat(Date.parse(certificate.valid_from) <= Date.now() && Date.parse(certificate.valid_to) > Date.now(), 'Device certificate expired. Contact a custodian.', 403);
        request.device = certificate.fingerprint256?.replaceAll(':', '').toLowerCase();
        requireThat(request.device, 'Device certificate required.', 403);
      }
      rate(request, route?.startsWith('/api/v1/auth/'));
      const uploadRoute = route.match(/^\/api\/v1\/incidents\/([a-zA-Z0-9-]+)\/evidence\/([a-f0-9-]{36})\/attachments$/);
      const downloadRoute = route.match(/^\/api\/v1\/incidents\/([a-zA-Z0-9-]+)\/evidence\/([a-f0-9-]{36})\/attachments\/([a-f0-9-]{36})$/);
      const reportRoute = route.match(/^\/api\/v1\/incidents\/([a-zA-Z0-9-]+)\/reports\/([a-f0-9-]{36})\/(preview|download|manifest)$/);
      const body = request.method === 'POST' ? uploadRoute ? {} : await bodyOf(request) : null;
      requireThat(['GET', 'POST'].includes(request.method), 'Method not allowed.', 405);
      const result = await store.run(async data => {
        if (!cfg.development) {
          requireThat(!data.devices.some(d => d.fingerprint === request.device && d.status === 'revoked'), 'Device revoked.', 403);
          requireThat(data.devices.some(d => d.fingerprint === request.device && d.status === 'active') || data.invites.some(i => i.device === request.device && !i.used && i.expires > Date.now()), 'Device not enrolled or invited.', 403);
        }
        if (request.method === 'GET' && assets.has(route)) return assets.get(route);
        if (request.method === 'GET' && route === '/healthz') return { json: { status: 'ready' } };
        if (request.method === 'POST') {
          if (route === '/api/v1/auth/enroll/options') return { json: await auth.registration(data, body, request) };
          if (route === '/api/v1/auth/enroll/verify') return { json: await auth.finishRegistration(data, body, request, response) };
          if (route === '/api/v1/auth/login/options') return { json: await auth.loginOptions(data, body, request) };
          if (route === '/api/v1/auth/login/verify') return { json: await auth.loginVerify(data, body, request, response) };
        }
        const me = principal(data, request, cfg); actorId = me.user.id;
        if (body) requireThat(equal(request.headers['x-csrf-token'], me.session.csrf), 'CSRF validation failed.', 403);
        if (uploadRoute && body) {
          const [, incidentId, evidenceId] = uploadRoute;
          requireMember(me.user, ['commander', 'responder'], incidentId);
          requireThat(request.headers.origin === cfg.origin && !['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']), 'Request origin rejected.', 403);
          requireThat(request.headers['content-type'] === 'application/octet-stream', 'Use a binary evidence upload.', 415);
          requireThat(!request.headers['content-length'] || Number(request.headers['content-length']) <= MAX_UPLOAD, 'Evidence file exceeds 5 MiB.', 413);
          const state = data.incidents[incidentId], item = evidenceById(state, evidenceId);
          requireThat(!item.archived, 'Evidence record is archived.');
          let filename; try { filename = decodeURIComponent(request.headers['x-aegis-file-name'] || ''); } catch { requireThat(false, 'Invalid filename.'); }
          filename = text(filename, 'Filename', { required: true, max: 200 });
          requireThat(!/[\\/:\u0000-\u001f]/.test(filename) && !filename.startsWith('.'), 'Use a filename without paths or control characters.');
          const ext = extname(filename).toLowerCase();
          requireThat(['.txt', '.log', '.csv', '.json', '.pdf', '.png', '.jpg', '.jpeg', '.pcap', '.pcapng', '.bin', '.zip'].includes(ext), 'Unsupported original type. Use a forensic .bin container for other source formats.', 415);
          const submission = request.headers['x-submission-id']; requireThat(typeof submission === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(submission), 'A submission ID is required.');
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; requireThat(size <= MAX_UPLOAD, 'Evidence file exceeds 5 MiB.', 413); chunks.push(chunk); }
          const original = Buffer.concat(chunks); const requestHash = sha256(Buffer.concat([Buffer.from(evidenceId + ':' + filename + ':'), original])); const receiptKey = 'upload:' + me.user.id + ':' + submission;
          if (state.receipts[receiptKey]) { requireThat(state.receipts[receiptKey] === requestHash, 'Upload submission ID was reused for different bytes.', 409); return { json: visible(data, me.user, incidentId) }; }
          requireThat(item.attachments.length < 20, 'Evidence record has reached its attachment limit.');
          const starts = magic => original.subarray(0, magic.length).equals(Buffer.from(magic));
          if (ext === '.pdf') requireThat(starts('%PDF-'), 'File signature does not match PDF.', 415);
          if (ext === '.png') requireThat(starts([137, 80, 78, 71, 13, 10, 26, 10]), 'File signature does not match PNG.', 415);
          if (['.jpg', '.jpeg'].includes(ext)) requireThat(starts([255, 216, 255]), 'File signature does not match JPEG.', 415);
          if (ext === '.zip') requireThat(starts('PK'), 'File signature does not match ZIP.', 415);
          if (['.txt', '.log', '.csv', '.json'].includes(ext)) { try { new TextDecoder('utf-8', { fatal: true }).decode(original); } catch { requireThat(false, 'Text originals must be valid UTF-8.', 415); } requireThat(!original.includes(0), 'Text original contains binary NUL bytes.', 415); }
          const attachment = { ...blobs.put(original, incidentId, evidenceId), filename, status: 'Quarantined', uploadedBy: me.user.id, uploadedByName: me.user.name, uploadedAt: new Date().toISOString(), revision: 1, history: [], screening: 'No automatic malware scan. Original is never parsed, unpacked or previewed.' };
          item.attachments.push(attachment); custody(item, me.user, 'Original received in quarantine', filename, { attachmentId: attachment.id, sha256: attachment.sha256 });
          state.receipts[receiptKey] = requestHash; state.sequence++; state.updatedAt = attachment.uploadedAt;
          state.events.unshift({ id: attachment.id, time: attachment.uploadedAt, actor: me.user.name, actorId: me.user.id, title: 'Evidence original quarantined', detail: item.reference + ' · ' + filename });
          audit(data, me.user.id, 'evidence.uploaded', { incidentId, evidenceId, attachmentId: attachment.id, sha256: attachment.sha256 }); return { json: visible(data, me.user, incidentId) };
        }
        if (downloadRoute && !body) {
          const [, incidentId, evidenceId, attachmentId] = downloadRoute; requireMember(me.user, ['commander'], incidentId); recent(me.session, cfg);
          const state = data.incidents[incidentId], item = evidenceById(state, evidenceId), attachment = item.attachments.find(a => a.id === attachmentId);
          requireThat(!item.archived && attachment?.status === 'Approved for controlled download', 'Original remains quarantined, rejected or unavailable.', 403);
          requireThat(data.users.some(u => u.id === attachment.reviewedBy && u.status === 'active' && member(u, incidentId) === 'commander'), 'Reviewing custodian access has been revoked.', 403);
          requireThat(!item.sourceDigest || item.sourceDigest === attachment.sha256, 'Source digest mismatch blocks original download.', 403);
          const bytes = blobs.get(attachment, incidentId, evidenceId);
          custody(item, me.user, 'Controlled original downloaded', attachment.reviewReason, { attachmentId, sha256: attachment.sha256 }); audit(data, me.user.id, 'evidence.downloaded', { incidentId, attachmentId });
          state.sequence++; state.updatedAt = new Date().toISOString();
          state.events.unshift({ id: randomUUID(), time: state.updatedAt, actor: me.user.name, actorId: me.user.id, title: 'Evidence original downloaded', detail: item.reference + ' · ' + attachment.filename });
          return { body: bytes, type: 'application/octet-stream', binary: true, filename: attachment.filename, sandbox: true };
        }
        if (reportRoute && !body) {
          const [, incidentId, exportId, part] = reportRoute; requireMember(me.user, ['commander'], incidentId);
          if (part !== 'preview') recent(me.session, cfg);
          const job = authorizedJob(data, data.incidents[incidentId], exportId, me.user, part === 'preview');
          audit(data, me.user.id, 'report.' + part, { incidentId, exportId });
          if (part === 'preview') return { body: reportHTML(job.snapshot, job), type: 'text/html', preview: true };
          if (part === 'manifest') return { body: JSON.stringify(exportManifest(job), null, 2), type: 'application/json', filename: job.filename + '.manifest.json', sandbox: true };
          return { body: exportBytes(job), binary: true, type: job.format === 'html' ? 'text/html' : job.format === 'csv' ? 'text/csv' : 'application/json', filename: job.filename, sandbox: true };
        }
        if (route === '/api/v1/me' && request.method === 'GET') return { json: {
          user: { ...publicUser(me.user), grants: me.user.grants, canCreate: canCreate(me.user) }, csrf: me.session.csrf,
          idleExpires: me.session.lastSeen + cfg.idleMs, absoluteExpires: me.session.created + cfg.absoluteMs,
          verifiedUntil: me.session.verified + cfg.recentMs, development: cfg.development, rehearsal: cfg.rehearsal,
          credentials: me.user.credentials.map(c => ({ id: c.id })),
        } };
        if (route === '/api/v1/incidents') {
          if (body) { recent(me.session, cfg); if (cfg.rehearsal) body.exercise = true; return { json: createIncident(data, body, me) }; }
          return { json: catalog(data, me.user) };
        }
        if (route === '/api/v1/my-tasks' && !body) return { json: { tasks: Object.values(data.incidents).filter(s => member(me.user, s.id)).flatMap(s => s.tasks.filter(t => t.ownerId === me.user.id).map(t => ({ ...t, incidentId: s.id, incidentTitle: s.title, incidentCode: s.code }))) } };
        const incidentRoute = route.match(/^\/api\/v1\/incidents\/([a-zA-Z0-9-]+)$/);
        if (route === '/api/v1/state' || incidentRoute) {
          const incidentId = incidentRoute?.[1] || INCIDENT;
          if (body) {
            if (['evidence-review', 'export-request', 'export-approve', 'export-cancel'].includes(body.kind)) recent(me.session, cfg);
            if (body.kind === 'incident' && body.commanderId && body.commanderId !== data.incidents[incidentId]?.commanderId) recent(me.session, cfg);
            mutate(data, body, me.user, incidentId);
          }
          return { json: visible(data, me.user, incidentId) };
        }
        if (route === '/api/v1/people' && request.method === 'GET') {
          const incidentId = query.get('incidentId') || INCIDENT;
          requireThat(me.user.admin || member(me.user, incidentId) === 'commander', 'Administrator or commander access required.', 403);
          requireThat(Object.hasOwn(data.incidents, incidentId), 'Incident not found.', 404);
          return { json: { users: data.users.map(u => publicUser(u, incidentId)), incidents: catalog(data, me.user).assignmentIncidents, incidentId, ...(me.user.admin ? {
            devices: data.devices, invites: data.invites.map(({ tokenHash, ...i }) => i), approvals: data.approvals, audit: data.audit.slice(-100),
          } : {}) } };
        }
        if (route === '/api/v1/security' && request.method === 'GET') {
          requireAdmin(me.user);
          return { json: { transport: cfg.development ? 'HTTP — localhost development only' : 'TLS 1.3 + mutual certificate authentication', independentIdentity: true, storage: 'AES-256-GCM encrypted vault', deviceAdmission: !cfg.development, auditSequence: data.audit.length, auditHead: data.audit.at(-1)?.hash || null, internetRequired: false } };
        }
        if (body) {
          if (route === '/api/v1/auth/logout') {
            data.sessions = data.sessions.filter(s => s.hash !== me.session.hash);
            response.setHeader('Set-Cookie', auth.cookie('', true)); audit(data, me.user.id, 'session.closed'); return { json: { ok: true } };
          }
          if (route === '/api/v1/auth/key/options') return { json: await auth.registration(data, body, request, me) };
          if (route === '/api/v1/auth/key/verify') return { json: await auth.finishRegistration(data, body, request, response, me) };
          if (route === '/api/v1/auth/key/remove') {
            recent(me.session, cfg);
            requireThat(me.user.credentials.length > 1 && me.user.credentials.some(c => c.id === body.id), 'Keep at least one registered key.');
            me.user.credentials = me.user.credentials.filter(c => c.id !== body.id); me.user.version++; revoke(data, me.user.id);
            audit(data, me.user.id, 'credential.removed', me.user.id); return { json: { ok: true } };
          }
          if (route === '/api/v1/memberships') return { json: assign(data, body, me, cfg) };
          if (route.startsWith('/api/v1/admin/')) return { json: administer(data, route, body, me, cfg) };
          if (route === '/api/v1/export') {
            requireThat(false, 'Request a report in Review and obtain a second commander approval before downloading.', 403);
          }
        }
        requireThat(false, 'Not found', 404);
      });
      response.setHeader('Content-Type', (result.type || 'application/json') + (result.binary ? '' : '; charset=utf-8'));
      if (result.filename) response.setHeader('Content-Disposition', "attachment; filename=\"aegis-download\"; filename*=UTF-8''" + encodeURIComponent(result.filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()));
      if (result.preview || result.sandbox) response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox allow-same-origin allow-downloads");
      response.end(result.body || JSON.stringify(result.json));
    } catch (error) {
      response.removeHeader('Set-Cookie');
      if (route?.startsWith('/api/') && request.device && error.status !== 429) {
        try { await store.run(data => audit(data, actorId, 'request.denied', { route, status: error.status || 400, device: request.device })); }
        catch { /* A rejected request remains rejected if audit storage fails. */ }
      }
      response.statusCode = error.status || (route?.includes('/auth/') ? 400 : 500);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: error.status ? error.message : response.statusCode === 400 ? 'Hardware key verification failed. Start again.' : 'Request failed; no change was saved.', ...(error.current ? { current: error.current } : {}), ...(error.field ? { field: error.field } : {}) }));
    }
  };
  const server = cfg.development ? httpServer(handler) : httpsServer(cfg.tls, handler);
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 40;
  return { server, store, auth, blobs, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.tail; store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const cfg = config(); const app = await createApp(cfg);
  app.server.listen(cfg.port, cfg.host, () => console.log(`Aegis Command · ${cfg.origin} · ${cfg.development ? 'LOCAL DEVELOPMENT' : 'mutual TLS required'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
