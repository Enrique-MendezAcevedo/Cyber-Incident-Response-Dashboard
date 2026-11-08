import { randomUUID } from 'node:crypto';
import { member, requireThat } from './access.mjs';
import { text, time, choice, revision, revise, sensitivities } from './model.mjs';
export function evidenceById(state, id) {
  const item = state.evidenceRegister.find(e => e.id === id);
  requireThat(item, 'Evidence record not found in this incident.', 404); return item;
}
export function custody(item, user, action, reason, extra = {}) {
  item.custody.push({ id: randomUUID(), time: new Date().toISOString(), actorId: user.id, actor: user.name, action, reason, ...extra });
}
export function evidenceCommand(data, state, c, user) {
  const commander = member(user, state.id) === 'commander';
  const item = c.kind === 'evidence-create' ? null : evidenceById(state, c.entityId);
  if (c.kind === 'evidence-create' || c.kind === 'evidence-update') {
    if (item) revision(item, c.revision);
    const prior = item || {}, v = { ...prior, ...c };
    const values = {
      reference: text(v.reference || 'EV-' + randomUUID().slice(0, 8).toUpperCase(), 'Evidence reference', { required: true, max: 80 }),
      title: text(v.title, 'Evidence title', { required: true, max: 200 }),
      source: text(v.source, 'Evidence source', { required: true, max: 1000 }), collector: text(v.collector || user.name, 'Collector', { required: true, max: 200 }),
      collectedAt: time(v.collectedAt, 'Collection time', { past: true }), unknownTimeReason: text(v.unknownTimeReason, 'Unknown collection time explanation', { max: 2000 }),
      description: text(v.description, 'Evidence description', { required: true }), classification: choice(v.classification || 'Restricted', sensitivities, 'evidence classification'),
      storageReference: text(v.storageReference, 'Original storage/location reference', { required: true, max: 2000 }),
      sourceDigest: text(v.sourceDigest, 'Source SHA-256 digest', { max: 64 }).toLowerCase(), archived: v.archived === true,
    };
    requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(values.reference), 'Use a short evidence ID with letters, numbers, dots, underscores or hyphens.');
    requireThat(!state.evidenceRegister.some(e => e.id !== item?.id && e.reference.toLowerCase() === values.reference.toLowerCase()), 'This evidence reference is already registered.');
    requireThat(values.collectedAt || values.unknownTimeReason, 'Record collection time or explain why it is unknown.');
    requireThat(!values.sourceDigest || /^[a-f0-9]{64}$/.test(values.sourceDigest), 'Source digest must be a 64-character SHA-256 value.');
    if (item) {
      const reason = text(c.body, 'Evidence correction rationale', { required: true });
      if (['sourceDigest', 'source', 'classification', 'storageReference'].some(k => values[k] !== item[k])) {
        for (const attachment of item.attachments.filter(a => a.status === 'Approved for controlled download')) {
          revise(attachment, { status: 'Quarantined' }, user, 'Evidence provenance or classification changed; review again.');
          custody(item, user, 'Original returned to quarantine', reason, { attachmentId: attachment.id });
        }
      }
      revise(item, values, user, reason); custody(item, user, 'Metadata corrected', reason);
    } else {
      const created = { ...values, id: randomUUID(), revision: 1, history: [], attachments: [], custody: [], recordedAt: new Date().toISOString(), recordedBy: user.id, recordedByName: user.name };
      custody(created, user, 'Registered', 'Source and collection provenance recorded.'); state.evidenceRegister.push(created);
    }
    return { title: item ? 'Evidence record corrected' : 'Evidence registered', detail: values.reference + ' · ' + values.title };
  }
  if (c.kind === 'evidence-custody') {
    const reason = text(c.body, 'Custody event details', { required: true });
    const action = choice(c.action, ['Collected', 'Received', 'Transferred', 'Analyzed', 'Released'], 'custody event');
    if (['Transferred', 'Released'].includes(action)) requireThat(commander, 'A commander acting as evidence custodian must record transfers or release.', 403);
    custody(item, user, action, reason, { occurredAt: time(c.occurredAt, 'Custody event time', { required: true, past: true }), from: text(c.from, 'From person/location', { required: action === 'Transferred', max: 500 }), to: text(c.to, 'To person/location', { required: ['Transferred', 'Released'].includes(action), max: 500 }) });
    return { title: 'Evidence custody event recorded', detail: item.reference + ' · ' + action };
  }
  if (c.kind === 'evidence-review') {
    requireThat(commander, 'Commander/custodian access required.', 403);
    const attachment = item.attachments.find(a => a.id === c.attachmentId);
    requireThat(attachment && !item.archived, 'Active evidence attachment not found.', 404);
    const status = choice(c.status, ['Quarantined', 'Approved for controlled download', 'Rejected'], 'attachment disposition');
    if (status === 'Approved for controlled download') {
      requireThat(attachment.uploadedBy !== user.id, 'A different commander must review an uploaded original.');
      requireThat(!item.sourceDigest || item.sourceDigest === attachment.sha256, 'Source digest does not match this attachment. Correct the source record or reject the original.');
    }
    const reason = text(c.body, 'Review justification', { required: true });
    revise(attachment, { status, reviewedBy: user.id, reviewedAt: new Date().toISOString(), reviewReason: reason }, user, reason);
    custody(item, user, 'Attachment disposition: ' + status, reason, { attachmentId: attachment.id, sha256: attachment.sha256 });
    return { title: 'Evidence attachment reviewed', detail: item.reference + ' · ' + status };
  }
  requireThat(false, 'Unknown evidence action.');
}
