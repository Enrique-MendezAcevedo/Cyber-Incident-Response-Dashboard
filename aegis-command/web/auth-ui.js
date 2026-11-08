export let session;
export let accessIncident = 'IR-2026-017';
export function selectAccessIncident(id) { if (id && id !== accessIncident) { accessIncident = id; people = undefined; loadingPeople = false; } }
let people;
let health;
let lastActivity = Date.now();
let start;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const changed = () => document.dispatchEvent(new Event('aegis:access'));
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, () => { lastActivity = Date.now(); }, { passive: true });

export function lock(message = 'Sign in to continue.') {
  session = undefined; people = undefined; health = undefined;
  accessIncident = 'IR-2026-017';
  document.querySelector('.layout').hidden = true; $('auth-screen').hidden = false;
  $('auth-status').textContent = message;
  $('content').replaceChildren(); $('editor').close(); $('editor').replaceChildren();
  changed();
}
export async function api(path, body, { quiet = false, raw = false, filename, submissionId } = {}) {
  const requestUser = session?.user.id, requestCSRF = session?.csrf;
  const headers = { ...(Date.now() - lastActivity < 30_000 ? { 'X-Aegis-Active': '1' } : {}) };
  if (body !== undefined) { headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json'; if (session) headers['X-CSRF-Token'] = session.csrf; }
  if (raw) { headers['X-Aegis-File-Name'] = encodeURIComponent(filename); headers['X-Submission-ID'] = submissionId; }
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (requestUser && (session?.user.id !== requestUser || session?.csrf !== requestCSRF)) throw Object.assign(new Error('A response from the previous session was discarded.'), { status: 409, stale: true });
  if (!response.ok) {
    if (response.status === 401 && session && !quiet) lock(result.error);
    if (response.status === 403 && /Device revoked|Device not enrolled|Device certificate expired|Access revoked/.test(result.error)) lock(result.error);
    throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status, current: result.current, field: result.field });
  }
  return result;
}
export async function refresh() {
  session = await api('/api/v1/me');
  $('signed-in-user').textContent = session.user.name + ' · ' + (session.user.admin ? 'Administrator' : session.user.role || 'No incident assignment');
  $('auth-screen').hidden = true; document.querySelector('.layout').hidden = false;
  $('rehearsal-banner').hidden = !session.rehearsal;
  document.title = session.user.name + ' · Aegis Command';
  for (const button of document.querySelectorAll('.rail [data-page]')) {
    button.hidden = button.dataset.page === 'People' ? !(session.user.admin || Object.values(session.user.grants).includes('commander')) : button.dataset.page === 'System health' ? !session.user.admin : false;
  }
  changed(); start?.(); start = undefined;
}
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function credential(options, create) {
  if (!window.PublicKeyCredential) throw new Error('This browser needs WebAuthn support on a trusted HTTPS origin.');
  const publicKey = { ...options, challenge: decode(options.challenge) };
  for (const key of ['allowCredentials', 'excludeCredentials']) if (publicKey[key]) publicKey[key] = publicKey[key].map(c => ({ ...c, id: decode(c.id) }));
  if (create) publicKey.user = { ...publicKey.user, id: decode(publicKey.user.id) };
  const result = await navigator.credentials[create ? 'create' : 'get']({ publicKey });
  if (!result) throw new Error('No security key response received.');
  const json = { id: result.id, rawId: encode(result.rawId), type: result.type, clientExtensionResults: result.getClientExtensionResults(), authenticatorAttachment: result.authenticatorAttachment, response: { clientDataJSON: encode(result.response.clientDataJSON) } };
  for (const key of create ? ['attestationObject'] : ['authenticatorData', 'signature', 'userHandle']) if (result.response[key]) json.response[key] = encode(result.response[key]);
  if (create) json.response.transports = result.response.getTransports?.() || [];
  return json;
}
async function ceremony(kind, input) {
  const challenge = await api('/api/v1/auth/' + kind + '/options', input, { quiet: true });
  const response = await credential(challenge.options, kind !== 'login');
  await api('/api/v1/auth/' + kind + '/verify', { flowId: challenge.flowId, response }, { quiet: true });
  await refresh();
}
export function accountView() {
  return `<section class="panel"><p class="kicker">INDEPENDENT IDENTITY</p><h2>My access</h2><p>${esc(session.user.name)} · ${esc(session.user.username)}</p><p>${session.user.admin ? 'Platform administrator. ' : ''}${Object.keys(session.user.grants || {}).length} incident assignment(s).</p><p>Keep a second individual security key in a separate safe place.</p><div class="actions"><button class="button" data-security-action="reauth">Verify key again</button><button class="button" data-security-action="add-key">Register spare key</button></div><ul class="list">${session.credentials.map((c, i) => `<li>Security key ${i + 1} · <code>${esc(c.id.slice(0, 12))}…</code> ${session.credentials.length > 1 ? `<button class="button" data-security-action="remove-key" data-id="${esc(c.id)}">Revoke key ${i + 1}</button>` : ''}</li>`).join('')}</ul><p id="access-status" role="status"></p></section>`;
}
const roleOptions = current => ['', 'observer', 'responder', 'commander'].map(role => `<option value="${role}"${(current || '') === role ? ' selected' : ''}>${role || 'No incident access'}</option>`).join('');
export function peopleView() {
  if (!people) { loadPeople(); return '<section class="panel"><h2>People</h2><p>Loading access records…</p></section>'; }
  return `<section class="panel"><p class="kicker">ACCESS CONTROL</p><h2>People & incident assignments</h2><p>Platform administration and incident access are separate. Permission changes end the affected person’s sessions.</p><label class="form">Incident for assignments<select id="people-incident">${people.incidents.map(i => `<option value="${esc(i.id)}" ${i.id === people.incidentId ? 'selected' : ''}>${esc(i.code)} · ${esc(i.title)}</option>`).join('')}</select></label><button class="button" data-security-action="refresh-people">Refresh people</button>
  ${session.user.admin ? `<details><summary>Add an individual</summary><form id="invite-form" class="form"><label>Full name<input name="name" required maxlength="100"></label><label>Username<input name="username" required pattern="[a-z0-9][a-z0-9._-]{2,63}" autocomplete="off"></label><label>Incident access<select name="role">${roleOptions()}</select></label>${session.development ? '<p>Local development: device certificates are not checked.</p>' : '<label>Verified clean-device certificate SHA-256 fingerprint<input name="fingerprint" required maxlength="95" placeholder="64 hex digits, with optional colons"></label>'}<label class="check"><input type="checkbox" required> I verified this person’s identity and prepared device through a trusted channel.</label><button class="button primary" type="submit">Create single-use invitation</button></form></details>` : ''}
  <ul class="list">${people.users.map(user => `<li><h3>${esc(user.name)}</h3><p>${esc(user.username)} · ${esc(user.status)}${user.admin ? ' · Platform administrator' : ''} · ${user.keyCount} key(s)</p><form class="form grant-form" data-id="${esc(user.id)}"><label>Incident assignment<select name="role">${roleOptions(user.role)}</select></label><button class="button" type="submit">Save assignment</button></form>${session.user.admin && user.id !== session.user.id ? `<div class="actions"><button class="button" data-security-action="suspend" data-id="${esc(user.id)}" data-suspended="${user.status !== 'suspended'}">${user.status === 'suspended' ? 'Restore access' : 'Suspend access'}</button>${!user.admin ? `<button class="button" data-security-action="admin-grant" data-id="${esc(user.id)}">Request administrator grant</button>` : ''}<button class="button" data-security-action="recovery" data-id="${esc(user.id)}">Request account recovery</button></div>` : ''}</li>`).join('')}</ul>
  ${session.user.admin ? `<h3>Pending custodian approvals</h3><ul class="list">${people.approvals.filter(p => !p.done && p.expires > Date.now()).map(p => `<li>${esc(p.kind)} · ${esc(people.users.find(u => u.id === p.userId)?.name)} · requested by ${esc(people.users.find(u => u.id === p.requestedBy)?.name)} ${p.requestedBy !== session.user.id ? `<button class="button" data-security-action="approve" data-id="${esc(p.id)}">Approve as second custodian</button>` : '· awaiting another custodian'}</li>`).join('') || '<li>No pending requests.</li>'}</ul><h3>Device access</h3><ul class="list">${people.devices.map(d => `<li>${esc(people.users.find(u => u.id === d.userId)?.name)} · ${esc(d.status)}<code class="fingerprint">${esc(d.fingerprint)}</code>${d.status === 'active' && d.userId !== session.user.id && !session.development ? `<button class="button" data-security-action="revoke-device" data-id="${esc(d.fingerprint)}">Revoke device</button>` : ''}</li>`).join('')}</ul><h3>Invitations</h3><ul class="list">${people.invites.filter(i => !i.used && i.expires > Date.now()).map(i => `<li>${esc(i.name)} · expires ${esc(new Date(i.expires).toISOString())} <button class="button" data-security-action="cancel-invite" data-id="${esc(i.id)}">Cancel invitation</button></li>`).join('') || '<li>No active invitations.</li>'}</ul><details><summary>Recent security audit</summary><ul class="list">${people.audit.slice().reverse().map(a => `<li>#${a.sequence} · ${esc(a.time)} · ${esc(a.action)} · ${esc(people.users.find(u => u.id === a.actorId)?.name || a.actorId || 'Unauthenticated request')}</li>`).join('')}</ul></details>` : ''}<p id="access-status" role="status"></p></section>`;
}
let loadingPeople = false;
export async function loadPeople() {
  if (loadingPeople) return;
  loadingPeople = true;
  const requested = accessIncident;
  try { const next = await api('/api/v1/people?incidentId=' + encodeURIComponent(requested)); if (requested === accessIncident) { people = next; changed(); } }
  catch (e) { $('notice').textContent = e.message; }
  finally { loadingPeople = false; }
}
export function healthView() {
  if (!health) { api('/api/v1/security').then(value => { health = value; changed(); }).catch(e => { $('notice').textContent = e.message; }); return '<p>Checking security configuration…</p>'; }
  return `<section class="panel"><p class="kicker">ENCLAVE SECURITY</p><h2>System health</h2><dl>${Object.entries(health).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl><p>These are configuration indicators. Verify physical isolation, trusted devices and backup readiness using the deployment runbook.</p><button class="button" data-security-action="refresh-health">Refresh health</button></section>`;
}
async function showInvitation(value) {
  await loadPeople();
  const dialog = $('editor');
  dialog.innerHTML = `<h2 id="editor-title">Single-use invitation</h2><p>Deliver this code in person or through a separate trusted channel. It is shown once and expires at ${esc(new Date(value.expires).toISOString())}.</p><label class="form">Invitation code<input readonly id="invitation-code" autocomplete="off" value="${esc(value.token)}"></label><button class="button" data-security-action="close-invite">Done</button>`;
  dialog.showModal();
}
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['login-form', 'enroll-form', 'invite-form'].includes(form.id) && !form.matches('.grant-form')) return;
  event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
  const input = Object.fromEntries(new FormData(form));
  try {
    $('auth-error').textContent = '';
    if (form.id === 'login-form' || form.id === 'enroll-form') { await ceremony(form.id === 'login-form' ? 'login' : 'enroll', input); form.reset(); if (!start) changed(); }
    else if (form.id === 'invite-form') { input.role ||= null; input.incidentId = accessIncident; await showInvitation(await api('/api/v1/admin/invites', input)); form.reset(); }
    else { await api('/api/v1/memberships', { userId: form.dataset.id, role: input.role || null, incidentId: accessIncident }); await loadPeople(); }
  } catch (e) { if (form.id === 'login-form' || form.id === 'enroll-form') $('auth-error').textContent = e.name === 'NotAllowedError' ? 'Security key operation cancelled or timed out. Try again.' : e.message; else $('notice').textContent = e.message; }
  finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-security-action]'); if (!button) return;
  const kind = button.dataset.securityAction, id = button.dataset.id;
  button.disabled = true;
  try {
    if (kind === 'logout') { await api('/api/v1/auth/logout', {}); location.reload(); return; }
    if (kind === 'reauth') { await ceremony('login', { username: session.user.username }); if ($('edit-error')) $('edit-error').textContent = 'Key verified. Retry the same save; your draft is preserved.'; }
    if (kind === 'add-key') await ceremony('key', {});
    if (kind === 'remove-key') { if (!confirm('Revoke this key and end your sessions?')) return; await api('/api/v1/auth/key/remove', { id }); lock('Key revoked. Sign in with a remaining key.'); return; }
    if (kind === 'close-invite') { $('editor').close(); $('editor').replaceChildren(); return; }
    if (kind === 'refresh-health') { health = undefined; changed(); return; }
    if (kind === 'refresh-people') { await loadPeople(); return; }
    if (kind === 'suspend') await api('/api/v1/admin/suspend', { userId: id, suspended: button.dataset.suspended === 'true' });
    if (kind === 'revoke-device') { if (!confirm('Revoke this device certificate and end its sessions?')) return; await api('/api/v1/admin/revoke-device', { fingerprint: id }); }
    if (kind === 'cancel-invite') await api('/api/v1/admin/cancel-invite', { id });
    if (['admin-grant', 'recovery'].includes(kind)) {
      const fp = kind === 'recovery' && !session.development ? prompt('After independent identity verification, enter the SHA-256 certificate fingerprint of the newly prepared device:') : undefined;
      if (kind === 'recovery' && !session.development && !fp) return;
      await api('/api/v1/admin/proposals', { kind, userId: id, fingerprint: fp });
    }
    if (kind === 'approve') { if (!confirm('Approve this access change as the second verified custodian? Recovery revokes all existing keys and devices.')) return; const result = await api('/api/v1/admin/approve', { id }); if (result.token) { await showInvitation(result); return; } }
    if (session && (session.user.admin || Object.values(session.user.grants || {}).includes('commander'))) await loadPeople();
    if ($('access-status')) $('access-status').textContent = 'Access change saved.';
  } catch (e) { $('notice').textContent = e.message; }
  finally { button.disabled = false; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'people-incident') { selectAccessIncident(event.target.value); loadPeople(); }
});
export async function boot() {
  try { await refresh(); }
  catch { lock('Sign in with your security key, or accept an administrator invitation.'); await new Promise(resolve => { start = resolve; }); }
  setInterval(async () => {
    if (!session) return;
    try {
      const next = await api('/api/v1/me'); session = next;
      const remaining = Math.min(next.idleExpires, next.absoluteExpires) - Date.now();
      $('session-warning').textContent = remaining < 120_000 ? 'Session expires soon. Open My access and verify your key again.' : '';
      document.dispatchEvent(new CustomEvent('aegis:connection', { detail: true }));
    } catch (e) {
      if (e.stale) return;
      if (e.status === 401 || e.status === 403 || Date.now() >= Math.min(session?.idleExpires || 0, session?.absoluteExpires || 0)) lock(e.message || 'Session expired while disconnected. Sign in again.');
      else document.dispatchEvent(new CustomEvent('aegis:connection', { detail: false }));
    }
  }, 4000);
}
