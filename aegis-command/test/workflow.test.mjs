import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { createIncident, mutate, visible, catalog } from '../lib/incident.mjs';
import { normalize, time } from '../lib/model.mjs';
import { INCIDENT } from '../lib/access.mjs';
let sequence = 0;
const id = () => 'workflow-' + (++sequence);
const past = () => new Date(Date.now() - 3600_000).toISOString();
const future = () => new Date(Date.now() + 3600_000).toISOString();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aegis-workflow-')); const store = new Store(join(root, 'data/vault.sqlite'), randomBytes(32)); t.after(() => store.close());
  const people = [ ['commander', 'commander', true], ['responder', 'responder', false], ['observer', 'observer', false], ['outsider', null, true] ].map(([name, role, admin]) => ({ id: name, username: name, name, role, admin, status: 'active', version: 1, grants: role ? { [INCIDENT]: role } : {}, credentials: [] }));
  const setup = store.run(data => { data.users = people; data.incidents[INCIDENT].commanderId = 'commander'; });
  const send = async (actor, command, incidentId = INCIDENT) => { await setup; return store.run(data => { const user = data.users.find(u => u.id === actor); mutate(data, { id: id(), ...command }, user, incidentId); return visible(data, user, incidentId); }); };
  const view = (incidentId = INCIDENT) => visible(store.read(), store.read().users[0], incidentId);
  const discoveredAt = past();
  const create = async (input = {}, actor = 'commander') => { await setup; return store.run(data => { const user = data.users.find(u => u.id === actor); return createIncident(data, { id: id(), title: 'New ransomware incident', severity: 'High', severityRationale: 'Production service interrupted', summary: 'Encrypted service volume observed', commanderId: actor, discoveredAt, ...input }, { user, session: { version: user.version } }); }); };
  return { root, store, send, view, create, setup };
}
function scopeInput(extra = {}) {
  return { kind: 'scope-create', type: 'Dataset', name: 'Customer data', assetIdentifier: 'customer-prod', owner: 'Data Operations', environment: 'Production', dataCategory: 'Customer PII', sensitivity: 'Restricted', quantityLower: 100, quantityUpper: 200, quantityUnit: 'records', confidence: 'Moderate', availability: 'Locked', exposure: 'Suspected exposure', exfiltration: 'Suspected', integrity: 'Unknown', containment: 'In progress', recovery: 'Pending', assessedAt: past(), remediationOwnerId: 'responder', evidenceRefs: ['EV-101'], body: 'Encrypted storage and suspicious outbound transfer observed', ...extra };
}
test('legacy encrypted vault migration preserves records, independent statuses, grants and unknown quantities', () => {
  const incident = JSON.parse(readFileSync(new URL('../web/scenario.json', import.meta.url), 'utf8')); incident.id = INCIDENT; incident.requests = ['prior-retry'];
  const data = { version: 1, incident, users: [{ id: 'maya', name: 'Maya Chen', grants: { [INCIDENT]: 'commander' } }], invites: [], sessions: [], audit: [] };
  const prior = structuredClone(incident); normalize(data); const s = data.incidents[INCIDENT];
  assert.equal(data.version, 3); assert(!Object.hasOwn(data, 'incident')); assert.equal(s.commanderId, 'maya');
  assert.equal(s.scope[0].availability, prior.scope[0].availability); assert.equal(s.scope[0].exfiltration, prior.scope[0].exfiltration);
  assert.equal(s.scope[1].quantityLower, null); assert.equal(s.scope[1].quantityUpper, null); assert.equal(s.scope[0].quantityLower, 18000); assert.equal(s.scope[0].quantityUpper, 24000);
  assert.deepEqual(s.messages, prior.messages); assert.deepEqual(s.events, prior.events); assert.deepEqual(s.requests, prior.requests);
  const once = JSON.stringify(data); normalize(data); assert.equal(JSON.stringify(data), once);
});
test('schema migration commits inside the encrypted store and survives reopening without a second migration', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-migrate-')), key = randomBytes(32), path = join(root, 'data/vault.sqlite');
  let store = new Store(path, key);
  const incident = JSON.parse(readFileSync(new URL('../web/scenario.json', import.meta.url), 'utf8')); incident.id = INCIDENT; incident.requests = [];
  store.save({ version: 1, incident, users: [], invites: [], devices: [], sessions: [], approvals: [], audit: [] }); store.close();
  store = new Store(path, key); await store.run(data => { assert.equal(data.version, 3); assert.equal(data.incidents[INCIDENT].scope[0].availability, 'Locked'); }); store.close();
  store = new Store(path, key); t.after(() => store.close());
  assert.equal(store.read().audit.filter(a => a.action === 'schema.migrated').length, 1);
  assert.equal(store.read().incidents[INCIDENT].scope[1].quantityLower, null);
});
test('legacy scope revision history appears on the migrated row as well as in the original timeline', () => {
  const incident = JSON.parse(readFileSync(new URL('../web/scenario.json', import.meta.url), 'utf8')); incident.id = INCIDENT; incident.requests = [];
  const prior = structuredClone(incident.scope[0]); incident.scope[0].revision = 2; incident.scope[0].availability = 'Accessible';
  const event = { actorId: 'maya', actor: 'Maya Chen', time: past(), title: 'Scope assessment updated', detail: 'Clean restore validated', prior };
  incident.events.unshift(event);
  const data = { version: 1, incident, users: [], invites: [], sessions: [], audit: [] }; normalize(data);
  const row = data.incidents[INCIDENT].scope[0]; assert.equal(row.revision, 2); assert.equal(row.history[0].value.availability, 'Locked'); assert.equal(row.history[0].supersededBy, 'maya'); assert.deepEqual(data.incidents[INCIDENT].events[0], event);
});
test('declarations are idempotent, scoped, persistent, and give unknown details an accountable follow-up', async t => {
  const f = fixture(t), request = { id: id() }; const result = await f.create(request); const state = f.view(result.id);
  assert.equal(state.phase, 'Declared'); assert.equal(state.commanderId, 'commander'); assert.equal(state.scope.length, 0);
  assert(state.tasks.some(task => task.systemKind === 'documentation-unknowns' && task.ownerId === 'commander' && task.dueAt));
  assert.equal((await f.create(request)).id, result.id);
  await assert.rejects(f.create({ ...request, title: 'Changed retry' }), e => e.status === 409);
  await assert.rejects(f.create({}, 'responder'), e => e.status === 403);
  const data = f.store.read(); assert.throws(() => visible(data, data.users[1], result.id), e => e.status === 403);
  assert(!catalog(data, data.users[1]).incidents.some(s => s.id === result.id));
  const restricted = catalog(data, data.users[3]).assignmentIncidents.find(s => s.id === result.id); assert.equal(restricted.title, 'Restricted incident');
  assert.equal(f.store.read().incidents[result.id].title, state.title);
});
test('incident edits preserve versions, distinguish event/receipt time, restrict severity changes and resolve unknown follow-ups', async t => {
  const f = fixture(t), result = await f.create(); let state = f.view(result.id);
  await f.store.run(data => { data.users[1].grants[result.id] = 'responder'; });
  await assert.rejects(f.send('responder', { kind: 'incident', revision: state.revision, severity: 'Critical', body: 'Escalate' }, result.id), e => e.status === 403);
  const original = state.summary;
  state = await f.send('responder', { kind: 'incident', revision: state.revision, summary: 'Containment in progress', source: 'Endpoint investigation', category: 'Ransomware', affectedServices: ['Customer database'], businessImpact: 'Checkout unavailable', body: 'Confirmed business impact with service owner' }, result.id);
  assert.equal(state.history[0].value.summary, original); assert.equal(state.history[0].supersededBy, 'responder');
  const task = state.tasks.find(t => t.systemKind); assert.equal(task.status, 'Complete'); assert.equal(task.history[0].value.status, 'Open');
  await assert.rejects(f.send('commander', { kind: 'incident', revision: 1, summary: 'Stale overwrite', body: 'Stale' }, result.id), e => e.status === 409 && e.current.summary === state.summary);
  assert.equal(f.view(result.id).summary, state.summary);
  assert.throws(() => time('2026-02-30T12:00:00Z', 'time')); assert.throws(() => time('2026-01-01T12:00', 'time'));
});
test('scope captures metadata and evidence, keeps exposure after recovery, and rejects stale concurrent edits', async t => {
  const f = fixture(t); let state = await f.send('responder', scopeInput()); let row = state.scope.at(-1);
  assert.equal(row.assessorId, 'responder'); assert(row.recordedAt); assert.equal(row.quantityUpper, 200);
  const changes = { ...scopeInput(), kind: 'scope', entityId: row.id, revision: row.revision, availability: 'Accessible', recovery: 'Validated', recoveryEvidence: 'EV-RESTORE-1: application and hash validation', body: 'Validated a clean restore; exposure remains under investigation' };
  const responses = await Promise.allSettled([f.send('responder', changes), f.send('commander', { ...changes, body: 'Concurrent competing assessment' })]);
  assert.equal(responses.filter(r => r.status === 'fulfilled').length, 1); assert.equal(responses.find(r => r.status === 'rejected').reason.status, 409);
  row = f.view().scope.at(-1); assert.equal(row.availability, 'Accessible'); assert.equal(row.exposure, 'Suspected exposure'); assert.equal(row.exfiltration, 'Suspected'); assert.equal(row.history[0].value.availability, 'Locked');
  assert.equal(row.history[0].reason, changes.body);
});
test('unknown scope volumes stay null, overlaps are explicit, archival is versioned and invalid assessments roll back', async t => {
  const f = fixture(t); let state = await f.send('responder', scopeInput({ quantityLower: null, quantityUpper: null, unknownReason: 'Storage inventory incomplete', overlapGroup: 'customer-copies' }));
  const first = state.scope.at(-1); state = await f.send('responder', scopeInput({ name: 'Customer copy', assetIdentifier: 'customer-copy', overlapGroup: 'customer-copies' }));
  assert(state.aggregates.unknownQuantity >= 2); assert(state.aggregates.overlaps.some(g => g.name === 'customer-copies' && g.count === 2)); assert(!Object.hasOwn(state.aggregates, 'totalRecords'));
  const before = state.scope.length;
  assert(state.tasks.some(t => t.systemKind === 'scope-unknowns' && t.scopeId === first.id && t.ownerId === 'responder'));
  for (const values of [{ quantityLower: 20, quantityUpper: 10 }, { quantityLower: 1.2, quantityUpper: 2 }, { quantityLower: '100', quantityUpper: 200 }, { quantityLower: null, quantityUpper: null, unknownReason: '' }, { exposure: 'Confirmed exposure', evidenceRefs: [] }, { integrity: 'Verified against baseline', baselineRef: '' }, { recovery: 'Validated', recoveryEvidence: '' }, { remediationOwnerId: 'outsider' }, { sensitivity: 'anything' }]) {
    await assert.rejects(f.send('responder', scopeInput({ assetIdentifier: 'invalid-' + id(), ...values })));
    assert.equal(f.view().scope.length, before);
  }
  state = await f.send('responder', { ...scopeInput(), kind: 'scope', entityId: first.id, revision: first.revision, quantityLower: null, quantityUpper: null, unknownReason: 'Inventory pending', archived: true, body: 'Duplicate scope reference retained for history' });
  assert(state.scope.find(s => s.id === first.id).archived); assert(!state.aggregates.overlaps.some(g => g.name === 'customer-copies'));
  assert.equal(state.tasks.find(t => t.systemKind === 'scope-unknowns' && t.scopeId === first.id).status, 'Cancelled');
});
test('task owners, due times, linked scope, actions and corrections are accountable', async t => {
  const f = fixture(t); let state = await f.send('responder', scopeInput()); const scopeId = state.scope.at(-1).id;
  state = await f.send('commander', { kind: 'task-create', title: 'Validate restore', description: 'Compare hashes and application behavior', ownerId: 'responder', priority: 'High', dueAt: future(), scopeId }); const task = state.tasks.at(-1);
  await assert.rejects(f.send('responder', { kind: 'task-update', entityId: task.id, revision: task.revision, ownerId: 'commander', body: 'Reassign' }), e => e.status === 403);
  state = await f.send('responder', { kind: 'task-update', entityId: task.id, revision: task.revision, status: 'Complete', completionEvidence: 'EV-RESTORE validated', body: 'Restore tests passed' });
  assert.equal(state.tasks.at(-1).history[0].value.status, 'Open'); assert.equal(state.tasks.at(-1).status, 'Complete');
  state = await f.send('responder', { kind: 'finding-create', type: 'Hypothesis', title: 'Customer data may have left the enclave', description: 'Outbound transfer contents under review', source: 'Gateway logs', occurredAt: past(), ownerId: 'responder', reviewAt: future(), evidenceRefs: ['EV-NETWORK'], contradictingRefs: [] });
  const finding = state.findings.at(-1);
  state = await f.send('responder', { kind: 'finding-update', entityId: finding.id, revision: finding.revision, type: 'Confirmed fact', title: 'Transfer contained test data', description: 'Reconciled file hashes', source: 'Gateway capture and file manifest', occurredAt: finding.occurredAt, ownerId: 'responder', status: 'Resolved', evidenceRefs: ['EV-HASHES'], contradictingRefs: ['EV-NETWORK'], body: 'Replaced hypothesis after manifest verification' });
  assert.equal(state.findings.at(-1).history[0].value.type, 'Hypothesis'); assert.equal(state.findings.at(-1).recordedBy, 'responder');
});
test('decisions retain alternatives and prior rationale, and supersession must link a same-incident replacement', async t => {
  const f = fixture(t), fields = { title: 'Isolate service', rationale: 'Stop propagation', alternatives: 'Keep service online under observation', status: 'Approved', decisionMakerId: 'commander', evidenceRefs: ['EV-101'] };
  await assert.rejects(f.send('responder', { kind: 'decision-create', ...fields }), e => e.status === 403);
  let state = await f.send('commander', { kind: 'decision-create', ...fields }); const first = state.decisions.at(-1);
  state = await f.send('commander', { kind: 'decision-create', ...fields, title: 'Restore in phases', rationale: 'Validated isolation and clean restore' }); const replacement = state.decisions.at(-1);
  state = await f.send('commander', { kind: 'decision-update', ...fields, entityId: first.id, revision: first.revision, status: 'Superseded', supersededBy: replacement.id, body: 'Recovery evidence supports phased restoration' });
  assert.equal(state.decisions[0].history[0].value.status, 'Approved'); assert.equal(state.decisions[0].supersededBy, replacement.id);
});
test('closure validates recovery/risk/review, closed records reject operational edits, and reopening preserves history', async t => {
  const f = fixture(t); await f.setup; let state = f.view();
  await assert.rejects(f.send('commander', { kind: 'transition', phase: 'Closed', revision: state.revision, body: 'Done' }));
  await assert.rejects(f.send('responder', { kind: 'transition', phase: 'Recovering', revision: state.revision, body: 'Unauthorized close' }), e => e.status === 403);
  state = await f.send('commander', { kind: 'transition', phase: 'Recovering', revision: state.revision, body: 'Containment completed; validate recovery' });
  await assert.rejects(f.send('commander', { kind: 'transition', phase: 'Closed', revision: state.revision, body: 'Close', impactSummary: 'Services restored' }));
  state = await f.send('commander', { kind: 'transition', phase: 'Closed', revision: state.revision, body: 'Commander accepted residual risk', impactSummary: 'Database service restored', residualRisk: 'Exfiltration investigation remains owned by responder; next review scheduled', recoveryValidation: 'EV-RESTORE-1 hash and application tests', reviewOwnerId: 'responder', reviewDueAt: future() });
  assert.equal(state.phase, 'Closed'); assert.equal(state.review.ownerId, 'responder'); assert.equal(state.history.at(-1).value.closure, null);
  await assert.rejects(f.send('responder', scopeInput()), e => e.status === 409);
  state = await f.send('responder', { kind: 'review', revision: state.review.revision, status: 'Complete', notes: 'Review completed; lessons and follow-ups recorded in tasks', evidenceRefs: ['EV-REVIEW'], body: 'Review held with response team' });
  const closure = structuredClone(state.closure);
  await assert.rejects(f.send('commander', { kind: 'transition', phase: 'Investigating', revision: state.revision, body: '' }));
  state = await f.send('commander', { kind: 'transition', phase: 'Investigating', revision: state.revision, body: 'New evidence requires additional investigation' });
  assert.equal(state.phase, 'Investigating'); assert.deepEqual(state.closure, closure); assert.equal(state.review.status, 'Complete'); assert(state.events.some(e => e.title === 'Incident closed')); assert.equal(state.events[0].title, 'Incident reopened');
});
test('cross-incident IDs, read-only observers and reused submission IDs cannot bypass authorization or alter history', async t => {
  const f = fixture(t), created = await f.create(); let state = await f.send('commander', { ...scopeInput(), remediationOwnerId: 'commander' }, created.id); const foreign = state.scope[0];
  await assert.rejects(f.send('responder', scopeInput(), created.id), e => e.status === 403);
  await assert.rejects(f.send('commander', { ...scopeInput(), kind: 'scope', entityId: foreign.id, revision: foreign.revision }), e => e.status === 404);
  await assert.rejects(f.send('observer', scopeInput()), e => e.status === 403);
  const command = { ...scopeInput(), id: id() }; state = await f.send('responder', command); const count = state.scope.length;
  state = await f.send('responder', command); assert.equal(state.scope.length, count);
  await assert.rejects(f.send('responder', { ...command, body: 'Different change with same submission ID' }), e => e.status === 409);
});
