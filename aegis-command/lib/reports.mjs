import { randomUUID } from 'node:crypto';
import { requireThat, member } from './access.mjs';
import { text, choice } from './model.mjs';
import { sha256 } from './blobs.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const show = value => value === null || value === undefined || value === '' ? 'Unknown / not recorded' : Array.isArray(value) ? value.join(' · ') || 'None recorded' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const paragraph = value => `<p class="preserve">${esc(show(value))}</p>`;
const fields = (row, columns) => `<dl>${columns.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd class="preserve">${esc(show(row[key]))}</dd></div>`).join('')}</dl>`;
const table = (rows, columns) => rows.length ? `<table><thead><tr>${columns.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([key]) => `<td class="preserve">${esc(show(typeof key === 'function' ? key(row) : row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>None recorded.</p>';
const section = (title, content) => `<section><h2>${esc(title)}</h2>${content}</section>`;
export function reportSnapshot(state) {
  const { requests, receipts, exports, ...content } = state; return structuredClone(content);
}
export function reportHTML(s, meta) {
  const scopes = s.scope.map(r => `<article><h3>${esc(r.name)}${r.archived ? ' (archived)' : ''}</h3>${fields(r, [['assetIdentifier', 'Identifier'], ['type', 'Type'], ['owner', 'Business/data owner'], ['dataCategory', 'Data category'], ['sensitivity', 'Sensitivity'], ['environment', 'Environment'], ['geography', 'Geography'], ['volume', 'Estimated quantity (not deduplicated)'], ['overlapGroup', 'Potential overlap group'], ['availability', 'Availability'], ['exposure', 'Confidentiality/exposure'], ['exfiltration', 'Exfiltration'], ['integrity', 'Integrity'], ['containment', 'Containment'], ['recovery', 'Recovery'], ['confidence', 'Confidence'], ['assessedAt', 'Assessment time'], ['assessorName', 'Assessor'], ['recordedAt', 'Server receipt time'], ['remediationOwnerName', 'Remediation owner'], ['evidenceRefs', 'Supporting references'], ['baselineRef', 'Integrity baseline'], ['recoveryEvidence', 'Recovery validation'], ['reason', 'Assessment rationale'], ['unknownReason', 'Unknown details']])}</article>`).join('') || '<p>No scope items recorded.</p>';
  const evidence = (s.evidenceRegister || []).map(e => `<article><h3>${esc(e.reference)} · ${esc(e.title)}</h3>${fields(e, [['source', 'Source'], ['collector', 'Collector'], ['collectedAt', 'Collection time'], ['unknownTimeReason', 'Unknown collection time explanation'], ['recordedAt', 'Server receipt time'], ['recordedByName', 'Registered by'], ['classification', 'Classification'], ['description', 'Description'], ['storageReference', 'Original location/reference'], ['sourceDigest', 'Declared source SHA-256']])}${table(e.attachments, [['filename', 'Original filename'], ['size', 'Bytes'], ['sha256', 'Server SHA-256'], ['status', 'Disposition'], ['uploadedAt', 'Received']])}<h4>Custody history</h4>${table(e.custody, [['time', 'Server time'], ['actor', 'Recorded by'], ['action', 'Event'], ['occurredAt', 'Occurred'], [r => [r.from, r.to].filter(Boolean).join(' → '), 'Transfer/location'], ['reason', 'Details']])}</article>`).join('') || '<p>No evidence registered.</p>';
  const lessons = table(s.lessons || [], [['title', 'Lesson'], ['category', 'Category'], ['observation', 'What happened'], ['impact', 'Impact / what worked'], ['recommendation', 'Improvement'], ['owner', 'Owner'], ['status', 'Status'], ['actionTaskId', 'Action task ID'], ['disposition', 'Risk/disposition']]);
  const histories = [{ type: 'Incident', id: s.id, history: s.history }, ...['scope', 'tasks', 'findings', 'decisions', 'evidenceRegister', 'lessons'].flatMap(key => (s[key] || []).filter(r => r.history?.length).map(r => ({ type: key, id: r.id, title: r.title || r.name, history: r.history }))), ...(s.review?.history?.length ? [{ type: 'Review', history: s.review.history }] : [])];
  let content = section('Incident identification', fields(s, [['id', 'Internal ID'], ['code', 'Incident code'], ['severity', 'Severity'], ['phase', 'Phase'], ['commanderName', 'Responsible commander'], ['createdAt', 'Declared'], ['updatedAt', 'Latest recorded change']])) + section('Scope and data exposure', '<p>Unknown does not mean zero or safe. Dataset quantities are not summed; overlaps and different units may exist. Recovery does not erase prior exposure or exfiltration.</p>' + scopes);
  if (meta.format !== 'csv') content = section('Situation and impact', fields(s, [['summary', 'Situation'], ['businessImpact', 'Business impact'], ['severityRationale', 'Severity rationale'], ['category', 'Category'], ['affectedServices', 'Affected services'], ['source', 'Detection/report source'], ['discoveredAt', 'Discovery time (source offset retained)'], ['reportedAt', 'Reported time'], ['sourceTimezone', 'Source clock timezone'], ['clockNote', 'Clock uncertainty'], ['unknowns', 'Unknown incident fields'], ['unknownReason', 'Unknown details explanation'], ['nextReviewAt', 'Next review']])) + content +
    section('Findings, indicators and response actions', table(s.findings, [['type', 'Type'], ['title', 'Finding/action'], ['body', 'Details'], ['source', 'Source'], ['occurredAt', 'Event time'], ['recordedAt', 'Receipt time'], ['owner', 'Owner'], ['status', 'Status'], ['evidenceRefs', 'Supporting references'], ['contradictingRefs', 'Contradicting references']])) +
    section('Tasks and follow-up actions', table(s.tasks, [['title', 'Task'], ['owner', 'Owner'], ['priority', 'Priority'], ['dueAt', 'Due'], ['status', 'Status'], ['completionEvidence', 'Action/evidence'], ['disposition', 'Disposition']])) +
    section('Decisions and alternatives', table(s.decisions, [['title', 'Decision'], ['status', 'Status'], ['decisionMaker', 'Decision maker'], ['rationale', 'Rationale'], ['alternatives', 'Alternatives'], ['evidenceRefs', 'References'], ['supersededBy', 'Replacement ID']])) +
    section('Evidence register and chain of custody', '<p>Hashes verify bytes against recorded digests; they do not establish truth, safety or legal admissibility. Uploaded originals are not included in this report.</p>' + evidence) +
    section('Communications and explicit acknowledgments', table(s.messages, [['time', 'Server time'], ['author', 'Author'], ['body', 'Message'], [r => r.critical ? 'Yes' : 'No', 'Critical'], ['acks', 'Explicit acknowledgments']])) +
    section('Lessons learned and improvement register', lessons) +
    section('Closure, review and handover', fields(s.closure || {}, [['impactSummary', 'Closure impact'], ['residualRisk', 'Unresolved risks/work'], ['recoveryValidation', 'Recovery validation'], ['closedAt', 'Closed at']]) + fields(s.review || {}, [['owner', 'Review owner'], ['dueAt', 'Review due'], ['status', 'Review status'], ['notes', 'Review notes'], ['evidenceRefs', 'Review references']]) + paragraph(s.checkpoint?.body)) +
    section('Chronological incident timeline', table([...s.events].reverse(), [['time', 'Server time'], ['occurredAt', 'Event time'], ['actor', 'Author'], ['title', 'Event'], ['detail', 'Details']])) +
    section('Preserved revision history', table(histories.flatMap(h => (h.history || []).map(r => ({ type: h.type, record: h.title || h.id, revision: r.revision, time: r.supersededAt, actor: r.supersededBy, reason: r.reason }))), [['type', 'Record type'], ['record', 'Record'], ['revision', 'Prior revision'], ['time', 'Superseded at'], ['actor', 'Corrected by'], ['reason', 'Reason']]) + '<details><summary>Expand complete prior revision values</summary><p>All previous values are retained in this HTML. Expand this appendix before printing if the full revision payload is needed.</p><pre>' + esc(JSON.stringify(histories, null, 2)) + '</pre></details>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(s.code)} — Incident report</title><style>
  :root{font:15px/1.5 system-ui,sans-serif;color:#191917;background:#fffdfa}body{max-width:1100px;margin:32px auto;padding:0 24px}h1,h2,h3{font-family:Georgia,serif;line-height:1.15}h1{font-size:34px}h2{font-size:25px;border-bottom:1px solid #b7ad9c;padding-bottom:8px;margin-top:30px}h3{font-size:20px}header{border-bottom:3px solid #82652f;padding-bottom:20px}.classification{font-weight:700;color:#702c25}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}dl div{min-width:0}dt{font-size:13px;font-weight:700;color:#59564f}dd{margin:2px 0 8px}.preserve,pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}th,td{border:1px solid #c8c0b2;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#f5f1e9}article{border:1px solid #d9d0c0;padding:16px;margin:14px 0}pre{font-size:11px;border:1px solid #d9d0c0;padding:12px}footer{margin-top:30px;border-top:1px solid #b7ad9c;padding-top:12px;font-size:12px}@page{size:A4;margin:16mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11pt}h1{font-size:24pt}h2{font-size:18pt;break-after:avoid}h3,h4,dt{break-after:avoid}tr,dl div{break-inside:avoid}thead{display:table-header-group}table{font-size:8pt}article{padding:10px}pre{font-size:7pt}section{margin-bottom:14px}}
  </style></head><body><header><p>AEGIS COMMAND · ${esc(s.code)}</p><h1>${esc(s.title)}</h1><p class="classification">${esc(meta.classification)}</p><p>Snapshot sequence ${s.sequence} · Generated ${esc(meta.generatedAt)} · Requested by ${esc(meta.requestedByName)}</p><p>Export ${esc(meta.id)} · ${meta.format === 'csv' ? 'Scope register only' : 'Full incident record'} · No redactions applied</p></header>${content}<footer>Independent incident documentation. This report records team assessments, not certification of system safety. Verify the downloaded artifact against its companion SHA-256 manifest. No external assets or scripts are required.</footer></body></html>`;
}
function csvCell(value) { let s = show(value); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
export function exportBytes(job) {
  const s = job.snapshot;
  if (job.format === 'html') return Buffer.from(reportHTML(s, job));
  if (job.format === 'json') return Buffer.from(JSON.stringify({ document: { schema: 'aegis-incident-report/v1', id: job.id, classification: job.classification, generatedAt: job.generatedAt, sequence: s.sequence, redactions: [] }, incident: s }, null, 2));
  const columns = ['name', 'assetIdentifier', 'type', 'owner', 'dataCategory', 'sensitivity', 'volume', 'availability', 'exposure', 'exfiltration', 'integrity', 'containment', 'recovery', 'confidence', 'assessedAt', 'evidenceRefs', 'archived'];
  return Buffer.from([columns, ...s.scope.map(r => columns.map(k => r[k]))].map(row => row.map(csvCell).join(',')).join('\r\n'));
}
export function publicExport(job) { const { snapshot, ...visible } = job; return visible; }
export function expireExports(state) {
  for (const job of state.exports) if (Date.parse(job.expiresAt) <= Date.now()) { job.status = 'Expired'; delete job.snapshot; }
}
export function exportCommand(data, state, c, user) {
  requireThat(member(user, state.id) === 'commander', 'Only an assigned commander may request or approve a sensitive export.', 403);
  expireExports(state);
  if (c.kind === 'export-request') {
    requireThat(state.exports.filter(j => j.snapshot).length < 10, 'Expire or cancel existing exports before requesting more.');
    const format = choice(c.format || 'html', ['html', 'json', 'csv'], 'report format'); const now = new Date().toISOString();
    const job = { id: randomUUID(), incidentId: state.id, requestedBy: user.id, requestedByName: user.name, generatedAt: now, expiresAt: new Date(Date.now() + 86400_000).toISOString(), format, filename: state.code + '-report.' + format, classification: state.exercise ? 'Synthetic exercise — restricted response record' : 'Restricted incident response record', status: 'Pending', approvedBy: null, reason: text(c.body, 'Export purpose', { required: true }), snapshot: reportSnapshot(state), redactions: [] };
    job.sequence = job.snapshot.sequence; job.snapshotSha256 = sha256(Buffer.from(JSON.stringify(job.snapshot))); job.sha256 = sha256(exportBytes(job));
    state.exports.push(job); return { title: 'Sensitive report export requested', detail: job.format.toUpperCase() + ' · Snapshot sequence ' + job.sequence };
  }
  const job = state.exports.find(j => j.id === c.exportId); requireThat(job && job.snapshot, 'Export expired or not found.', 404);
  if (c.kind === 'export-approve') {
    requireThat(job.status === 'Pending' && job.requestedBy !== user.id, 'A different assigned commander must approve a pending export.');
    requireThat(data.users.some(u => u.id === job.requestedBy && u.status === 'active' && member(u, state.id) === 'commander'), 'The requester no longer has export permission.');
    job.status = 'Approved'; job.approvedBy = user.id; job.approvedByName = user.name; job.approvedAt = new Date().toISOString(); job.approvalReason = text(c.body, 'Export approval rationale', { required: true });
    return { title: 'Sensitive report export approved', detail: job.id };
  }
  requireThat(c.kind === 'export-cancel', 'Unknown export action.');
  job.status = 'Cancelled'; job.cancelledBy = user.id; job.cancelReason = text(c.body, 'Cancellation reason', { required: true }); delete job.snapshot;
  return { title: 'Report export cancelled', detail: job.id };
}
export function authorizedJob(data, state, jobId, user, preview = false) {
  expireExports(state); const job = state.exports.find(j => j.id === jobId);
  requireThat(member(user, state.id) === 'commander' && job?.snapshot, 'Export not available to this user.', 403);
  const requester = data.users.find(u => u.id === job.requestedBy && u.status === 'active' && member(u, state.id) === 'commander');
  requireThat(requester, 'Requester access has been revoked.', 403);
  if (!preview) {
    requireThat(job.requestedBy === user.id && job.status === 'Approved', 'Only the requester may download an approved export.', 403);
    requireThat(data.users.some(u => u.id === job.approvedBy && u.status === 'active' && member(u, state.id) === 'commander'), 'Approver access has been revoked.', 403);
  }
  requireThat(sha256(exportBytes(job)) === job.sha256, 'Report artifact integrity check failed.', 500); return job;
}
export function exportManifest(job) {
  return { schema: 'aegis-export-manifest/v1', id: job.id, incidentId: job.incidentId, classification: job.classification, generatedAt: job.generatedAt, sequence: job.sequence, scope: job.format === 'csv' ? 'Scope register' : 'Full incident record', redactions: [], filename: job.filename, sha256: job.sha256, snapshotSha256: job.snapshotSha256, requestedBy: job.requestedBy, approvedBy: job.approvedBy, approvedAt: job.approvedAt, expiresAt: job.expiresAt,
    evidence: job.format === 'csv' ? [] : job.snapshot.evidenceRegister.flatMap(e => e.attachments.map(a => ({ evidenceReference: e.reference, attachmentId: a.id, originalFilename: a.filename, bytes: a.size, sha256: a.sha256, disposition: a.status }))) };
}
