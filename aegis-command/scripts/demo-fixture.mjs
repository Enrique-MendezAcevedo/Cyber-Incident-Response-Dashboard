import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { INCIDENT } from '../lib/access.mjs';
import { mutate } from '../lib/incident.mjs';
import { sha256 } from '../lib/blobs.mjs';
import { audit } from '../lib/store.mjs';
export const demoPeople = [
  { username: 'maya', name: 'Maya Chen', role: 'commander', admin: true },
  { username: 'alex', name: 'Alex Rivera', role: 'responder', admin: false },
  { username: 'jordan', name: 'Jordan Lee', role: 'commander', admin: true },
  { username: 'olivia', name: 'Olivia Park', role: 'observer', admin: false },
];
export async function prepareFixture(app, cfg, runRoot) {
  if (!cfg.rehearsal || !cfg.development) throw new Error('Demo fixtures are restricted to the explicit localhost rehearsal profile.');
  const past = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
  const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();
  const original = Buffer.from(`SYNTHETIC EXERCISE — NOT REAL CUSTOMER DATA\n${past(35)} gateway-egress volume=customer-prod destination=198.51.100.24 bytes=1843200\n${past(34)} alert=unusual-transfer classification=unconfirmed\n`);
  const fixtures = join(runRoot, 'sample-evidence'); mkdirSync(fixtures, { recursive: true, mode: 0o700 });
  writeFileSync(join(fixtures, 'gateway-transfer.log'), original, { mode: 0o600 });
  writeFileSync(join(fixtures, 'restore-validation.txt'), 'SYNTHETIC EXERCISE\nApplication checks passed. Dataset hashes matched the clean recovery baseline. Exposure assessment remains open.\n', { mode: 0o600 });
  await app.store.run(data => {
    const maya = data.users.find(u => u.username === 'maya'), alex = data.users.find(u => u.username === 'alex');
    const s = data.incidents[INCIDENT]; s.commanderId = maya.id; s.commanderName = maya.name; s.exercise = true;
    const send = (user, fields) => mutate(data, { id: randomUUID(), ...fields }, user, INCIDENT);
    send(maya, { kind: 'incident', revision: s.revision, title: 'Northbridge ransomware', severity: 'Critical', severityRationale: 'Synthetic customer-service outage with suspected data exposure', summary: 'Customer records are locked by ransomware. An unusual outbound transfer is under investigation. Responders are coordinating on the separate response enclave.', discoveredAt: past(60), reportedAt: past(55), category: 'Ransomware', source: 'Synthetic endpoint and gateway observations', businessImpact: 'Customer portal unavailable; billing exports degraded. No real organization or customer data is involved.', affectedServices: ['Customer portal', 'Billing exports'], sourceTimezone: 'UTC', nextReviewAt: future(30), body: 'Prepared a fresh, explicitly synthetic tabletop scenario.' });
    for (let i = 0; i < s.scope.length; i++) {
      const row = s.scope[i];
      send(alex, { kind: 'scope', entityId: row.id, revision: row.revision, name: row.name, assetIdentifier: ['customer-prod', 'billing-exports', 'identity-directory'][i], owner: row.owner, environment: 'Synthetic production', dataCategory: ['Customer PII (synthetic)', 'Financial exports (synthetic)', 'Account metadata (synthetic)'][i], sensitivity: 'Restricted', confidence: i === 0 ? 'Moderate' : 'Unknown', unknownReason: 'Exposure, integrity and inventory assessments remain under review.', assessedAt: past(20), remediationOwnerId: alex.id, evidenceRefs: i === 0 ? ['EV-ENDPOINT', row.evidence] : [row.evidence], body: row.reason });
    }
    const taskPresentation = [
      { priority: 'Critical', status: 'In progress', description: 'Validate the recovery baseline before returning the customer portal to service.' },
      { priority: 'High', status: 'Blocked', description: 'Waiting for the isolated gateway file manifest to reconcile the outbound transfer.' },
      { priority: 'Normal', status: 'Open', description: 'Identify affected export jobs and record the quantity that remains unknown.' },
    ];
    for (const [index, task] of s.tasks.filter(t => !t.systemKind).entries()) {
      const owner = task.owner === 'Maya Chen' ? maya : alex;
      send(maya, { kind: 'task-update', entityId: task.id, revision: task.revision, ownerId: owner.id, dueAt: future(40 + index * 20), ...taskPresentation[index], body: 'Assigned priorities, dependencies and deadlines for the live rehearsal.' });
    }
    send(alex, { kind: 'evidence-create', reference: 'EV-014', title: 'Outbound gateway transfer summary', source: 'Synthetic gateway collector', collector: alex.name, collectedAt: past(30), description: 'Synthetic network log supporting the investigation of an unusual transfer. It does not confirm exfiltration contents.', classification: 'Restricted', storageReference: 'Response kit / synthetic gateway log', sourceDigest: sha256(original) });
    send(alex, { kind: 'evidence-create', reference: 'EV-011', title: 'Billing export job records', source: 'Synthetic scheduler export', collector: alex.name, collectedAt: past(25), description: 'Synthetic job failure metadata retained in the exercise kit.', classification: 'Internal', storageReference: 'Response kit / billing job log reference' });
    send(alex, { kind: 'evidence-create', reference: 'EV-ENDPOINT', title: 'Endpoint encryption observation', source: 'Synthetic endpoint collector', collector: alex.name, collectedAt: past(50), description: 'Synthetic endpoint observation documenting encryption on the customer volume.', classification: 'Restricted', storageReference: 'Response kit / endpoint encryption observation' });
    send(alex, { kind: 'evidence-create', reference: 'EV-009', title: 'Service account change log', source: 'Synthetic identity collector', collector: alex.name, collectedAt: past(25), description: 'Synthetic account changes retained for the separate integrity assessment.', classification: 'Restricted', storageReference: 'Response kit / service account log reference' });
    send(alex, { kind: 'finding-create', type: 'Confirmed fact', title: 'Customer volume encryption observed', description: 'The synthetic endpoint exercise records show the customer volume is locked.', source: 'Synthetic endpoint observation', occurredAt: past(60), ownerId: alex.id, status: 'Open', evidenceRefs: ['EV-ENDPOINT'], contradictingRefs: [] });
    send(maya, { kind: 'finding-create', type: 'Hypothesis', title: 'Outbound transfer may contain customer records', description: 'Transfer contents have not been reconciled with the synthetic file manifest.', source: 'Synthetic gateway collector', occurredAt: past(35), ownerId: maya.id, status: 'Open', reviewAt: future(30), evidenceRefs: ['EV-014'], contradictingRefs: [] });
    send(maya, { kind: 'decision-create', title: 'Approve phased return to service', status: 'Pending', decisionMakerId: maya.id, rationale: 'Require clean restore validation while preserving the separate exposure investigation.', alternatives: 'Keep the customer portal fully offline until all investigations conclude.', reviewAt: future(30), evidenceRefs: ['EV-014'] });
    send(alex, { kind: 'lesson-create', title: 'Rehearse the independent responder kit monthly', category: 'Process', observation: 'The synthetic response team moved to a separate identity and network environment.', impact: 'Incident coordination continued without corporate SSO or email.', recommendation: 'Run a scheduled clean-device and key-enrollment rehearsal.', ownerId: alex.id, status: 'Open', actionRequired: true, actionTitle: 'Schedule the next clean-device response exercise', actionDueAt: future(7 * 24 * 60), evidenceRefs: ['EV-014'] });
    audit(data, 'offline-demo-fixture', 'synthetic.rehearsal.prepared', INCIDENT);
  });
  return { original, fixtures };
}
