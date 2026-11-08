import { randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { requireThat, secret, digest, equal, newInvite, revoke, recent, requireAdmin, publicUser, roles, INCIDENT, member, fingerprint } from './access.mjs';
import { audit } from './store.mjs';
import { core } from './model.mjs';

export class Auth {
  constructor(cfg) { this.cfg = cfg; this.challenges = new Map(); }
  flow(values) {
    for (const [id, value] of this.challenges) if (value.expires < Date.now()) this.challenges.delete(id);
    requireThat(this.challenges.size < 1000, 'Authentication is busy; try again shortly.', 429);
    const flowId = secret(); this.challenges.set(flowId, { ...values, expires: Date.now() + 120_000 }); return flowId;
  }
  consume(body, request, type) {
    const flow = this.challenges.get(body.flowId); this.challenges.delete(body.flowId);
    requireThat(flow && flow.type === type && flow.expires > Date.now() && equal(flow.device, request.device), 'Authentication request expired. Start again.', 401);
    return flow;
  }
  cookie(token, clear = false) {
    return `${this.cfg.development ? 'aegis_dev' : '__Host-aegis'}=${token}; Path=/; HttpOnly; SameSite=Strict${this.cfg.development ? '' : '; Secure'}; Max-Age=${clear ? 0 : this.cfg.absoluteMs / 1000}`;
  }
  session(data, user, request, response) {
    const token = secret();
    const now = Date.now();
    // A bounded number of sessions per user; obsolete cookies cannot regain access.
    data.sessions = data.sessions.filter(s => now - s.created < this.cfg.absoluteMs && s.userId !== user.id);
    data.sessions.push({ hash: digest(token), csrf: secret(), userId: user.id, version: user.version, device: request.device, created: now, verified: now, lastSeen: now });
    response.setHeader('Set-Cookie', this.cookie(token));
    audit(data, user.id, 'authentication.succeeded', request.device);
    return { user: publicUser(user) };
  }
  async registration(data, body, request, me) {
    let user, invite;
    if (me) { recent(me.session, this.cfg); user = me.user; }
    else {
      requireThat(typeof body.token === 'string' && body.token.length < 200, 'Invalid or expired invitation.', 401);
      invite = data.invites.find(i => equal(i.tokenHash, digest(body.token)) && !i.used && i.expires > Date.now());
      requireThat(invite && equal(invite.device, request.device), 'Invalid invitation or unapproved device.', 401);
      user = invite.recovery ? data.users.find(u => u.id === invite.recovery) : { id: randomUUID(), username: invite.username, name: invite.name, credentials: [] };
      requireThat(user, 'Invalid invitation.', 401);
    }
    const options = await generateRegistrationOptions({
      rpName: 'Aegis Command', rpID: this.cfg.rpID,
      userID: new TextEncoder().encode(user.id), userName: user.username, userDisplayName: user.name,
      attestationType: 'none', timeout: 120_000,
      excludeCredentials: data.users.flatMap(u => u.credentials.map(c => ({ id: c.id, transports: c.transports }))),
      authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257],
    });
    const flowId = this.flow({ type: 'register', challenge: options.challenge, userId: user.id, inviteId: invite?.id, device: request.device, adding: !!me, sessionHash: me?.session.hash });
    return { flowId, options };
  }
  async finishRegistration(data, body, request, response, me) {
    const flow = this.consume(body, request, 'register');
    let user = data.users.find(u => u.id === flow.userId);
    let invite;
    if (flow.adding) {
      requireThat(me?.user.id === flow.userId && equal(me.session.hash, flow.sessionHash), 'Sign in again.', 401); recent(me.session, this.cfg);
    } else {
      invite = data.invites.find(i => i.id === flow.inviteId && !i.used && i.expires > Date.now());
      requireThat(invite && equal(invite.device, request.device), 'Invitation expired or already used.', 401);
      if (invite.recovery) requireThat(user?.status === 'invited', 'Recovery invitation is no longer valid.', 401);
      else { requireThat(!data.users.some(u => u.username === invite.username || u.name.toLowerCase() === invite.name.toLowerCase()), 'Account already enrolled.'); user = { id: flow.userId, username: invite.username, name: invite.name, admin: invite.admin, grants: invite.role ? { [invite.incidentId || INCIDENT]: invite.role } : {}, status: 'active', version: 1, credentials: [] }; }
    }
    // Only the requested privacy-preserving format is admitted. No metadata,
    // attestation certificate or certificate-revocation network lookup is needed.
    requireThat(decodeAttestationObject(Buffer.from(body.response?.response?.attestationObject || '', 'base64url')).get('fmt') === 'none', 'Use a key that supports enrollment without attestation.', 401);
    const verification = await verifyRegistrationResponse({ response: body.response, expectedChallenge: flow.challenge, expectedOrigin: this.cfg.origin, expectedRPID: this.cfg.rpID, requireUserVerification: true });
    requireThat(verification.verified, 'Hardware key verification failed.', 401);
    const info = verification.registrationInfo;
    requireThat(info.credentialDeviceType === 'singleDevice' && !info.credentialBackedUp, 'Synced credentials are disabled. Use an individual security key.', 401);
    requireThat(!data.users.some(u => u.credentials.some(c => c.id === info.credential.id)), 'This key credential is already registered.');
    user.credentials.push({ ...info.credential, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), deviceType: info.credentialDeviceType });
    if (invite) {
      invite.used = true; user.status = 'active';
      if (!invite.recovery) data.users.push(user);
      const existing = data.devices.find(d => d.fingerprint === request.device && d.userId === user.id);
      requireThat(this.cfg.development || !existing || existing.status === 'active', 'Device was revoked.', 403);
      if (existing && this.cfg.development) existing.status = 'active';
      if (!existing) data.devices.push({ fingerprint: request.device, userId: user.id, status: 'active', enrolled: Date.now() });
      for (const incident of Object.values(data.incidents)) for (const task of incident.tasks) if (user.grants[incident.id] && !task.ownerId && task.owner === user.name) task.ownerId = user.id;
    }
    audit(data, user.id, flow.adding ? 'credential.added' : 'user.enrolled', user.id);
    return this.session(data, user, request, response);
  }
  async loginOptions(data, body, request) {
    const user = data.users.find(u => u.username === body.username && u.status === 'active');
    requireThat(user && (this.cfg.development || data.devices.some(d => d.userId === user.id && d.status === 'active' && d.fingerprint === request.device)), 'Unable to sign in with this account and device.', 401);
    const options = await generateAuthenticationOptions({ rpID: this.cfg.rpID, userVerification: 'required', timeout: 120_000, allowCredentials: user.credentials.map(c => ({ id: c.id, transports: c.transports })) });
    return { options, flowId: this.flow({ type: 'login', challenge: options.challenge, userId: user.id, version: user.version, device: request.device }) };
  }
  async loginVerify(data, body, request, response) {
    const flow = this.consume(body, request, 'login');
    const user = data.users.find(u => u.id === flow.userId && u.status === 'active' && u.version === flow.version);
    const credential = user?.credentials.find(c => c.id === body.response?.id);
    requireThat(credential && (this.cfg.development || data.devices.some(d => d.userId === user.id && d.fingerprint === request.device && d.status === 'active')), 'Authentication failed.', 401);
    if (body.response.response?.userHandle) requireThat(equal(body.response.response.userHandle, Buffer.from(user.id).toString('base64url')), 'Authentication failed.', 401);
    const verification = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: flow.challenge, expectedOrigin: this.cfg.origin, expectedRPID: this.cfg.rpID, requireUserVerification: true, credential: { ...credential, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')) } });
    requireThat(verification.verified && verification.authenticationInfo.credentialDeviceType === 'singleDevice' && !verification.authenticationInfo.credentialBackedUp, 'Authentication failed.', 401);
    credential.counter = verification.authenticationInfo.newCounter;
    return this.session(data, user, request, response);
  }
}

