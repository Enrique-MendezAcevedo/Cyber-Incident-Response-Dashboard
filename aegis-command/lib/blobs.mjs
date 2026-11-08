import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, lstatSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireThat } from './access.mjs';
export const MAX_UPLOAD = 5 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export class BlobStore {
  constructor(root, key, { readOnly = false } = {}) {
    this.root = root; this.key = Buffer.from(hkdfSync('sha256', key, Buffer.from('aegis'), Buffer.from('evidence:v1'), 32));
    if (readOnly) requireThat(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Invalid evidence object directory.');
    else mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  path(id) { requireThat(/^[a-f0-9-]{36}$/.test(id), 'Invalid attachment ID.'); return join(this.root, id + '.agcm'); }
  put(bytes, incidentId, evidenceId) {
    requireThat(bytes.length > 0 && bytes.length <= MAX_UPLOAD, 'Evidence file must be between 1 byte and 5 MiB.', 413);
    const used = readdirSync(this.root).filter(n => n.endsWith('.agcm')).reduce((n, name) => n + statSync(join(this.root, name)).size, 0);
    requireThat(used + bytes.length + 32 <= 100 * 1024 * 1024, 'Evidence storage budget is full; use an external storage reference.', 507);
    const id = randomUUID(), nonce = randomBytes(12), aad = Buffer.from(incidentId + ':' + evidenceId + ':' + id);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    writeFileSync(this.path(id), Buffer.concat([Buffer.from('AEG1'), nonce, cipher.getAuthTag(), ciphertext]), { flag: 'wx', mode: 0o600, flush: true });
    return { id, size: bytes.length, sha256: sha256(bytes) };
  }
  get(attachment, incidentId, evidenceId) {
    requireThat(statSync(this.path(attachment.id)).size <= MAX_UPLOAD + 32, 'Stored attachment exceeds its size limit.', 500);
    const bytes = readFileSync(this.path(attachment.id)); requireThat(bytes.subarray(0, 4).toString() === 'AEG1', 'Invalid encrypted attachment.', 500);
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(4, 16));
    decipher.setAAD(Buffer.from(incidentId + ':' + evidenceId + ':' + attachment.id)); decipher.setAuthTag(bytes.subarray(16, 32));
    const original = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]);
    requireThat(original.length === attachment.size && sha256(original) === attachment.sha256, 'Evidence integrity verification failed.', 500); return original;
  }
}
