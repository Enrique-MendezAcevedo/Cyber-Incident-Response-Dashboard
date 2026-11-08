import { session, api, boot, lock, refresh, peopleView, healthView, accountView, loadPeople, selectAccessIncident } from './auth-ui.js';
import { esc, editorForm, formPayload, impacts } from './forms.js';
import { evidenceView, lessonsView, reportsView } from './review-ui.js';
const $ = id => document.getElementById(id);
const views = ['Overview', 'Record', 'Timeline', 'Scope', 'Tasks', 'Communications', 'Evidence', 'Review'];
let state, selected, draft, page = 'Incidents', online = false, lastSync, focus = false, personal = false;
let directory = { incidents: [], assignmentIncidents: [], commanders: [], canCreate: false };
let allTasks = [];
let stamp = '', catalogStamp = '', lastCatalog = 0, scopeSearch = '', scopeFilter = 'Active', messageRequest;
const write = () => state && state.phase !== 'Closed' && ['commander', 'responder'].includes(state.role);
const command = () => state?.role === 'commander';
const time = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Unknown';
const chip = (value, theme = '') => `<span class="chip ${theme}">${esc(value)}</span>`;
const panel = (title, body, kicker = '') => `<section class="panel">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h2>${esc(title)}</h2>${body}</section>`;
const button = (label, action, id = '', theme = '') => `<button type="button" class="button ${theme}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const notice = text => { $('notice').textContent = text; };
const value = v => v === null || v === undefined || v === '' ? 'Unknown' : Array.isArray(v) ? v.join(' · ') || 'Unknown' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
function history(row) {
  return row.history?.length ? `<details><summary>Revision history (${row.history.length})</summary><ul class="list">${row.history.slice().reverse().map(h => `<li><strong>Revision ${h.revision}</strong> · ${esc(time(h.supersededAt))} · ${esc(state?.members.find(m => m.id === h.supersededBy)?.name || h.supersededBy || 'Legacy author unknown')}<p>${esc(h.reason)}</p><pre>${esc(JSON.stringify(h.value, null, 2))}</pre></li>`).join('')}</ul></details>` : '<p class="small muted">No superseded revisions.</p>';
}
function detailList(record, fields) { return `<dl class="record-grid">${fields.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd class="preserve">${esc(value(record[key]))}</dd></div>`).join('')}</dl>`; }
function incidentList() {
  return panel('Incident command center', `<p>Create a shared record or open an incident assigned to you. Restricted incidents remain outside your workspace.</p><div class="actions">${directory.canCreate ? button('Create incident', 'create', '', 'primary') : ''}${button('Refresh incidents', 'refresh-list')}</div>
    <ul class="list">${directory.incidents.map(i => `<li class="entry"><div><h3>${esc(i.title)}</h3><p>${esc(i.code)} · ${esc(i.commanderName)} · ${esc(i.role)}</p><p>${chip(i.severity, i.severity === 'Critical' ? 'red' : 'amber')} ${chip(i.phase)} ${i.exercise ? chip('Synthetic exercise') : ''}</p><p class="small muted">Updated ${esc(time(i.updatedAt))}</p></div>${button('Open incident', 'open', i.id)}</li>`).join('') || '<li>No incidents are assigned to you. An administrator or commander can assign access in People.</li>'}</ul>`, 'RESPONSE WORKSPACE');
}
function timeline(limit) {
  return `<ul class="list">${state.events.slice(0, limit).map(e => `<li><div class="entry"><h3>${esc(e.title)}</h3><span class="small">Recorded ${esc(time(e.time))}</span></div><p class="preserve">${esc(e.detail)}</p><p class="small muted">${esc(e.actor)}${e.occurredAt ? ' · Event time ' + esc(time(e.occurredAt)) : ''}</p>${e.prior ? `<details><summary>Previous assessment / state</summary><pre>${esc(JSON.stringify(e.prior, null, 2))}</pre></details>` : ''}</li>`).join('')}</ul>`;
}
function taskList(short = false) {
  const rows = state.tasks.filter(t => (!short || !t.done) && (!personal || t.ownerId === session.user.id));
  return `<ul class="list">${rows.map(t => `<li><div class="entry"><h3>${esc(t.title)}</h3>${chip(t.status, t.status === 'Complete' ? 'green' : t.status === 'Blocked' ? 'amber' : '')}</div><p class="small">${esc(t.owner || 'Unassigned')} · ${esc(t.priority)} · Due ${esc(time(t.dueAt))}${t.dueAt && !t.done && Date.parse(t.dueAt) < Date.now() ? ' · OVERDUE' : ''}</p><p class="preserve">${esc(t.description)}</p>${t.scopeId ? `<p class="small">Scope: ${esc(state.scope.find(s => s.id === t.scopeId)?.name || t.scopeId)}</p>` : ''}${t.completionEvidence ? `<p>Completed action: ${esc(t.completionEvidence)}</p>` : ''}${(write() || t.lessonId && state.role !== 'observer') && !t.systemKind && (command() || t.ownerId === session.user.id) ? button('Update task', 'task-update', t.id) : ''}${!short ? history(t) : ''}</li>`).join('') || '<li>No matching tasks.</li>'}</ul>`;
}
function findings() {
  return `<div class="actions">${write() ? button('Record finding or action', 'finding-create') : ''}</div><ul class="list">${state.findings.map(f => `<li>${chip(f.type, f.type === 'Hypothesis' ? 'amber' : '')} ${chip(f.status)}<h3>${esc(f.title)}</h3><p class="preserve">${esc(f.body)}</p><p class="small muted">${esc(f.owner)} · ${esc(f.source)} · Event ${esc(time(f.occurredAt))} · Recorded ${esc(time(f.recordedAt))}${f.reviewAt ? ' · Review ' + esc(time(f.reviewAt)) : ''}</p><p class="small">Supporting: ${esc(f.evidenceRefs.join(' · ') || 'None recorded')}<br>Contradicting: ${esc(f.contradictingRefs.join(' · ') || 'None recorded')}</p>${write() ? button('Correct finding', 'finding-update', f.id) : ''}${history(f)}</li>`).join('') || '<li>No findings recorded. Add observations, facts, hypotheses, indicators or response actions.</li>'}</ul>`;
}
function decisions(short = false) {
  return `<div class="actions">${write() && command() ? button('Record decision', 'decision-create') : ''}</div><ul class="list">${state.decisions.filter(d => !short || d.status === 'Pending').map(d => `<li><div class="entry"><h3>${esc(d.title)}</h3>${chip(d.status)}</div><p class="preserve">${esc(d.rationale)}</p><p class="small">Alternatives: ${esc(d.alternatives)}</p><p class="small muted">${esc(d.decisionMaker)} · Review ${esc(time(d.reviewAt))}</p>${d.supersededBy ? `<p>Replaced by: ${esc(state.decisions.find(x => x.id === d.supersededBy)?.title)}</p>` : ''}${write() && command() ? button('Update decision', 'decision-update', d.id) : ''}${!short ? history(d) : ''}</li>`).join('') || '<li>No pending decisions.</li>'}</ul>`;
}
function overview() {
  const a = state.aggregates;
  return `<div class="grid"><div class="stack">${panel('Current assessment', `<p class="lead preserve">${esc(state.summary)}</p><p>Business impact: ${esc(state.businessImpact || 'Unknown — assessment pending')}</p><div class="metrics"><div class="metric"><strong>${a.total}</strong><span>Active scope items</span></div><div class="metric"><strong>${a.suspectedExposure}</strong><span>Suspected exposure items</span></div><div class="metric"><strong>${a.confirmedExposure}</strong><span>Confirmed exposure items</span></div></div><p class="small muted">${esc(a.note)}</p><div class="actions">${write() ? button('Edit incident', 'incident') : ''}${command() ? button(state.phase === 'Closed' ? 'Reopen incident' : 'Change phase', 'transition') : ''}</div>`, 'SITUATION')}${panel('Facts & open questions', findings(), 'CONFIDENCE LEDGER')}${focus ? '' : panel('Latest activity', timeline(4))}</div><div class="stack">${panel('Next actions', taskList(true) + `<div class="actions">${write() ? button('Assign task', 'task-create') : ''}</div>`)}${panel('Pending decisions', decisions(true))}${focus ? communications() : panel('Shift handover', '<p>Review current facts, scope, unresolved work and decisions before publishing.</p>' + button('Open shift review', 'review-view'))}</div></div>`;
}
function recordView() {
  return panel('Incident record', `${write() ? button('Edit incident', 'incident') : ''}${detailList(state, [['category', 'Category'], ['source', 'Detection/report source'], ['severityRationale', 'Severity rationale'], ['discoveredAt', 'Discovery time with original offset'], ['reportedAt', 'Reported time with original offset'], ['sourceTimezone', 'Source clock timezone'], ['clockNote', 'Clock uncertainty'], ['businessImpact', 'Business impact'], ['affectedServices', 'Affected services'], ['nextReviewAt', 'Next review'], ['unknowns', 'Unknown fields'], ['unknownReason', 'Reason / follow-up']])}${history(state)}`) + panel('Findings, indicators & actions', findings()) + panel('Decisions & rationale', decisions());
}
function scopeView() {
  const a = state.aggregates;
  const rows = state.scope.filter(s => (scopeFilter === 'Archived' ? s.archived : !s.archived) && (scopeFilter !== 'Confirmed exposure' || s.exposure === 'Confirmed exposure') && (scopeFilter !== 'Unknown quantity' || s.quantityLower === null) && (!scopeSearch || [s.name, s.assetIdentifier, s.owner, s.dataCategory].join(' ').toLowerCase().includes(scopeSearch.toLowerCase())));
  return panel('Scope register', `<p>Document affected data and assets. Each assessment retains its author, event time, server receipt time and previous revisions.</p><div class="actions">${write() ? button('Add asset or dataset', 'scope-create', '', 'primary') : ''}</div><div class="fields filters"><label>Search scope<input id="scope-search" value="${esc(scopeSearch)}" placeholder="Name, identifier, owner or category"></label><label>Show<select id="scope-filter">${['Active', 'Confirmed exposure', 'Unknown quantity', 'Archived'].map(f => `<option ${f === scopeFilter ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div><p class="small muted">${a.total} active scope items · ${a.unknownQuantity} with unknown quantity · ${a.unknownExposure} with unknown exposure. ${esc(a.note)}</p>${a.overlaps.length ? `<p class="error">Potential overlapping datasets: ${a.overlaps.map(g => esc(g.name) + ' (' + g.count + ' items)').join(' · ')}</p>` : ''}<div class="scope-cards">${rows.map(s => `<article class="scope-item"><div class="entry"><div><h3>${esc(s.name)}</h3><p>${esc(s.type)} · <code>${esc(s.assetIdentifier)}</code></p></div>${chip('Revision ' + s.revision)}</div><p>${esc(s.owner)} · ${esc(s.volume)}</p><p>${esc(s.dataCategory)} · ${esc(s.sensitivity)} · ${esc(s.environment)} · ${esc(s.geography || 'Geography unknown')}</p><dl class="impact-grid">${Object.keys(impacts).map(k => `<div><dt>${k === 'exposure' ? 'Confidentiality' : k[0].toUpperCase() + k.slice(1)}</dt><dd>${chip(s[k], ['Locked', 'Confirmed exposure', 'Confirmed'].includes(s[k]) ? 'red' : s[k] === 'Unknown' ? 'amber' : '')}</dd></div>`).join('')}</dl><p>Confidence: ${esc(s.confidence)} · Assessed ${esc(time(s.assessedAt))} · ${esc(s.assessorName || 'Legacy assessor unknown')}</p><p class="small muted">Recorded ${esc(time(s.recordedAt))} · Remediation owner ${esc(s.remediationOwnerName || state.members.find(m => m.id === s.remediationOwnerId)?.name || 'Unassigned')}</p><p class="preserve">${esc(s.reason)}</p>${s.unknownReason ? `<p>Unknown details: ${esc(s.unknownReason)}</p>` : ''}<p class="small">Evidence: ${esc(s.evidenceRefs.join(' · ') || 'None recorded')}${s.baselineRef ? '<br>Integrity baseline: ' + esc(s.baselineRef) : ''}${s.recoveryEvidence ? '<br>Recovery validation: ' + esc(s.recoveryEvidence) : ''}</p>${write() ? button('Edit assessment', 'scope', s.id) : ''}${history(s)}</article>`).join('') || '<p>No matching scope items.</p>'}</div>`, 'IMPACT ASSESSMENT');
}
function communications() {
  const writable = ['commander', 'responder'].includes(state.role);
  return panel('General', `<ul class="list messages" id="messages" tabindex="0" aria-label="General channel messages">${state.messages.map((m, index) => `<li><div class="entry"><h3>${esc(m.author)}</h3><span>${esc(time(m.time))}</span></div>${m.critical ? chip('Critical instruction', 'amber') : ''}<p class="preserve">${esc(m.body)}</p>${m.critical ? `<p class="small">Acknowledged by ${esc(m.acks.join(', ') || 'nobody yet')}</p>${writable && !(m.ackIds || []).includes(session.user.id) ? button('Acknowledge', 'ack', m.id || String(index)) : ''}` : ''}</li>`).join('')}</ul>${writable ? `<form id="compose" class="form"><label for="message">Incident update<textarea id="message" name="body" maxlength="12000" required></textarea></label>${command() ? '<label class="check"><input name="critical" type="checkbox"> Require explicit acknowledgment</label>' : ''}<div class="actions"><button type="submit" class="button primary">Send update</button><span id="send-status" role="status"></span></div></form>` : ''}`, 'INCIDENT CHANNEL');
}
function reviewView() {
  const cp = state.checkpoint;
  return panel('Lifecycle & review', `<p>Current phase: ${chip(state.phase)}</p>${command() ? button(state.phase === 'Closed' ? 'Reopen incident' : 'Change phase', 'transition') : ''}${state.closure ? detailList(state.closure, [['impactSummary', 'Closure impact summary'], ['residualRisk', 'Unresolved risks / work disposition'], ['recoveryValidation', 'Recovery validation evidence'], ['closedAt', 'Closed at']]) : '<p>The commander records recovery validation, risk disposition and a review owner before closure.</p>'}${state.review ? `<h3>Post-incident review</h3><p>${esc(state.review.owner)} · Due ${esc(time(state.review.dueAt))} · ${esc(state.review.status)}</p><p class="preserve">${esc(state.review.notes)}</p>${command() || state.review.ownerId === session.user.id ? button('Update review', 'review') : ''}${history(state.review)}` : ''}`) + panel('Review & publish', `<p>Build a handover from the current incident record; review it before publication.</p><div class="actions">${command() ? button('Prepare checkpoint', 'checkpoint') : ''}</div>${cp ? `<div class="checkpoint"><h3>Published checkpoint</h3><p>${esc(cp.author)} · ${esc(time(cp.time))}</p><p class="preserve">${esc(cp.body)}</p><p>Acknowledged by ${esc(cp.acks.join(', ') || 'nobody yet')}</p>${cp.authorId !== session.user.id && state.role !== 'observer' && !cp.ackIds.includes(session.user.id) ? button('Acknowledge handover', 'handover') : ''}</div>` : ''}`);
}
function header() {
  const inIncident = state && views.includes(page);
  $('workspace-title').hidden = !!inIncident; $('workspace-title').textContent = ({ Incidents: 'Incident command center', MyTasks: 'My tasks', People: 'People & access', Account: 'My access', 'System health': 'System health' })[page] || 'Response workspace';
  document.querySelector('.incident').hidden = !inIncident; $('tabs').hidden = !inIncident;
  $('create-incident').hidden = !directory.canCreate;
  if (!inIncident) return;
  $('title').textContent = state.title; $('incident-code').textContent = state.code; $('incident-severity').textContent = state.severity; $('incident-phase').textContent = state.phase;
  $('commander-name').textContent = state.commanderName; $('declared-time').textContent = time(state.createdAt);
  $('environment-label').textContent = state.exercise ? 'SYNTHETIC EXERCISE' : 'RESPONSE ENCLAVE';
  $('environment-description').textContent = state.exercise ? 'Synthetic incident data' : 'Independent local coordination';
  for (const tab of $('tabs').querySelectorAll('button')) tab.toggleAttribute('aria-current', tab.dataset.page === page);
}
function render() {
  if (!session) return;
  header(); const content = $('content'), active = document.activeElement, activeId = active?.id;
  const oldCompose = $('compose'), body = oldCompose?.elements.body.value, critical = oldCompose?.elements.critical?.checked, scroll = $('messages')?.scrollTop, send = $('send-status')?.textContent;
  const selection = activeId === 'message' || activeId === 'scope-search' ? [active.selectionStart, active.selectionEnd] : null;
  const pages = { Incidents: incidentList, People: peopleView, 'System health': healthView, Account: accountView, MyTasks: () => panel('My tasks', '<p>Assigned work across incidents you can currently access.</p><ul class="list">' + allTasks.map(t => `<li><h3>${esc(t.title)}</h3><p>${esc(t.incidentCode)} · ${esc(t.incidentTitle)} · ${esc(t.status)} · Due ${esc(time(t.dueAt))}</p>${button('Open incident tasks', 'open-task', t.incidentId)}</li>`).join('') + '</ul>') };
  if (pages[page]) content.innerHTML = pages[page]();
  else if (!state) content.innerHTML = '<p>Loading incident…</p>';
  else content.innerHTML = ({ Overview: overview, Record: recordView, Timeline: () => panel('Timeline', timeline()), Scope: scopeView, Tasks: () => panel(personal ? 'My tasks in this incident' : 'Incident tasks', `<div class="actions">${write() ? button('Assign task', 'task-create') : ''}</div>` + taskList()), Communications: communications, Evidence: () => evidenceView(state, history), Review: () => reviewView() + lessonsView(state, history) + reportsView(state) })[page]();
  const newCompose = $('compose');
  if (oldCompose && newCompose) { newCompose.elements.body.value = body; if (newCompose.elements.critical) newCompose.elements.critical.checked = critical; $('messages').scrollTop = scroll; $('send-status').textContent = send; }
  if (activeId && $(activeId) && selection) { $(activeId).focus(); $(activeId).setSelectionRange(...selection); }
  document.querySelectorAll('.rail [data-page]').forEach(b => b.classList.toggle('rail-active', b.dataset.page === page || (b.dataset.page === 'Incidents' && views.includes(page) && !personal) || (b.dataset.page === 'Tasks' && personal)));
  connection();
}
function connection() {
  $('connection').textContent = online ? 'Live on local server' : 'Disconnected'; $('connection').classList.toggle('offline', !online);
  $('sync').textContent = lastSync ? 'Last synced · ' + time(lastSync) : 'Awaiting first sync';
}
function ingest(next) {
  if (next.id !== selected || !session) return;
  const { serverTime, ...records } = next; lastSync = serverTime; online = true;
  const nextStamp = JSON.stringify(records);
  if (nextStamp !== stamp) { state = records; stamp = nextStamp; render(); } else connection();
}
async function listIncidents() {
  const next = await api('/api/v1/incidents'); lastCatalog = Date.now();
  const nextStamp = JSON.stringify(next); directory = next;
  if (catalogStamp !== nextStamp) { catalogStamp = nextStamp; if (page === 'Incidents') render(); }
}
function unsent() { return !!$('message')?.value.trim(); }
function navigate(next, mine = false) {
  if (unsent() && next !== page && !confirm('Leave this view with an unsent message?')) return;
  if (views.includes(next) && !state) {
    if (directory.incidents.length) { openIncident(directory.incidents[0].id, next, mine); return; }
    next = 'Incidents';
  }
  page = next; personal = mine;
  if (next === 'MyTasks') api('/api/v1/my-tasks').then(v => { allTasks = v.tasks; if (page === 'MyTasks') render(); }).catch(e => notice(e.message));
  if (next === 'People') {
    const allowed = directory.assignmentIncidents;
    selectAccessIncident(allowed.find(i => i.id === selected)?.id || allowed[0]?.id); loadPeople();
  }
  notice(''); render();
}
async function openIncident(id, next = 'Overview', mine = false) {
  if (unsent() && !confirm('Open another incident and discard the unsent message?')) return;
  state = undefined; stamp = ''; selected = id; page = next; personal = mine; scopeSearch = ''; scopeFilter = 'Active'; messageRequest = undefined;
  selectAccessIncident(id); render();
  try { ingest(await api('/api/v1/incidents/' + encodeURIComponent(id))); } catch (e) { selected = undefined; page = 'Incidents'; render(); notice(e.message); }
}
async function poll() {
  try {
    if (!session) return;
    if (page === 'Incidents' || Date.now() - lastCatalog > 10_000) await listIncidents();
    if (page === 'MyTasks') {
      const mine = await api('/api/v1/my-tasks');
      if (JSON.stringify(mine.tasks) !== JSON.stringify(allTasks)) { allTasks = mine.tasks; render(); }
    }
    if (selected) ingest(await api('/api/v1/incidents/' + encodeURIComponent(selected)));
    else { online = true; connection(); }
  } catch (e) { online = false; connection(); if (e.status === 403 && selected) { state = undefined; selected = undefined; page = 'Incidents'; render(); notice('Incident access changed.'); } }
  finally { setTimeout(poll, 1500); }
}
function openEditor(kind, id, replacement) {
  const collections = { scope: 'scope', 'task-update': 'tasks', 'finding-update': 'findings', 'decision-update': 'decisions', 'evidence-update': 'evidenceRegister', 'evidence-custody': 'evidenceRegister', 'evidence-review': 'evidenceRegister', 'lesson-update': 'lessons', 'export-approve': 'exports', 'export-cancel': 'exports' };
  const row = replacement || (kind === 'incident' ? state : kind === 'review' ? state.review : collections[kind] ? state[collections[kind]].find(r => r.id === id) : null);
  draft = { kind, entityId: row?.id, revision: row?.revision ?? state?.revision, incidentId: selected, requestId: crypto.randomUUID() };
  $('editor').innerHTML = editorForm(kind, row, state, session.user, directory);
  if (kind === 'incident' && !command()) { $('edit-form').elements.severity.disabled = true; $('edit-form').elements.severityRationale.readOnly = true; $('edit-form').elements.commanderId.disabled = true; }
  if (kind === 'task-update' && !command()) $('edit-form').elements.ownerId.disabled = true;
  if (kind === 'review' && !command()) { $('edit-form').elements.ownerId.disabled = true; $('edit-form').elements.dueAt.readOnly = true; }
  closureFields(); if (!$('editor').open) $('editor').showModal();
}
function closureFields() { const fieldset = $('closure-fields'); if (fieldset) { fieldset.hidden = $('edit-form').elements.phase.value !== 'Closed'; fieldset.disabled = fieldset.hidden; } }
function conflict(error, payload) {
  if (!error.current) return;
  draft.current = error.current;
  const fields = Object.keys(payload).filter(k => Object.hasOwn(error.current, k) && value(payload[k]) !== value(error.current[k]));
  $('conflict-details').innerHTML = '<h3>Your draft is preserved</h3><p>Compare the current saved values before replacing or reapplying your changes.</p><div class="table-wrap"><table><thead><tr><th>Field</th><th>Your draft</th><th>Current saved value</th></tr></thead><tbody>' + fields.map(k => `<tr><th>${esc(k)}</th><td class="preserve">${esc(value(payload[k]))}</td><td class="preserve">${esc(value(error.current[k]))}</td></tr>`).join('') + '</tbody></table></div>' + button('Load current version', 'load-current');
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.dataset.page) return navigate(b.dataset.page, b.dataset.page === 'Tasks' && !!b.closest('.rail'));
  const kind = b.dataset.action, id = b.dataset.id;
  if (!kind) return;
  if (kind === 'cancel') { if (draft?.saving) return; $('editor').close(); $('editor').replaceChildren(); draft = undefined; return; }
  if (kind === 'open') return openIncident(id);
  if (kind === 'open-task') return openIncident(id, 'Tasks', true);
  if (kind === 'create') return openEditor('create');
  if (kind === 'load-current') { if (confirm('Replace your unsaved draft with the current saved version?')) openEditor(draft.kind, draft.entityId, draft.current); return; }
  if (kind === 'refresh-list') { try { await listIncidents(); render(); } catch (e) { notice(e.message); } return; }
  if (kind === 'focus') { if (unsent() && !confirm('Change Focus view with an unsent message?')) return; focus = !focus; document.body.classList.toggle('focus-mode', focus); b.textContent = focus ? 'Exit focus view' : 'Focus view'; b.setAttribute('aria-pressed', focus); render(); return; }
  if (!state) return;
  if (kind === 'review-view') return navigate('Review');
  if (['incident', 'transition', 'scope-create', 'scope', 'task-create', 'task-update', 'finding-create', 'finding-update', 'decision-create', 'decision-update', 'review', 'checkpoint', 'evidence-create', 'evidence-update', 'evidence-custody', 'evidence-review', 'lesson-create', 'lesson-update', 'export-request', 'export-approve', 'export-cancel'].includes(kind)) return openEditor(kind, id);
  b.disabled = true;
  try {
    if (kind === 'export') {
      const record = await api('/api/v1/export', { incidentId: selected }); const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = state.code + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice('Incident record downloaded.'); return;
    }
    const payload = kind === 'handover' ? { checkpointTime: state.checkpoint.time } : state.messages.some(m => m.id === id) ? { entityId: id } : { index: Number(id) };
    ingest(await api('/api/v1/incidents/' + selected, { kind, id: crypto.randomUUID(), ...payload })); notice('Acknowledgment saved.');
  } catch (e) { notice(e.message); } finally { b.disabled = false; }
});
document.addEventListener('input', event => { if (event.target.id === 'scope-search') { scopeSearch = event.target.value; render(); } });
document.addEventListener('change', event => { if (event.target.id === 'scope-filter') { scopeFilter = event.target.value; render(); } if (event.target.name === 'phase') closureFields(); });
let sending = false;
document.addEventListener('submit', async event => {
  const form = event.target; if (!['edit-form', 'compose'].includes(form.id)) return; event.preventDefault();
  if (form.id === 'compose') {
    if (sending) return; sending = true; const b = form.querySelector('[type=submit]'); b.disabled = true;
    const payload = { kind: 'message', body: form.elements.body.value, critical: form.elements.critical?.checked || false };
    const signature = JSON.stringify([selected, payload]); if (messageRequest?.signature !== signature) messageRequest = { signature, id: crypto.randomUUID() };
    const target = selected; $('send-status').textContent = 'Pending · waiting for server';
    try { const next = await api('/api/v1/incidents/' + target, { ...payload, id: messageRequest.id }); ingest(next); if ($('compose')?.elements.body.value === payload.body) { $('compose').reset(); $('send-status').textContent = 'Sent · saved on server'; } messageRequest = undefined; }
    catch (e) { if ($('send-status')) $('send-status').textContent = e.status ? e.message : 'Delivery uncertain. Retry this same draft to avoid a duplicate.'; }
    finally { sending = false; b.disabled = false; } return;
  }
  if (draft.saving) return; draft.saving = true;
  const b = form.querySelector('[type=submit]'), cancel = form.querySelector('[data-action=cancel]'); b.disabled = cancel.disabled = true;
  const errorBox = $('edit-error'); errorBox.textContent = 'Saving…'; errorBox.tabIndex = -1;
  const fields = formPayload(form), signature = JSON.stringify(fields);
  if (draft.signature !== signature) { draft.signature = signature; draft.requestId = crypto.randomUUID(); }
  try {
    if (draft.kind === 'create') {
      const result = await api('/api/v1/incidents', { ...fields, id: draft.requestId }); $('editor').close(); await refresh(); await listIncidents();
      if (result.assignedToYou) await openIncident(result.id); else navigate('Incidents');
    } else {
      const target = draft.incidentId;
      const next = await api('/api/v1/incidents/' + target, { ...fields, kind: draft.kind, id: draft.requestId, entityId: draft.entityId, revision: draft.revision });
      $('editor').close(); ingest(next); await listIncidents();
    }
    $('editor').replaceChildren(); draft = undefined; notice('Saved on the local server.');
  } catch (e) {
    errorBox.textContent = e.status ? e.message : 'Delivery uncertain. Your draft is preserved; retry without changing it to avoid a duplicate.';
    if (e.status === 428) $('conflict-details').innerHTML = '<p>Your draft is preserved. Verify your key, then retry the same save.</p><button class="button" type="button" data-security-action="reauth">Verify key again</button>';
    else conflict(e, fields);
    errorBox.focus();
  }
  finally { if (draft) draft.saving = false; b.disabled = cancel.disabled = false; }
});
$('editor').addEventListener('cancel', event => { if (draft?.saving) event.preventDefault(); });
window.addEventListener('beforeunload', event => { if (!unsent() && !$('editor').open) return; event.preventDefault(); event.returnValue = ''; });
document.addEventListener('aegis:snapshot', event => ingest(event.detail));
document.addEventListener('aegis:connection', event => {
  $('network-warning').hidden = event.detail;
  if (!event.detail) { online = false; connection(); }
});
document.addEventListener('aegis:access', () => {
  if (!session) { state = undefined; selected = undefined; draft = undefined; messageRequest = undefined; allTasks = []; stamp = ''; catalogStamp = ''; lastCatalog = 0; lastSync = undefined; online = false; scopeSearch = ''; directory = { incidents: [], assignmentIncidents: [], commanders: [], canCreate: false }; return; }
  if (!selected && views.includes(page)) page = 'Incidents';
  render();
});
$('tabs').innerHTML = views.map(v => `<button data-page="${v}">${v}</button>`).join('');
await boot(); await listIncidents();
if (!Object.keys(session.user.grants).length && session.user.admin) navigate('People');
else if (directory.incidents.length === 1) await openIncident(directory.incidents[0].id);
else navigate('Incidents');
poll();