export function administer(data, route, body, me, cfg) {
  requireAdmin(me.user); recent(me.session, cfg);
  const actorId = me.user.id;
  if (route === '/api/v1/admin/invites') return newInvite(data, body, actorId, cfg);
  if (route === '/api/v1/admin/cancel-invite') {
    const invite = data.invites.find(i => i.id === body.id && !i.used); requireThat(invite, 'Invitation not found.', 404);
    invite.used = true; audit(data, actorId, 'invitation.cancelled', invite.id); return { ok: true };
  }
  if (route === '/api/v1/admin/suspend') {
    const user = data.users.find(u => u.id === body.userId); requireThat(user && user.id !== actorId, 'Select another user.');
    requireThat(!user.admin || data.users.filter(u => u.admin && u.status === 'active').length > 1, 'Cannot suspend the last active administrator.');
    requireThat(typeof body.suspended === 'boolean', 'Choose suspend or restore.');
    requireThat(user.status !== 'invited', 'Complete or cancel recovery first.');
    user.status = body.suspended ? 'suspended' : 'active'; user.version++; revoke(data, user.id);
    audit(data, actorId, body.suspended ? 'user.suspended' : 'user.restored', user.id); return { ok: true };
  }
  if (route === '/api/v1/admin/revoke-device') {
    const fp = fingerprint(body.fingerprint);
    const devices = data.devices.filter(d => d.fingerprint === fp && d.status === 'active'); requireThat(devices.length, 'Active device not found.');
    requireThat(!devices.some(d => d.userId === actorId), 'Ask the other custodian to revoke your device.');
    for (const device of devices) device.status = 'revoked';
    data.sessions = data.sessions.filter(s => s.device !== fp);
    data.invites.filter(i => i.device === fp).forEach(i => { i.used = true; });
    audit(data, actorId, 'device.revoked', fp); return { ok: true };
  }
  if (route === '/api/v1/admin/proposals') {
    requireThat(['admin-grant', 'recovery'].includes(body.kind), 'Invalid approval type.');
    const target = data.users.find(u => u.id === body.userId); requireThat(target && target.id !== actorId, 'Select another user.');
    if (body.kind === 'admin-grant') requireThat(!target.admin && target.status === 'active', 'Select an active non-administrator.');
    const fp = cfg.development ? 'development' : body.kind === 'recovery' ? fingerprint(body.fingerprint) : null;
    if (body.kind === 'recovery') requireThat(!data.devices.some(d => d.fingerprint === fp && d.status === 'revoked'), 'Use a newly prepared device certificate.');
    const proposal = { id: randomUUID(), kind: body.kind, userId: target.id, version: target.version, fingerprint: fp, requestedBy: actorId, expires: Date.now() + 15 * 60_000, done: false };
    data.approvals.push(proposal); audit(data, actorId, 'approval.requested', proposal.id); return { proposal };
  }
  if (route === '/api/v1/admin/approve') {
    const proposal = data.approvals.find(p => p.id === body.id && !p.done && p.expires > Date.now());
    requireThat(proposal && proposal.requestedBy !== actorId, 'A different custodian must approve an active request.');
    requireThat(data.users.some(u => u.id === proposal.requestedBy && u.admin && u.status === 'active'), 'Requesting custodian no longer has access.');
    const target = data.users.find(u => u.id === proposal.userId); requireThat(target && target.version === proposal.version, 'Account changed. Create a new request.', 409);
    let result = { ok: true };
    if (proposal.kind === 'admin-grant') target.admin = true;
    else {
      result = newInvite(data, { username: target.username, name: target.name, fingerprint: proposal.fingerprint }, actorId, cfg, { recovery: target.id, ttl: 15 * 60_000 });
      target.credentials = []; target.status = 'invited';
      for (const device of data.devices.filter(d => d.userId === target.id)) device.status = 'revoked';
    }
    target.version++; revoke(data, target.id); proposal.done = true;
    audit(data, actorId, 'approval.completed.' + proposal.kind, proposal.id); return result;
  }
  requireThat(false, 'Not found', 404);
}

