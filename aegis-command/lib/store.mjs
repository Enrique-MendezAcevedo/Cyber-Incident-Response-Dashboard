import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { normalize } from './model.mjs';

const aad = Buffer.from('aegis-command:store:v1');
export function seal(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
}
export function unseal(bytes, key) {
  bytes = Buffer.from(bytes);
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
}
export function audit(data, actorId, action, target = null) {
  const priorHash = data.audit.at(-1)?.hash || '0'.repeat(64);
  const event = { sequence: data.audit.length + 1, time: new Date().toISOString(), actorId, action, target, priorHash };
  event.hash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  data.audit.push(event);
}
export class Store {
  constructor(path, key) {
    this.key = key;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK(id=1), payload BLOB NOT NULL) STRICT;');
    // No plaintext incident/authentication data enters SQLite, including its journal.
    this.tail = Promise.resolve();
  }
  initial() {
    const incident = JSON.parse(readFileSync(new URL('../web/scenario.json', import.meta.url), 'utf8'));
    incident.id = 'IR-2026-017'; incident.requests = [];
    return normalize({ version: 1, users: [], devices: [], invites: [], sessions: [], approvals: [], audit: [], incident });
  }
  read() {
    const row = this.db.prepare('SELECT payload FROM vault WHERE id=1').get();
    if (!row) return this.initial();
    const data = unseal(row.payload, this.key), oldVersion = data.version;
    normalize(data);
    if (oldVersion !== data.version) audit(data, 'system', 'schema.migrated', { from: oldVersion, to: data.version });
    return data;
  }
  save(data) { this.db.prepare('INSERT INTO vault(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(seal(data, this.key)); }
  run(fn) {
    const result = this.tail.then(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const data = this.read(); const result = await fn(data); this.save(data); this.db.exec('COMMIT'); return result; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
    this.tail = result.catch(() => {}); return result;
  }
  close() { this.db.close(); }
}
