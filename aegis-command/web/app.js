import { session, api, boot, lock, refresh, peopleView, healthView, accountView, loadPeople, selectAccessIncident } from './auth-ui.js';
import { esc, editorForm, formPayload, impacts } from './forms.js';
import { evidenceView, lessonsView, reportsView } from './review-ui.js';
import { icon, brief, avatar, tone, section, dueLabel } from './visuals.js';
const $ = id => document.getElementById(id);
const views = ['Overview', 'Record', 'Timeline', 'Scope', 'Tasks', 'Communications', 'Evidence', 'Review'];
let state, selected, draft, page = 'Incidents', online = false, lastSync, focus = false, personal = false;
let directory = { incidents: [], assignmentIncidents: [], commanders: [], canCreate: false };
let allTasks = [], taskFilter = 'All';
let stamp = '', urgencyStamp = '', catalogStamp = '', lastCatalog = 0, scopeSearch = '', scopeFilter = 'Active', messageRequest;
const write = () => state && state.phase !== 'Closed' && ['commander', 'responder'].includes(state.role);
const command = () => state?.role === 'commander';
const time = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Unknown';
const chip = (value, theme = '') => `<span class="chip ${theme}">${esc(value)}</span>`;
const panel = section;
const button = (label, action, id = '', theme = '') => `<button type="button" class="button ${theme}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const notice = text => { $('notice').textContent = text; };
const value = v => v === null || v === undefined || v === '' ? 'Unknown' : Array.isArray(v) ? v.join(' · ') || 'Unknown' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
const activeTask = t => !t.done && !['Complete', 'Cancelled'].includes(t.status);
const overdueTask = t => activeTask(t) && t.dueAt && Date.parse(t.dueAt) < Date.now();
const priorityRank = { Critical: 0, High: 1, Normal: 2, Low: 3 };
function orderedTasks(rows) { return [...rows].sort((a, b) => Number(activeTask(b)) - Number(activeTask(a)) || Number(!!overdueTask(b)) - Number(!!overdueTask(a)) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity)); }
function history(row) {
  return row.history?.length ? `<details><summary>Revision history (${row.history.length})</summary><ul class="list">${row.history.slice().reverse().map(h => `<li><strong>Revision ${h.revision}</strong> · ${esc(time(h.supersededAt))} · ${esc(state?.members.find(m => m.id === h.supersededBy)?.name || h.supersededBy || 'Legacy author unknown')}<p>${esc(h.reason)}</p><pre>${esc(JSON.stringify(h.value, null, 2))}</pre></li>`).join('')}</ul></details>` : '<p class="small muted">No superseded revisions.</p>';
}
function detailList(record, fields) { return `<dl class="record-grid">${fields.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd class="preserve">${esc(value(record[key]))}</dd></div>`).join('')}</dl>`; }
function incidentList() {
  return panel('Incident command center', `<div class="section-toolbar"><p class="panel-intro">Your assigned incidents. One workspace for each response.</p><div class="actions">${directory.canCreate ? button('Create incident', 'create', '', 'primary') : ''}${button('Refresh incidents', 'refresh-list')}</div></div>
    <ul class="list incident-cards">${directory.incidents.map(i => `<li><div class="entry"><span class="kicker">${esc(i.code)}</span>${chip(i.severity, tone(i.severity))}</div><h3>${esc(i.title)}</h3><p class="small muted">${esc(i.commanderName)} · ${esc(i.role)}</p><div class="entry incident-card-foot"><span>${chip(i.phase, tone(i.phase))} ${i.exercise ? chip('Synthetic exercise') : ''}</span>${button('Open incident', 'open', i.id)}</div><p class="small muted">Updated ${esc(dueLabel(i.updatedAt))}</p></li>`).join('') || '<li>No incidents are assigned to you. An administrator or commander can assign access in People.</li>'}</ul>`, 'RESPONSE WORKSPACE', 'shield');
}
function myTasksView() {
  return panel('My tasks', `<p class="panel-intro">Assigned work across incidents you can currently access.</p><ul class="list task-cards my-task-cards">${orderedTasks(allTasks).map(t => `<li class="task-card priority-${['Critical', 'High', 'Normal', 'Low'].includes(t.priority) ? t.priority.toLowerCase() : 'normal'} ${t.status === 'Complete' ? 'task-complete' : ''}"><div class="task-card-top"><span class="priority-label ${tone(t.priority)}"><span class="priority-mark" aria-hidden="true"></span>${esc(t.priority)} priority</span>${chip(t.status, tone(t.status))}</div><h3>${esc(t.title)}</h3><p class="card-excerpt">${esc(t.incidentTitle)}</p><div class="task-meta"><span class="mono">${esc(t.incidentCode)}</span><span class="deadline ${overdueTask(t) ? 'overdue' : ''}" title="${esc(time(t.dueAt))}">${icon('clock')}${overdueTask(t) ? 'Overdue · ' : ''}${esc(dueLabel(t.dueAt))}</span></div><div class="actions">${button('Open incident tasks', 'open-task', t.incidentId)}</div></li>`).join('') || '<li class="empty-state">No assigned tasks.</li>'}</ul>`, 'PERSONAL WORK QUEUE', 'task');
}
function timeline(limit) {
  return `<ol class="list activity-list">${state.events.slice(0, limit).map(e => `<li><span class="activity-dot" aria-hidden="true"></span><div><div class="entry"><h3>${esc(e.title)}</h3><span class="small muted">${esc(dueLabel(e.time))}</span></div><p class="small muted">${esc(e.actor)}</p><details class="compact-details"><summary>Activity details</summary><p class="preserve">${esc(e.detail)}</p><p class="small muted">Recorded ${esc(time(e.time))}${e.occurredAt ? ' · Event time ' + esc(time(e.occurredAt)) : ''}</p>${e.prior ? `<details><summary>Previous assessment / state</summary><pre>${esc(JSON.stringify(e.prior, null, 2))}</pre></details>` : ''}</details></div></li>`).join('')}</ol>`;
}
function taskList(short = false) {
  const matching = state.tasks.filter(t => (!short || !t.done && t.status !== 'Cancelled') && (!personal || t.ownerId === session.user.id));
  const active = activeTask, overdue = overdueTask;
  const rows = orderedTasks(matching.filter(t => short || taskFilter === 'All' || (taskFilter === 'Open' ? active(t) : taskFilter === 'Overdue' ? overdue(t) : t.status === taskFilter)));
  const completed = matching.filter(t => t.status === 'Complete').length, actionable = matching.filter(t => t.status !== 'Cancelled').length;
  const summary = !short ? `<div class="task-overview"><div><span class="kicker">WORK COMPLETED</span><p><strong>${completed}</strong><span> / ${actionable} tasks</span></p></div><progress max="${actionable || 1}" value="${completed}" aria-label="Completed tasks">${completed} of ${actionable}</progress><span class="chip ${matching.some(t => t.status === 'Blocked') ? 'amber' : ''}">${matching.filter(t => t.status === 'Blocked').length} blocked</span></div><div class="task-filters" role="group" aria-label="Filter tasks">${['All', 'Open', 'Overdue', 'Blocked', 'Complete'].map(f => `<button class="task-filter" data-action="task-filter" data-filter="${f}" aria-pressed="${taskFilter === f}">${f}<span>${matching.filter(t => f === 'All' || (f === 'Open' ? active(t) : f === 'Overdue' ? overdue(t) : t.status === f)).length}</span></button>`).join('')}</div><p class="small muted sort-note">Overdue first, then priority and deadline.</p>` : '';
  return summary + `<ul class="list task-cards ${short ? 'task-cards-compact' : ''}">${(short ? rows.slice(0, 3) : rows).map(t => `<li class="task-card priority-${['Critical', 'High', 'Normal', 'Low'].includes(t.priority) ? t.priority.toLowerCase() : 'normal'} ${t.status === 'Complete' ? 'task-complete' : ''}"><div class="task-card-top"><span class="priority-label ${tone(t.priority)}"><span class="priority-mark" aria-hidden="true"></span>${esc(t.priority)} priority</span>${chip(t.status, tone(t.status))}</div><h3>${esc(t.title)}</h3>${t.description && !short ? `<p class="task-preview">${brief(t.description, short ? 90 : 140)}</p>` : ''}<div class="task-meta"><span class="owner-label">${avatar(t.owner)}<span>${esc(t.owner || 'Unassigned')}</span></span><span class="deadline ${overdue(t) ? 'overdue' : ''}" title="${esc(time(t.dueAt))}">${icon('clock')}${overdue(t) ? 'Overdue · ' : ''}${esc(dueLabel(t.dueAt))}</span></div><div class="task-card-bottom">${(write() || t.lessonId && state.role !== 'observer') && !t.systemKind && (command() || t.ownerId === session.user.id) ? button('Update task', 'task-update', t.id) : t.systemKind ? '<button class="button" data-page="Scope">Review scope</button>' : ''}<details class="compact-details" data-disclosure="task-${esc(t.id)}"><summary>Task details</summary><div class="detail-body">${t.description ? `<p class="preserve">${esc(t.description)}</p>` : ''}<p class="small">Due ${esc(time(t.dueAt))}</p>${t.scopeId ? `<p class="small">Scope: ${esc(state.scope.find(s => s.id === t.scopeId)?.name || t.scopeId)}</p>` : ''}${t.completionEvidence ? `<p class="preserve"><strong>Completed action</strong><br>${esc(t.completionEvidence)}</p>` : ''}${t.disposition ? `<p class="preserve"><strong>Disposition</strong><br>${esc(t.disposition)}</p>` : ''}${history(t)}</div></details></div></li>`).join('') || '<li class="empty-state">No matching tasks.</li>'}</ul>${short && matching.length > 3 ? `<p class="small muted">Showing 3 of ${matching.length} open tasks.</p>` : ''}`;
}
function findings(compact = false) {
  const rows = compact ? state.findings.filter(f => f.status === 'Open').slice(0, 3) : state.findings;
  return `<div class="actions">${write() ? button('Record finding or action', 'finding-create') : ''}</div><ul class="list finding-cards">${rows.map(f => `<li><div class="entry"><span class="finding-type ${tone(f.type)}">${icon(f.type === 'Hypothesis' ? 'alert' : 'shield')}${esc(f.type)}</span>${chip(f.status, tone(f.status))}</div><h3>${esc(f.title)}</h3><p class="card-excerpt">${brief(f.body)}</p><div class="owner-label small muted">${avatar(f.owner)}${esc(f.owner)}${f.reviewAt ? ' · Review ' + esc(dueLabel(f.reviewAt)) : ''}</div><details class="compact-details" data-disclosure="finding-${esc(f.id)}"><summary>Finding details & evidence</summary><p class="preserve">${esc(f.body)}</p><p class="small muted">${esc(f.source)} · Event ${esc(time(f.occurredAt))} · Recorded ${esc(time(f.recordedAt))}</p><p class="small">Supporting: ${esc(f.evidenceRefs.join(' · ') || 'None recorded')}<br>Contradicting: ${esc(f.contradictingRefs.join(' · ') || 'None recorded')}</p>${write() ? button('Correct finding', 'finding-update', f.id) : ''}${history(f)}</details></li>`).join('') || '<li class="empty-state">No open findings.</li>'}</ul>${compact && state.findings.filter(f => f.status === 'Open').length > rows.length ? '<button class="button text-button" data-page="Record">View all findings</button>' : ''}`;
}
function decisions(short = false) {
  return `<div class="actions">${write() && command() ? button('Record decision', 'decision-create') : ''}</div><ul class="list decision-cards">${state.decisions.filter(d => !short || d.status === 'Pending').map(d => `<li><div class="entry"><span class="finding-type amber">${icon('decision')}Decision</span>${chip(d.status, tone(d.status))}</div><h3>${esc(d.title)}</h3><p class="card-excerpt">${brief(d.rationale)}</p><p class="small muted">${esc(d.decisionMaker)} · Review ${esc(dueLabel(d.reviewAt))}</p>${write() && command() ? button('Update decision', 'decision-update', d.id) : ''}<details class="compact-details" data-disclosure="decision-${esc(d.id)}"><summary>Rationale & alternatives</summary><p class="preserve">${esc(d.rationale)}</p><p class="preserve">Alternatives: ${esc(d.alternatives)}</p>${d.supersededBy ? `<p>Replaced by: ${esc(state.decisions.find(x => x.id === d.supersededBy)?.title)}</p>` : ''}${history(d)}</details></li>`).join('') || '<li class="empty-state">No pending decisions.</li>'}</ul>`;
}
function responsePulse() {
  const open = state.tasks.filter(t => !t.done && !['Complete', 'Cancelled'].includes(t.status)), overdue = open.filter(t => t.dueAt && Date.parse(t.dueAt) < Date.now()), pending = state.decisions.filter(d => d.status === 'Pending');
  const unacked = state.messages.filter(m => m.critical && !(m.ackIds || []).includes(session.user.id));
  const tiles = [
    { label: 'Open tasks', number: open.length, note: overdue.length ? `${overdue.length} overdue` : 'Assigned response work', symbol: 'task', page: 'Tasks', tone: overdue.length ? 'urgent' : '' },
    { label: 'Affected scope', number: state.aggregates.total, note: `${state.scope.filter(s => !s.archived && s.availability === 'Locked').length} locked`, symbol: 'scope', page: 'Scope', tone: '' },
    { label: 'Pending decisions', number: pending.length, note: 'Commander review', symbol: 'decision', page: 'Record', tone: pending.length ? 'attention' : '' },
    { label: state.role === 'observer' ? 'Critical instructions' : 'Awaiting your ack', number: state.role === 'observer' ? state.messages.filter(m => m.critical).length : unacked.length, note: state.role === 'observer' ? 'Observer · read only' : 'Critical instructions', symbol: 'message', page: 'Communications', tone: unacked.length ? 'attention' : '' },
  ];
  return `<div class="response-pulse" aria-label="Response at a glance">${tiles.map(t => `<button class="pulse-tile ${t.tone}" data-page="${t.page}"><span class="pulse-label">${icon(t.symbol)}${t.label}</span><span class="pulse-value">${t.number}${icon('arrow')}</span><span class="pulse-note">${esc(t.note)}</span></button>`).join('')}</div>`;
}
function phaseTrack() {
  return `<ol class="phase-track" aria-label="Incident response phase">${['Declared', 'Investigating', 'Containing', 'Recovering', 'Closed'].map((phase, index) => `<li ${phase === state.phase ? 'aria-current="step"' : ''}><span class="phase-node" aria-hidden="true">${index + 1}</span><span>${phase}</span></li>`).join('')}</ol>`;
}
function overview() {
  const a = state.aggregates, locked = state.scope.filter(s => !s.archived && s.availability === 'Locked').length;
  return `${responsePulse()}<div class="grid overview-grid"><div class="stack">${panel('Current assessment', `<p class="lead">${brief(state.summary, 230)}</p>${phaseTrack()}<div class="impact-callout"><span class="impact-callout-icon">${icon('alert')}</span><div><span class="kicker">BUSINESS IMPACT</span><p>${brief(state.businessImpact || 'Unknown — assessment pending', 160)}</p></div></div><div class="impact-snapshot" aria-label="Scope impact counts"><div><span class="status-dot red"></span><strong>${locked}</strong><span>Locked</span></div><div><span class="status-dot amber"></span><strong>${a.suspectedExposure}</strong><span>Suspected exposure</span></div><div><span class="status-dot red"></span><strong>${a.confirmedExposure}</strong><span>Confirmed exposure</span></div></div><details class="compact-details" data-disclosure="assessment"><summary>Full assessment & counting notes</summary><p class="preserve">${esc(state.summary)}</p><p class="preserve">Business impact: ${esc(state.businessImpact || 'Unknown — assessment pending')}</p><p class="small muted">${esc(a.note)} Counts are scope items, not people or individual records.</p></details><div class="actions">${write() ? button('Edit incident', 'incident') : ''}${command() ? button(state.phase === 'Closed' ? 'Reopen incident' : 'Change phase', 'transition') : ''}</div>`, 'SITUATION', 'shield')}${panel('Facts & open questions', findings(true), 'CONFIDENCE LEDGER', 'record')}${focus ? '' : panel('Latest activity', timeline(3), 'AUDIT TRAIL', 'activity')}</div><div class="stack">${panel('Next actions', taskList(true) + `<div class="actions">${write() ? button('Assign task', 'task-create', '', 'primary') : ''}<button class="button text-button" data-page="Tasks">View all tasks ${icon('arrow')}</button></div>`, 'RESPONSE PRIORITIES', 'task', 'panel-priority')}${panel('Pending decisions', decisions(true), 'COMMANDER ATTENTION', 'decision', state.decisions.some(d => d.status === 'Pending') ? 'panel-attention' : '')}${focus ? communications() : panel('Shift handover', '<p class="panel-intro">A reviewed briefing for the next response team.</p>' + button('Open shift review', 'review-view'), 'CONTINUITY', 'message')}</div></div>`;
}
function recordView() {
  return panel('Incident record', `${write() ? button('Edit incident', 'incident') : ''}${detailList(state, [['category', 'Category'], ['source', 'Detection/report source'], ['severityRationale', 'Severity rationale'], ['discoveredAt', 'Discovery time with original offset'], ['reportedAt', 'Reported time with original offset'], ['sourceTimezone', 'Source clock timezone'], ['clockNote', 'Clock uncertainty'], ['businessImpact', 'Business impact'], ['affectedServices', 'Affected services'], ['nextReviewAt', 'Next review'], ['unknowns', 'Unknown fields'], ['unknownReason', 'Reason / follow-up']])}${history(state)}`) + panel('Findings, indicators & actions', findings()) + panel('Decisions & rationale', decisions());
}
function scopeView() {
  const a = state.aggregates;
  const rows = state.scope.filter(s => (scopeFilter === 'Archived' ? s.archived : !s.archived) && (scopeFilter !== 'Confirmed exposure' || s.exposure === 'Confirmed exposure') && (scopeFilter !== 'Unknown quantity' || s.quantityLower === null) && (!scopeSearch || [s.name, s.assetIdentifier, s.owner, s.dataCategory].join(' ').toLowerCase().includes(scopeSearch.toLowerCase())));
  return panel('Scope register', `<div class="section-toolbar"><p class="panel-intro">Independent assessments of data, exposure and recovery.</p><div class="actions">${write() ? button('Add asset or dataset', 'scope-create', '', 'primary') : ''}</div></div><div class="scope-summary"><span><strong>${a.total}</strong> active items</span><span><strong>${a.unknownQuantity}</strong> unknown quantity</span><span><strong>${a.unknownExposure}</strong> unknown exposure</span></div><div class="fields filters"><label>Search scope<input id="scope-search" value="${esc(scopeSearch)}" placeholder="Name, identifier, owner or category"></label><label>Show<select id="scope-filter">${['Active', 'Confirmed exposure', 'Unknown quantity', 'Archived'].map(f => `<option ${f === scopeFilter ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>${a.overlaps.length ? `<p class="error">Potential overlapping datasets: ${a.overlaps.map(g => esc(g.name) + ' (' + g.count + ' items)').join(' · ')}</p>` : ''}<div class="scope-cards">${rows.map(s => `<article class="scope-item"><div class="entry"><div><p class="kicker">${esc(s.type)}</p><h3>${esc(s.name)}</h3><p class="small muted"><code>${esc(s.assetIdentifier)}</code></p></div>${chip(s.sensitivity)}</div><div class="scope-owner"><span class="owner-label">${avatar(s.owner)}${esc(s.owner)}</span><span>${s.quantityLower === null ? chip('Quantity unknown', 'amber') : esc(s.volume)}</span></div><dl class="impact-grid">${Object.keys(impacts).map(k => `<div class="impact-cell ${tone(s[k])}"><dt>${k === 'exposure' ? 'Confidentiality' : k[0].toUpperCase() + k.slice(1)}</dt><dd><span class="status-dot" aria-hidden="true"></span>${esc(s[k])}</dd></div>`).join('')}</dl><p class="card-excerpt">${brief(s.reason)}</p><div class="scope-foot"><span class="small muted">${esc(s.confidence)} confidence · Rev ${s.revision}</span>${write() ? button('Edit assessment', 'scope', s.id) : ''}</div><details class="compact-details" data-disclosure="scope-${esc(s.id)}"><summary>Assessment details & history</summary><dl class="record-grid"><div><dt>Data category</dt><dd>${esc(s.dataCategory)}</dd></div><div><dt>Environment / geography</dt><dd>${esc(s.environment)} · ${esc(s.geography || 'Geography unknown')}</dd></div><div><dt>Assessed</dt><dd>${esc(time(s.assessedAt))} · ${esc(s.assessorName || 'Legacy assessor unknown')}</dd></div><div><dt>Recorded</dt><dd>${esc(time(s.recordedAt))}</dd></div><div><dt>Remediation owner</dt><dd>${esc(s.remediationOwnerName || state.members.find(m => m.id === s.remediationOwnerId)?.name || 'Unassigned')}</dd></div></dl><p class="preserve">${esc(s.reason)}</p>${s.unknownReason ? `<p>Unknown details: ${esc(s.unknownReason)}</p>` : ''}<p class="small">Evidence: ${esc(s.evidenceRefs.join(' · ') || 'None recorded')}${s.baselineRef ? '<br>Integrity baseline: ' + esc(s.baselineRef) : ''}${s.recoveryEvidence ? '<br>Recovery validation: ' + esc(s.recoveryEvidence) : ''}</p>${history(s)}</details></article>`).join('') || '<p>No matching scope items.</p>'}</div><details class="compact-details"><summary>How scope is documented and counted</summary><p>${esc(a.note)} Each assessment retains its author, event time, server receipt time and previous revisions. Counts are scope items; overlapping record quantities are not summed.</p></details>`, 'IMPACT ASSESSMENT', 'scope');
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
  $('incident-severity').className = 'chip ' + tone(state.severity); $('incident-phase').className = 'chip ' + tone(state.phase);
  $('commander-name').textContent = state.commanderName; $('declared-time').textContent = time(state.createdAt);
  $('environment-label').textContent = state.exercise ? 'SYNTHETIC EXERCISE' : 'RESPONSE ENCLAVE';
  $('environment-description').textContent = state.exercise ? 'Synthetic incident data' : 'Independent local coordination';
  for (const tab of $('tabs').querySelectorAll('button')) tab.toggleAttribute('aria-current', tab.dataset.page === page);
}
function render() {
  if (!session) return;
  header(); const content = $('content'), active = document.activeElement, activeId = active?.id;
  const openDisclosures = new Set([...content.querySelectorAll('details[data-disclosure][open]')].map(d => d.dataset.disclosure));
  const oldCompose = $('compose'), body = oldCompose?.elements.body.value, critical = oldCompose?.elements.critical?.checked, scroll = $('messages')?.scrollTop, send = $('send-status')?.textContent;
  const selection = activeId === 'message' || activeId === 'scope-search' ? [active.selectionStart, active.selectionEnd] : null;
  const pages = { Incidents: incidentList, People: peopleView, 'System health': healthView, Account: accountView, MyTasks: myTasksView };
  if (pages[page]) content.innerHTML = pages[page]();
  else if (!state) content.innerHTML = '<p>Loading incident…</p>';
  else content.innerHTML = ({ Overview: overview, Record: recordView, Timeline: () => panel('Timeline', timeline()), Scope: scopeView, Tasks: () => panel(personal ? 'My tasks in this incident' : 'Incident tasks', `<div class="section-toolbar"><p class="panel-intro">Priorities, ownership and deadlines at a glance.</p><div class="actions">${write() ? button('Assign task', 'task-create', '', 'primary') : ''}</div></div>` + taskList(), 'RESPONSE WORK', 'task'), Communications: communications, Evidence: () => evidenceView(state, history), Review: () => reviewView() + lessonsView(state, history) + reportsView(state) })[page]();
  for (const d of content.querySelectorAll('details[data-disclosure]')) if (openDisclosures.has(d.dataset.disclosure)) d.open = true;
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
  const urgency = new Date().toISOString().slice(0, 10) + records.tasks.map(t => !t.done && t.dueAt && Date.parse(t.dueAt) < Date.now()).join(',');
  if (nextStamp !== stamp || urgency !== urgencyStamp) { state = records; stamp = nextStamp; urgencyStamp = urgency; render(); } else connection();
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
  state = undefined; stamp = ''; urgencyStamp = ''; selected = id; page = next; personal = mine; scopeSearch = ''; scopeFilter = 'Active'; messageRequest = undefined; taskFilter = 'All';
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
  if (kind === 'task-filter') { taskFilter = b.dataset.filter; render(); document.querySelector(`[data-action="task-filter"][data-filter="${taskFilter}"]`)?.focus(); return; }
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
  if (!session) { state = undefined; selected = undefined; draft = undefined; messageRequest = undefined; allTasks = []; stamp = ''; urgencyStamp = ''; catalogStamp = ''; lastCatalog = 0; lastSync = undefined; online = false; scopeSearch = ''; directory = { incidents: [], assignmentIncidents: [], commanders: [], canCreate: false }; return; }
  if (!selected && views.includes(page)) page = 'Incidents';
  render();
});
$('tabs').innerHTML = views.map(v => `<button data-page="${v}">${v}</button>`).join('');
await boot(); await listIncidents();
if (!Object.keys(session.user.grants).length && session.user.admin) navigate('People');
else if (directory.incidents.length === 1) await openIncident(directory.incidents[0].id);
else navigate('Incidents');
poll();
