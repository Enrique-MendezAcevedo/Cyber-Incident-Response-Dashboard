import { randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { audit } from './store.mjs';
export const INCIDENT = 'IR-2026-017';
export const roles = ['commander', 'responder', 'observer'];
export const secret = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function requireThat(condition, message, status = 400) { if (!condition) throw Object.assign(new Error(message), { status }); }
export function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function fingerprint(value) {
  const result = String(value || '').replaceAll(':', '').toLowerCase();
  requireThat(/^[a-f0-9]{64}$/.test(result), 'A SHA-256 device certificate fingerprint is required.'); return result;
}
export function identity(input) {
  requireThat(typeof input.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.username), 'Use a lowercase username of 3–64 letters, numbers, dots, underscores or hyphens.');
  requireThat(typeof input.name === 'string' && input.name.trim().length >= 2 && input.name.trim().length <= 100, 'A name of 2–100 characters is required.');
  return { username: input.username, name: input.name.trim() };
}
export function newInvite(data, input, actorId, cfg, { admin = false, recovery = null, ttl = 30 * 60_000 } = {}) {
  const person = identity(input);
  const existing = data.users.find(u => u.username === person.username);
  requireThat(recovery ? existing?.id === recovery : !existing, 'Username is unavailable.');
  requireThat(!data.users.some(u => u.id !== recovery && u.name.toLowerCase() === person.name.toLowerCase()), 'Choose a unique display name.');
  requireThat(!data.invites.some(i => i.username === person.username && i.expires > Date.now() && !i.used), 'An active invitation already exists.');
  requireThat(!data.invites.some(i => i.name.toLowerCase() === person.name.toLowerCase() && i.expires > Date.now() && !i.used), 'An active invitation already uses that display name.');
  const role = input.role || null;
  const incidentId = input.incidentId || INCIDENT;
  requireThat(!role || Object.hasOwn(data.incidents, incidentId), 'Choose an existing incident.');
  requireThat(role === null || roles.includes(role), 'Invalid incident role.');
  const device = cfg.development ? 'development' : fingerprint(input.fingerprint);
  requireThat(cfg.development || !data.devices.some(d => d.fingerprint === device && d.status === 'revoked'), 'Use a new device certificate; this one was revoked.');
  const token = secret();
  const invite = { id: randomUUID(), ...person, tokenHash: digest(token), expires: Date.now() + ttl, admin, role, incidentId, device, recovery, used: false, createdBy: actorId };
  data.invites.push(invite); audit(data, actorId, 'invitation.created', invite.id);
  return { token, expires: invite.expires, username: invite.username };
}
export function revoke(data, userId) { data.sessions = data.sessions.filter(s => s.userId !== userId); }
export function principal(data, request, cfg) {
  const cookieName = cfg.development ? 'aegis_dev' : '__Host-aegis';
  const cookie = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  requireThat(cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie), 'Sign in to continue.', 401);
  const session = data.sessions.find(s => equal(s.hash, digest(cookie)));
  const now = Date.now();
  requireThat(session && now - session.lastSeen < cfg.idleMs && now - session.created < cfg.absoluteMs, 'Session expired. Sign in again.', 401);
  const user = data.users.find(u => u.id === session.userId);
  requireThat(user?.status === 'active' && session.version === user.version, 'Access revoked. Sign in again.', 401);
  requireThat(equal(session.device, request.device), 'This session belongs to another device.', 401);
  if (request.method === 'POST' || request.headers['x-aegis-active'] === '1') session.lastSeen = now;
  return { user, session };
}
export function member(user, incidentId = INCIDENT) { return user.grants?.[incidentId] || null; }
export function requireMember(user, allowed = roles, incidentId = INCIDENT) { requireThat(allowed.includes(member(user, incidentId)), 'This incident is not assigned to you.', 403); }
export function requireAdmin(user) { requireThat(user.admin, 'Platform administrator access required.', 403); }
export function recent(session, cfg) { requireThat(Date.now() - session.verified < cfg.recentMs, 'Verify your hardware key again before this action.', 428); }
export function publicUser(user, incidentId = INCIDENT) { return { id: user.id, name: user.name, username: user.username, admin: user.admin, status: user.status, role: member(user, incidentId), keyCount: user.credentials.length }; }