export function assign(data, body, me, cfg) {
  const incidentId = body.incidentId || INCIDENT;
  requireThat(Object.hasOwn(data.incidents, incidentId), 'Incident not found.', 404);
  requireThat(me.user.admin || member(me.user, incidentId) === 'commander', 'Commander or administrator access required.', 403); recent(me.session, cfg);
  const user = data.users.find(u => u.id === body.userId); requireThat(user?.status === 'active', 'Select an active user.');
  requireThat(body.role === null || roles.includes(body.role), 'Invalid incident role.');
  requireThat(data.incidents[incidentId].commanderId !== user.id || body.role === 'commander', 'Transfer incident command before removing the responsible commander.');
  if (body.role === null) delete user.grants[incidentId]; else user.grants[incidentId] = body.role;
  if (!data.incidents[incidentId].commanderId && body.role === 'commander') {
    const state = data.incidents[incidentId], previous = structuredClone(core(state)); delete previous.history;
    const now = new Date().toISOString();
    state.history.push({ revision: state.revision, value: previous, supersededAt: now, supersededBy: me.user.id, reason: 'First responsible commander appointed through explicit membership assignment.' });
    state.commanderId = user.id; state.commanderName = user.name; state.revision++; state.sequence++;
    state.updatedAt = now; state.updatedBy = me.user.id;
    state.events.unshift({ id: randomUUID(), time: now, actor: me.user.name, actorId: me.user.id, title: 'Incident commander appointed', detail: user.name });
  }
  user.version++; revoke(data, user.id); audit(data, me.user.id, 'membership.changed', { userId: user.id, incidentId, role: body.role }); return { ok: true };
}
