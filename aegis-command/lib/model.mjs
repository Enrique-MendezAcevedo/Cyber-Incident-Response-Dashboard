import { randomUUID } from 'node:crypto';

export const phases = ['Declared', 'Investigating', 'Containing', 'Recovering', 'Closed'];
export const severities = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];
export const impacts = {
  availability: ['Unknown', 'Accessible', 'Degraded', 'Locked', 'Unavailable'],
  exposure: ['Unknown', 'Suspected exposure', 'Confirmed exposure', 'No evidence found'],
  exfiltration: ['Unknown', 'Suspected', 'Confirmed', 'Not observed'],
  integrity: ['Unknown', 'Suspected alteration', 'Confirmed alteration', 'Verified against baseline'],
  containment: ['Unknown', 'Pending', 'In progress', 'Contained'],
  recovery: ['Pending', 'In progress', 'Validated'],
};
export const confidenceLevels = ['Unknown', 'Low', 'Moderate', 'High'];
export const sensitivities = ['Unknown', 'Public', 'Internal', 'Confidential', 'Restricted'];
export const taskStates = ['Open', 'In progress', 'Blocked', 'Complete', 'Cancelled'];
export const priorities = ['Critical', 'High', 'Normal', 'Low'];
export const findingTypes = ['Observation', 'Confirmed fact', 'Hypothesis', 'Indicator', 'Action'];
export function check(value, message, field) { if (!value) throw Object.assign(new Error(message), { status: 400, field }); }
export function text(value, field, { required = false, max = 12000 } = {}) {
  check(value === undefined || value === null || typeof value === 'string', field + ' must be text.', field);
  const result = (value || '').trim();
  check(result.length <= max && (!required || result.length > 0), field + (required ? ' is required (maximum ' : ' exceeds ') + max + ' characters).', field);
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result), field + ' contains unsupported control characters.', field);
  return result;
}
export function choice(value, options, field) { check(options.includes(value), 'Choose a valid ' + field + '.', field); return value; }
export function list(value, field, max = 100) {
  check(Array.isArray(value) && value.length <= max, field + ' must be a list of at most ' + max + ' items.', field);
  return [...new Set(value.map(v => text(v, field, { required: true, max: 500 })))];
}
export function time(value, field, { required = false, past = false } = {}) {
  if (value === null || value === '' || value === undefined) { check(!required, field + ' is required.', field); return null; }
  const input = text(value, field, { required: true, max: 50 });
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/);
  check(m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() && Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6] || 0) <= 59 && Number(m[8] || 0) <= 14 && Number(m[9] || 0) <= 59 && (Number(m[8] || 0) !== 14 || Number(m[9] || 0) === 0) && Number.isFinite(Date.parse(input)), field + ' must be a valid timestamp with Z or an explicit UTC offset.', field);
  check(!past || Date.parse(input) <= Date.now() + 300_000, field + ' cannot be in the future.', field);
  return input; // preserve the supplied event time and offset, separate from server receipt time
}
export function snapshot(item) { const { history, ...value } = item; return structuredClone(value); }
export function revision(item, expected) {
  if (expected !== item.revision) throw Object.assign(new Error('This record changed while you were editing. Compare your draft with the current version before retrying.'), { status: 409, current: snapshot(item) });
}
export function revise(item, values, user, reason) {
  item.history ||= [];
  item.history.push({ revision: item.revision, value: snapshot(item), supersededAt: new Date().toISOString(), supersededBy: user.id, reason });
  Object.assign(item, values, { revision: item.revision + 1, updatedAt: new Date().toISOString(), updatedBy: user.id });
}
export function core(incident) {
  const { scope, tasks, findings, decisions, messages, events, checkpoint, evidence, evidenceRegister, lessons, exports, requests, receipts, members, aggregates, ...record } = incident;
  return record;
}
export function normalize(data) {
  check([1, 2, 3].includes(data.version), 'Unsupported vault schema.');
  if (data.version === 3) return data;
  if (data.version === 2) {
    for (const s of Object.values(data.incidents)) { s.evidenceRegister = []; s.lessons = []; s.exports = []; }
    data.version = 3; return data;
  }
  data.incidents = { [data.incident.id]: data.incident }; delete data.incident;
  data.creationReceipts = {};
  for (const s of Object.values(data.incidents)) {
    Object.assign(s, { code: s.id, exercise: true, revision: 1, sequence: s.events.length, history: [], receipts: {}, findings: [], decisions: [],
      severity: 'Critical', severityRationale: 'Ransomware encryption observed in the exercise.', commanderId: null,
      commanderName: 'Maya Chen', discoveredAt: '2026-11-07T14:12:00Z', reportedAt: '2026-11-07T14:12:00Z',
      sourceTimezone: 'UTC', source: 'Exercise declaration', category: 'Ransomware',
      summary: 'Encryption identified on the customer records volume; unusual outbound transfer remains under investigation.',
      businessImpact: '', affectedServices: [], nextReviewAt: null, unknownReason: 'Legacy exercise details require review.', clockNote: '',
      createdAt: '2026-11-07T14:12:00Z', updatedAt: s.events[0]?.time || '2026-11-07T14:12:00Z',
      closure: null, review: null, unknowns: ['businessImpact', 'affectedServices'] });
    const owner = data.users.find(u => u.name === s.commanderName && u.grants?.[s.id] === 'commander');
    if (owner) s.commanderId = owner.id;
    for (const row of s.scope) {
      const numbers = row.volume.match(/[\d,]+/g)?.map(v => Number(v.replaceAll(',', ''))) || [];
      Object.assign(row, { id: randomUUID(), type: 'Dataset', assetIdentifier: row.name, environment: 'Unknown', dataCategory: 'Unknown', sensitivity: 'Unknown', geography: '', quantityLower: numbers[0] ?? null, quantityUpper: numbers.at(-1) ?? null, quantityUnit: row.volume.includes('accounts') ? 'accounts' : 'records', unknownReason: numbers.length ? 'Classification and other metadata pending review.' : 'Inventory pending.', overlapGroup: '', confidence: 'Unknown', evidenceRefs: row.evidence ? [row.evidence] : [], assessedAt: null, assessorId: null, remediationOwnerId: null, baselineRef: '', recoveryEvidence: '', archived: false, history: [], recordedAt: null });
      row.history = s.events.filter(e => e.prior?.name === row.name && Number.isInteger(e.prior.revision)).map(e => ({ revision: e.prior.revision, value: structuredClone(e.prior), supersededAt: e.time, supersededBy: e.actorId || e.actor || null, reason: e.detail, legacy: true })).sort((a, b) => a.revision - b.revision);
    }
    for (const task of s.tasks) Object.assign(task, { id: randomUUID(), revision: 1, history: [], status: task.done ? 'Complete' : 'Open', priority: 'Normal', description: '', scopeId: null, ownerId: task.ownerId || null, dueAt: '2026-11-07T' + task.due.replace(' UTC', '') + ':00Z', completionEvidence: '', disposition: '' });
  }
  data.version = 2; return normalize(data);
}
