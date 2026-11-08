import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, lstatSync, chmodSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { Store, seal, unseal, audit } from './store.mjs';
import { BlobStore, sha256, MAX_UPLOAD } from './blobs.mjs';
import { normalize } from './model.mjs';
import { requireThat } from './access.mjs';
function references(data) { return Object.values(data.incidents).flatMap(s => s.evidenceRegister.flatMap(e => e.attachments.map(a => ({ incidentId: s.id, evidenceId: e.id, attachment: a })))); }
function readPrivate(path, maximum) {
  const stat = lstatSync(path); requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'Invalid or oversized backup component.'); return readFileSync(path);
}
export async function backup(cfg, destination) {
  requireThat(destination, 'Supply backup --out /independent-storage/new-backup-directory');
  requireThat(existsSync(cfg.database), 'Source vault does not exist. Configure AEGIS_DATABASE before taking a backup.');
  const root = resolve(destination); requireThat(!existsSync(root), 'Backup output must be a new directory.');
  requireThat(!root.startsWith(dirname(cfg.database) + '/'), 'Keep backups outside the active data directory.');
  const store = new Store(cfg.database, cfg.key), blobs = new BlobStore(cfg.evidenceRoot, cfg.key);
  try {
    return await store.run(data => {
      const snapshot = structuredClone(data); const manifest = { schema: 'aegis-backup/v1', createdAt: new Date().toISOString(), vaultSha256: '', attachments: [] };
      // Verify every referenced original before claiming a consistent backup.
      for (const ref of references(snapshot)) blobs.get(ref.attachment, ref.incidentId, ref.evidenceId);
      mkdirSync(join(root, 'objects'), { recursive: true, mode: 0o700 }); chmodSync(root, 0o700);
      const encrypted = seal(snapshot, cfg.key); manifest.vaultSha256 = sha256(encrypted);
      writeFileSync(join(root, 'vault.aegis'), encrypted, { mode: 0o600, flag: 'wx', flush: true });
      for (const ref of references(snapshot)) {
        const original = readPrivate(blobs.path(ref.attachment.id), MAX_UPLOAD + 32);
        writeFileSync(join(root, 'objects', ref.attachment.id + '.agcm'), original, { mode: 0o600, flag: 'wx', flush: true });
        manifest.attachments.push({ id: ref.attachment.id, ciphertextSha256: sha256(original) });
      }
      writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx', flush: true });
      audit(data, 'offline-custodians', 'backup.created', { createdAt: manifest.createdAt, attachmentCount: manifest.attachments.length });
      return { path: root, createdAt: manifest.createdAt, attachmentCount: manifest.attachments.length, note: 'The storage key is intentionally absent. Keep its recovery copy separately.' };
    });
  } finally { store.close(); }
}
export function restore(cfg, source, authorizationReviewed) {
  requireThat(source, 'Supply restore --from /backup/directory');
  requireThat(authorizationReviewed, 'Restore requires --acknowledge-authorization-rollback: review and reapply access revocations made since the backup before exposing the service.');
  requireThat(!existsSync(cfg.database) && !existsSync(cfg.evidenceRoot), 'Restore only into a fresh database and evidence directory. Existing data is never overwritten.');
  const root = resolve(source), manifest = JSON.parse(readPrivate(join(root, 'manifest.json'), 1024 * 1024));
  requireThat(manifest.schema === 'aegis-backup/v1' && Array.isArray(manifest.attachments), 'Unsupported backup manifest.');
  const encrypted = readPrivate(join(root, 'vault.aegis'), 128 * 1024 * 1024);
  requireThat(sha256(encrypted) === manifest.vaultSha256, 'Backup vault digest mismatch.');
  const data = normalize(unseal(encrypted, cfg.key));
  const expected = references(data); requireThat(expected.length === manifest.attachments.length, 'Backup evidence manifest is incomplete.');
  const sourceBlobs = new BlobStore(join(root, 'objects'), cfg.key, { readOnly: true });
  for (const ref of expected) {
    const entry = manifest.attachments.find(a => a.id === ref.attachment.id);
    requireThat(entry, 'A referenced original is missing from the backup manifest.');
    const original = readPrivate(sourceBlobs.path(entry.id), MAX_UPLOAD + 32);
    requireThat(sha256(original) === entry.ciphertextSha256, 'Backup attachment ciphertext digest mismatch.');
    sourceBlobs.get(ref.attachment, ref.incidentId, ref.evidenceId);
  }
  // All source checks pass before any target database is created.
  const targetBlobs = new BlobStore(cfg.evidenceRoot, cfg.key);
  for (const ref of expected) { copyFileSync(sourceBlobs.path(ref.attachment.id), targetBlobs.path(ref.attachment.id)); chmodSync(targetBlobs.path(ref.attachment.id), 0o600); }
  data.sessions = []; data.invites.forEach(i => { i.used = true; }); data.approvals.forEach(p => { p.done = true; });
  for (const user of data.users) user.version++;
  audit(data, 'offline-custodians', 'backup.restored', { backupCreatedAt: manifest.createdAt, sessionsRevoked: true, authorizationRollbackAcknowledged: true });
  const target = new Store(cfg.database, cfg.key); try { target.save(data); } finally { target.close(); }
  return { database: cfg.database, attachmentCount: expected.length, note: 'All sessions and invitations revoked. Review restored access grants against the latest independent revocation record before service activation.' };
}
