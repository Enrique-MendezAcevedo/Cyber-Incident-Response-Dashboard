import { randomUUID, createHash } from 'node:crypto';
import { requireThat, requireMember, member, INCIDENT, roles, revoke } from './access.mjs';
import { audit } from './store.mjs';
import { phases, severities, impacts, confidenceLevels, sensitivities, taskStates, priorities, findingTypes, text, choice, list, time, revision, revise, snapshot, core, check } from './model.mjs';
import { evidenceCommand } from './evidence.mjs';
import { lessonCommand } from './lessons.mjs';
import { exportCommand, publicExport, expireExports } from './reports.mjs';
export const canCreate = user => user.admin || Object.values(user.grants || {}).includes('commander');
function get(data, id) { requireThat(typeof id === 'string' && Object.hasOwn(data.incidents, id), 'Incident not found.', 404); return data.incidents[id]; }
function person(data, id, incidentId, allowed = roles) {
  const user = data.users.find(u => u.id === id && u.status === 'active');
  requireThat(user && (!incidentId || allowed.includes(member(user, incidentId))), 'Select an active assigned owner.', 400); return user;
}
function hash(value) {
  function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function submission(c) {
  requireThat(!Object.hasOwn(c, 'actor') && !Object.hasOwn(c, 'actorId'), 'Authorship comes from your authenticated session.');
  requireThat(typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(c.id), 'Invalid submission ID.');
}
function recordFields(input, current = {}) {
  const v = { ...current, ...input };
  const result = {
    title: text(v.title, 'Title', { required: true, max: 200 }), severity: choice(v.severity || 'Unknown', severities, 'severity'),
    severityRationale: text(v.severityRationale, 'Severity rationale', { required: true, max: 2000 }),
    summary: text(v.summary, 'Situation summary', { required: true }), businessImpact: text(v.businessImpact, 'Business impact'),
    affectedServices: list(v.affectedServices || [], 'Affected services'), category: text(v.category || 'Unknown', 'Incident category', { required: true, max: 100 }),
    source: text(v.source || 'Unknown', 'Detection/report source', { required: true, max: 500 }),
    discoveredAt: time(v.discoveredAt, 'Discovery time', { past: true }), reportedAt: time(v.reportedAt || new Date().toISOString(), 'Reported time', { required: true, past: true }),
    sourceTimezone: text(v.sourceTimezone || 'UTC', 'Source timezone', { required: true, max: 100 }), clockNote: text(v.clockNote, 'Clock uncertainty', { max: 2000 }),
    nextReviewAt: time(v.nextReviewAt || new Date(Date.now() + 3600_000).toISOString(), 'Next review time', { required: true }),
    unknownReason: text(v.unknownReason || 'Initial assessment pending.', 'Unknown details rationale', { required: true, max: 2000 }),
  };
  for (const field of ['source', 'category']) if (/^(unknown|pending|tbd)$/i.test(result[field])) result[field] = 'Unknown';
  if (/^(unknown|pending|tbd)$/i.test(result.businessImpact)) result.businessImpact = '';
  result.affectedServices = result.affectedServices.filter(s => !/^(unknown|pending|tbd)$/i.test(s));
  try { new Intl.DateTimeFormat('en', { timeZone: result.sourceTimezone }); } catch { check(false, 'Use an IANA source timezone, such as UTC or America/Chicago.', 'sourceTimezone'); }
  check(!result.discoveredAt || Date.parse(result.discoveredAt) <= Date.parse(result.reportedAt) || result.clockNote, 'Explain clock uncertainty when discovery follows the recorded report time.', 'clockNote');
  result.unknowns = ['discoveredAt', 'businessImpact'].filter(f => !result[f]);
  if (!result.affectedServices.length) result.unknowns.push('affectedServices');
  for (const field of ['category', 'source']) if (result[field] === 'Unknown') result.unknowns.push(field);
  return result;
}
function unknownTask(state, commander, actor) {
  const existing = state.tasks.find(t => t.systemKind === 'documentation-unknowns' && !['Complete', 'Cancelled'].includes(t.status));
  if (!state.unknowns.length) {
    if (existing) revise(existing, { status: 'Complete', done: true, completionEvidence: 'Previously unknown incident fields have been documented.' }, actor, 'Unknown incident fields resolved.');
    return;
  }
  const fields = { description: state.unknowns.join(', ') + ' · ' + state.unknownReason, ownerId: commander.id, owner: commander.name, dueAt: state.nextReviewAt };
  if (existing) { if (Object.keys(fields).some(k => fields[k] !== existing[k])) revise(existing, fields, actor, 'Unknown documentation follow-up updated.'); }
  else state.tasks.push({ ...fields, id: randomUUID(), title: 'Resolve unknown incident details', systemKind: 'documentation-unknowns', priority: 'High', status: 'Open', done: false, scopeId: null, completionEvidence: '', disposition: '', revision: 1, history: [], createdAt: new Date().toISOString(), createdBy: actor.id });
}
function scopeFollowup(state, row, owner, actor) {
  const existing = state.tasks.find(t => t.systemKind === 'scope-unknowns' && t.scopeId === row.id && !t.done);
  if (!row.unknowns.length || row.archived) {
    if (existing) revise(existing, row.archived ? { status: 'Cancelled', done: true, disposition: 'Scope item archived: ' + row.reason } : { status: 'Complete', done: true, completionEvidence: 'Scope assessment unknowns resolved in revision ' + row.revision }, actor, 'Scope assessment follow-up updated.');
    return;
  }
  const fields = { title: 'Resolve scope unknowns: ' + row.name, description: row.unknowns.join(', ') + ' · ' + (row.unknownReason || row.reason), ownerId: owner.id, owner: owner.name, dueAt: state.nextReviewAt || new Date(Date.now() + 3600_000).toISOString() };
  if (existing) { if (Object.keys(fields).some(k => fields[k] !== existing[k])) revise(existing, fields, actor, 'Scope follow-up ownership or assessment updated.'); }
  else state.tasks.push({ ...fields, id: randomUUID(), scopeId: row.id, systemKind: 'scope-unknowns', status: 'Open', done: false, priority: 'High', completionEvidence: '', disposition: '', revision: 1, history: [], createdAt: new Date().toISOString(), createdBy: actor.id });
}
export function catalog(data, user) {
  return { canCreate: canCreate(user), incidents: Object.values(data.incidents).filter(s => member(user, s.id)).map(s => ({ id: s.id, code: s.code, title: s.title, severity: s.severity, phase: s.phase, commanderName: s.commanderName, nextReviewAt: s.nextReviewAt, updatedAt: s.updatedAt, role: member(user, s.id), exercise: s.exercise })),
    assignmentIncidents: Object.values(data.incidents).filter(s => user.admin || member(user, s.id) === 'commander').map(s => ({ id: s.id, code: s.code, title: member(user, s.id) ? s.title : 'Restricted incident' })),
    commanders: canCreate(user) ? data.users.filter(u => u.status === 'active').map(u => ({ id: u.id, name: u.name })) : [] };
}
export function createIncident(data, input, me) {
  requireThat(canCreate(me.user), 'Administrator or incident commander access is required to declare an incident.', 403);
  submission(input); const key = me.user.id + ':' + input.id;
  const receipt = data.creationReceipts[key];
  if (receipt) { requireThat(receipt.hash === hash(input), 'Submission ID was already used for a different declaration.', 409); return { id: receipt.incidentId, assignedToYou: !!member(me.user, receipt.incidentId) }; }
  const fields = recordFields(input), commander = person(data, input.commanderId || me.user.id);
  const id = randomUUID(), now = new Date().toISOString();
  const state = { ...fields, id, code: 'IR-' + now.slice(0, 4) + '-' + id.slice(0, 8).toUpperCase(), exercise: input.exercise === true,
    commanderId: commander.id, commanderName: commander.name, phase: 'Declared', revision: 1, sequence: 1, history: [], createdAt: now, createdBy: me.user.id, updatedAt: now, updatedBy: me.user.id,
    scope: [], tasks: [], findings: [], decisions: [], messages: [], events: [], evidence: [], evidenceRegister: [], lessons: [], exports: [], requests: [], receipts: {}, checkpoint: null, closure: null, review: null };
  commander.grants[id] = 'commander'; commander.version++;
  if (commander.id === me.user.id) me.session.version = commander.version; else revoke(data, commander.id);
  state.events.push({ id: randomUUID(), actorId: me.user.id, actor: me.user.name, time: now, occurredAt: fields.reportedAt, title: 'Incident declared', detail: fields.summary });
  unknownTask(state, commander, me.user);
  data.incidents[id] = state; data.creationReceipts[key] = { hash: hash(input), incidentId: id };
  audit(data, me.user.id, 'incident.created', id); return { id, assignedToYou: commander.id === me.user.id };
}
export function aggregate(state) {
  const rows = state.scope.filter(r => !r.archived);
  const groups = new Map(); for (const r of rows) if (r.overlapGroup) groups.set(r.overlapGroup, (groups.get(r.overlapGroup) || 0) + 1);
  return { total: rows.length, confirmedExposure: rows.filter(r => r.exposure === 'Confirmed exposure').length, suspectedExposure: rows.filter(r => r.exposure === 'Suspected exposure').length, unknownExposure: rows.filter(r => r.exposure === 'Unknown').length, unknownQuantity: rows.filter(r => r.quantityLower === null || r.quantityUpper === null).length, overlaps: [...groups].filter(([, n]) => n > 1).map(([name, count]) => ({ name, count })), note: 'Counts describe scope items, not unique records. Quantities are not summed across datasets or units; overlaps may exist even when unmarked.' };
}
export function visible(data, user, incidentId = INCIDENT) {
  requireMember(user, roles, incidentId); const state = get(data, incidentId);
  expireExports(state);
  const { requests, receipts, exports, ...view } = state;
  return { ...view, exports: member(user, incidentId) === 'commander' ? exports.map(publicExport) : [], serverTime: new Date().toISOString(), role: member(user, incidentId), aggregates: aggregate(state), members: data.users.filter(u => u.status === 'active' && member(u, incidentId)).map(u => ({ id: u.id, name: u.name, role: member(u, incidentId) })) };
}
function scopeFields(input, current, state, data, user) {
  const v = { ...current, ...input }, result = {};
  for (const [field, options] of Object.entries(impacts)) result[field] = choice(v[field] || options[0], options, field);
  Object.assign(result, {
    name: text(v.name, 'Asset/dataset name', { required: true, max: 200 }), type: choice(v.type || 'Dataset', ['Dataset', 'Asset'], 'scope type'),
    assetIdentifier: text(v.assetIdentifier, 'Asset/dataset identifier', { required: true, max: 300 }), owner: text(v.owner, 'Business/data owner', { required: true, max: 200 }),
    environment: text(v.environment || 'Unknown', 'Environment', { required: true, max: 200 }), dataCategory: text(v.dataCategory || 'Unknown', 'Data category', { required: true, max: 200 }),
    sensitivity: choice(v.sensitivity || 'Unknown', sensitivities, 'sensitivity'), geography: text(v.geography, 'Geography', { max: 300 }),
    quantityUnit: text(v.quantityUnit || 'records', 'Quantity unit', { required: true, max: 40 }), quantityLower: v.quantityLower ?? null, quantityUpper: v.quantityUpper ?? null,
    unknownReason: text(v.unknownReason, 'Unknown details rationale', { max: 2000 }), overlapGroup: text(v.overlapGroup, 'Potential overlap group', { max: 100 }),
    confidence: choice(v.confidence || 'Unknown', confidenceLevels, 'confidence'), evidenceRefs: list(v.evidenceRefs || [], 'Evidence references'),
    baselineRef: text(v.baselineRef, 'Integrity baseline reference', { max: 1000 }), recoveryEvidence: text(v.recoveryEvidence, 'Recovery validation reference', { max: 2000 }),
    assessedAt: time(v.assessedAt, 'Assessment time', { required: true, past: true }), assessorId: user.id, assessorName: user.name, recordedAt: new Date().toISOString(),
    remediationOwnerId: person(data, v.remediationOwnerId || user.id, state.id, ['commander', 'responder']).id,
    archived: v.archived === true, reason: text(input.body, 'Assessment rationale', { required: true }),
  });
  for (const field of ['environment', 'dataCategory']) if (/^(unknown|pending|tbd)$/i.test(result[field])) result[field] = 'Unknown';
  const unknownQuantity = result.quantityLower === null && result.quantityUpper === null;
  check(unknownQuantity || ([result.quantityLower, result.quantityUpper].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) && result.quantityLower <= result.quantityUpper), 'Enter both numeric quantity bounds in ascending order, or leave both unknown.', 'quantityLower');
  if (['records', 'accounts', 'files', 'devices', 'bytes'].includes(result.quantityUnit) && !unknownQuantity) check(Number.isSafeInteger(result.quantityLower) && Number.isSafeInteger(result.quantityUpper), 'Counts in ' + result.quantityUnit + ' must be whole numbers.', 'quantityLower');
  check(!(unknownQuantity || result.dataCategory === 'Unknown' || result.sensitivity === 'Unknown' || result.environment === 'Unknown' || result.confidence === 'Unknown') || result.unknownReason, 'Explain unknown quantity, classification, environment or confidence.', 'unknownReason');
  check(!(result.exposure === 'Confirmed exposure' || result.exfiltration === 'Confirmed') || result.evidenceRefs.length > 0, 'Confirmed exposure/exfiltration requires supporting evidence references.', 'evidenceRefs');
  check(result.integrity !== 'Verified against baseline' || result.baselineRef, 'Name the baseline used to verify integrity.', 'baselineRef');
  check(result.recovery !== 'Validated' || result.recoveryEvidence, 'Record the recovery validation evidence.', 'recoveryEvidence');
  requireThat(!state.scope.some(r => r.id !== current?.id && !r.archived && r.assetIdentifier.toLowerCase() === result.assetIdentifier.toLowerCase()) || result.archived, 'An active scope item already uses that identifier.');
  result.evidence = result.evidenceRefs.join(' · ');
  result.remediationOwnerName = person(data, result.remediationOwnerId, state.id, ['commander', 'responder']).name;
  result.unknowns = [...Object.keys(impacts).filter(k => result[k] === 'Unknown'), ...['environment', 'dataCategory', 'sensitivity', 'confidence'].filter(k => result[k] === 'Unknown'), ...(unknownQuantity ? ['quantity'] : [])];
  result.volume = unknownQuantity ? 'Unknown · ' + result.unknownReason : (result.quantityLower === result.quantityUpper ? result.quantityLower : result.quantityLower + '–' + result.quantityUpper) + ' ' + result.quantityUnit;
  return result;
}
function taskFields(input, old, state, data) {
  const v = { ...old, ...input }, owner = person(data, v.ownerId, state.id, ['commander', 'responder']);
  if (v.scopeId) requireThat(state.scope.some(r => r.id === v.scopeId), 'Linked scope item does not belong to this incident.');
  const values = { title: text(v.title, 'Task title', { required: true, max: 200 }), description: text(v.description, 'Task details'), ownerId: owner.id, owner: owner.name, priority: choice(v.priority || 'Normal', priorities, 'task priority'), status: choice(v.status || 'Open', taskStates, 'task status'), dueAt: time(v.dueAt, 'Task due time', { required: true }), scopeId: v.scopeId || null, completionEvidence: text(v.completionEvidence, 'Completion evidence', { max: 2000 }), disposition: text(v.disposition, 'Cancellation/disposition reason', { max: 2000 }) };
  check(values.status !== 'Complete' || values.completionEvidence, 'Describe the action taken or completion evidence.', 'completionEvidence');
  check(values.status !== 'Cancelled' || values.disposition, 'Explain why the task is cancelled.', 'disposition'); values.done = ['Complete', 'Cancelled'].includes(values.status); return values;
}
export function mutate(data, c, user, incidentId = INCIDENT) {
  requireMember(user, ['commander', 'responder'], incidentId); const state = get(data, incidentId);
  submission(c); const key = user.id + ':' + c.id, payloadHash = hash(c), oldReceipt = state.receipts[key];
  if (oldReceipt) { requireThat(oldReceipt === payloadHash, 'Submission ID was already used for a different change.', 409); return; }
  if (state.requests.includes(key)) return;
  const improvementTask = c.kind === 'task-update' && state.tasks.some(t => t.id === c.entityId && t.lessonId);
  requireThat(state.phase !== 'Closed' || ['transition', 'review', 'message', 'ack', 'checkpoint', 'handover'].includes(c.kind) || /^(evidence-|lesson-|export-)/.test(c.kind) || improvementTask, 'This incident is closed. Reopen it with a reason before making operational changes.', 409);
  const commander = () => requireMember(user, ['commander'], incidentId);
  const body = text(c.body, 'Rationale'), now = new Date().toISOString();
  const event = { id: randomUUID(), actor: user.name, actorId: user.id, time: now };
  const rowIn = (collection, legacy = false) => { const row = c.entityId ? collection.find(r => r.id === c.entityId) : legacy && Number.isSafeInteger(c.index) ? collection[c.index] : null; requireThat(row, 'Record not found in this incident.', 404); return row; };
  switch (c.kind) {
    case 'incident': {
      revision(state, c.revision); const values = recordFields(c, core(state));
      if (['title', 'severity', 'severityRationale'].some(f => values[f] !== state[f]) || (c.commanderId && c.commanderId !== state.commanderId)) commander();
      const owner = person(data, c.commanderId || state.commanderId, state.id, ['commander', 'responder']);
      const previous = core(state); delete previous.history;
      state.history.push({ revision: state.revision, value: previous, supersededAt: now, supersededBy: user.id, reason: text(body, 'Change rationale', { required: true }) });
      Object.assign(state, values, { commanderId: owner.id, commanderName: owner.name });
      if (member(owner, state.id) !== 'commander') { owner.grants[state.id] = 'commander'; owner.version++; revoke(data, owner.id); }
      unknownTask(state, owner, user); event.title = 'Incident record updated'; event.detail = body; break;
    }
    case 'transition': {
      commander(); revision(state, c.revision); const phase = choice(c.phase, phases, 'incident phase');
      const previous = structuredClone(core(state)); delete previous.history;
      event.prior = { phase: state.phase, closure: structuredClone(state.closure), review: structuredClone(state.review) };
      requireThat(phase !== state.phase, 'Choose a different phase.'); text(body, 'Transition reason', { required: true });
      if (state.phase === 'Closed') requireThat(phase === 'Investigating', 'Reopened incidents return to Investigating.');
      if (phase === 'Closed') {
        requireThat(state.phase === 'Recovering', 'Move into Recovering and validate recovery before closure.');
        person(data, state.commanderId, state.id, ['commander']);
        const reviewOwner = person(data, c.reviewOwnerId, state.id, ['commander', 'responder']);
        state.closure = { impactSummary: text(c.impactSummary, 'Closure impact summary', { required: true }), residualRisk: text(c.residualRisk, 'Unresolved risk/work disposition', { required: true }), recoveryValidation: text(c.recoveryValidation, 'Recovery validation evidence', { required: true }), closedAt: now, closedBy: user.id };
        state.review = { ownerId: reviewOwner.id, owner: reviewOwner.name, dueAt: time(c.reviewDueAt, 'Post-incident review due time', { required: true }), status: 'Pending', notes: '', evidenceRefs: [], revision: 1, history: [] };
      }
      state.history.push({ revision: state.revision, value: previous, supersededAt: now, supersededBy: user.id, reason: body });
      state.phase = phase; event.title = phase === 'Closed' ? 'Incident closed' : event.prior.phase === 'Closed' ? 'Incident reopened' : 'Incident phase changed'; event.detail = event.prior.phase + ' → ' + phase + ' · ' + body; break;
    }
    case 'review': {
      requireThat(state.review, 'Close the incident and assign a review first.');
      requireThat(member(user, state.id) === 'commander' || state.review.ownerId === user.id, 'Only the review owner or commander can update this review.', 403);
      revision(state.review, c.revision);
      const owner = person(data, c.ownerId || state.review.ownerId, state.id, ['commander', 'responder']);
      const dueAt = time(c.dueAt || state.review.dueAt, 'Review due time', { required: true });
      if (owner.id !== state.review.ownerId || dueAt !== state.review.dueAt) commander();
      const status = choice(c.status, ['Pending', 'In progress', 'Complete'], 'review status');
      const notes = text(c.notes, 'Review notes', { required: status === 'Complete' });
      revise(state.review, { status, notes, ownerId: owner.id, owner: owner.name, dueAt, evidenceRefs: list(c.evidenceRefs || [], 'Review references') }, user, text(body, 'Review change rationale', { required: true }));
      event.title = 'Post-incident review updated'; event.detail = status; break;
    }
    case 'scope-create': case 'scope': {
      const row = c.kind === 'scope' ? rowIn(state.scope, true) : null;
      if (row) revision(row, c.revision);
      const values = scopeFields(c, row, state, data, user);
      let saved = row;
      if (row) { event.prior = snapshot(row); revise(row, values, user, body); }
      else { saved = { ...values, id: randomUUID(), revision: 1, history: [], createdAt: now, createdBy: user.id }; state.scope.push(saved); }
      scopeFollowup(state, saved, person(data, saved.remediationOwnerId, state.id, ['commander', 'responder']), user);
      event.title = row ? values.archived ? 'Scope item archived' : 'Scope assessment updated' : 'Scope item added'; event.detail = values.name + ' · ' + body; break;
    }
    case 'task-create': case 'task-update': case 'task': {
      const row = c.kind === 'task-create' ? null : rowIn(state.tasks, true);
      if (row) {
        requireThat(member(user, state.id) === 'commander' || row.ownerId === user.id, 'Only the task owner or commander can update this task.', 403);
        revision(row, c.revision);
        requireThat(!row.systemKind, 'Resolve unknown documentation in the incident record; its follow-up task is managed automatically.');
        if (c.ownerId && c.ownerId !== row.ownerId) commander();
      }
      const values = taskFields(c.kind === 'task' ? { ...c, status: 'Complete' } : c, row, state, data);
      if (row) {
        revise(row, values, user, text(body, 'Task change rationale', { required: true }));
        const lesson = row.lessonId && state.lessons.find(l => l.id === row.lessonId);
        if (lesson?.status === 'Complete' && values.status !== 'Complete') revise(lesson, { status: 'In progress' }, user, 'Linked improvement action reopened.');
      }
      else state.tasks.push({ ...values, id: randomUUID(), revision: 1, history: [], createdAt: now, createdBy: user.id });
      event.title = row ? 'Task updated' : 'Task assigned'; event.detail = values.title + ' · ' + values.status; break;
    }
    case 'finding-create': case 'finding-update': {
      const row = c.kind === 'finding-update' ? rowIn(state.findings) : null;
      if (row) revision(row, c.revision);
      const owner = person(data, c.ownerId, state.id, ['commander', 'responder']);
      const type = choice(c.type, findingTypes, 'record type'), status = choice(c.status || 'Open', ['Open', 'Resolved', 'Refuted'], 'finding status');
      const refs = list(c.evidenceRefs || [], 'Supporting evidence');
      check(type !== 'Confirmed fact' || refs.length, 'Confirmed facts need supporting evidence references.', 'evidenceRefs');
      const values = { type, title: text(c.title, 'Finding title', { required: true, max: 200 }), body: text(c.description, 'Finding/action details', { required: true }), source: text(c.source, 'Finding source', { required: true, max: 500 }), occurredAt: time(c.occurredAt, 'Event time', { past: true }), timeUnknownReason: text(c.timeUnknownReason, 'Unknown event time rationale', { max: 2000 }), ownerId: owner.id, owner: owner.name, status, evidenceRefs: refs, contradictingRefs: list(c.contradictingRefs || [], 'Contradicting evidence'), reviewAt: time(c.reviewAt, 'Finding review time', { required: type === 'Hypothesis' && status === 'Open' }) };
      check(values.occurredAt || values.timeUnknownReason, 'Record an event time or explain why it is unknown.', 'timeUnknownReason');
      if (row) revise(row, values, user, text(body, 'Correction rationale', { required: true }));
      else state.findings.push({ ...values, id: randomUUID(), revision: 1, history: [], recordedAt: now, recordedBy: user.id });
      event.title = row ? 'Incident finding corrected' : type + ' recorded'; event.detail = values.title; event.occurredAt = values.occurredAt; break;
    }
    case 'decision-create': case 'decision-update': {
      commander(); const row = c.kind === 'decision-update' ? rowIn(state.decisions) : null;
      if (row) revision(row, c.revision);
      const decisionMaker = person(data, c.decisionMakerId || user.id, state.id, ['commander']);
      const values = { title: text(c.title, 'Decision title', { required: true, max: 200 }), status: choice(c.status || 'Pending', ['Pending', 'Approved', 'Rejected', 'Superseded'], 'decision status'), decisionMakerId: decisionMaker.id, decisionMaker: decisionMaker.name, rationale: text(c.rationale, 'Decision rationale', { required: true }), alternatives: text(c.alternatives, 'Alternatives considered', { required: true }), evidenceRefs: list(c.evidenceRefs || [], 'Decision evidence references'), reviewAt: time(c.reviewAt, 'Decision review time', { required: c.status === 'Pending' || !c.status }), supersededBy: c.supersededBy || null };
      if (values.status === 'Superseded') requireThat(row && values.supersededBy !== row.id && state.decisions.some(d => d.id === values.supersededBy && d.status !== 'Superseded'), 'Link an existing replacement decision in this incident.');
      else requireThat(!values.supersededBy, 'Only superseded decisions may link a replacement.');
      if (row) revise(row, values, user, text(body, 'Decision change rationale', { required: true }));
      else state.decisions.push({ ...values, id: randomUUID(), revision: 1, history: [], recordedAt: now, recordedBy: user.id });
      event.title = row ? 'Decision updated' : 'Decision recorded'; event.detail = values.title + ' · ' + values.status; break;
    }
    case 'message':
      text(body, 'Message', { required: true }); requireThat(!c.critical || member(user, state.id) === 'commander', 'Only a commander can issue a critical instruction.', 403);
      state.messages.push({ id: randomUUID(), author: user.name, authorId: user.id, body, time: now, critical: c.critical === true, acks: [], ackIds: [] });
      event.title = 'Channel update posted'; event.detail = 'General channel'; break;
    case 'ack': {
      const message = rowIn(state.messages, true); requireThat(message.critical, 'Unknown critical instruction.'); message.ackIds ||= [];
      if (message.ackIds.includes(user.id)) return;
      message.ackIds.push(user.id); message.acks.push(user.name); event.title = 'Critical instruction acknowledged'; event.detail = message.author + '’s instruction'; break;
    }
    case 'checkpoint': commander(); text(body, 'Reviewed handover briefing', { required: true }); state.checkpoint = { author: user.name, authorId: user.id, body, time: now, acks: [], ackIds: [] }; event.title = 'Shift checkpoint published'; event.detail = body; break;
    case 'handover': {
      const checkpoint = state.checkpoint; requireThat(checkpoint && checkpoint.time === c.checkpointTime, 'Review the latest checkpoint.', 409);
      requireThat(checkpoint.authorId !== user.id, 'The incoming responder must acknowledge the handover.');
      if (checkpoint.ackIds.includes(user.id)) return;
      checkpoint.ackIds.push(user.id); checkpoint.acks.push(user.name); event.title = 'Shift handover acknowledged'; event.detail = 'Checkpoint published by ' + checkpoint.author; break;
    }
    default:
      if (c.kind.startsWith('evidence-')) Object.assign(event, evidenceCommand(data, state, c, user));
      else if (c.kind.startsWith('lesson-')) Object.assign(event, lessonCommand(data, state, c, user));
      else if (c.kind.startsWith('export-')) Object.assign(event, exportCommand(data, state, c, user));
      else requireThat(false, 'Unknown action.');
  }
  if (['incident', 'transition'].includes(c.kind)) state.revision++;
  state.sequence++; state.updatedAt = now; state.updatedBy = user.id;
  state.events.unshift(event); state.receipts[key] = payloadHash;
  audit(data, user.id, 'incident.' + c.kind, state.id);
}
