import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { isIP } from 'node:net';

export function config(env = process.env) {
  const development = env.AEGIS_MODE === 'development';
  const rehearsal = env.AEGIS_REHEARSAL === '1';
  if (rehearsal && !development) throw new Error('Synthetic rehearsal is restricted to localhost development mode.');
  const origin = env.AEGIS_ORIGIN || (development ? 'http://localhost:8080' : '');
  const url = new URL(origin);
  if (origin !== url.origin || url.username || url.password) throw new Error('AEGIS_ORIGIN must be an exact origin without a trailing slash.');
  if (!development && url.protocol !== 'https:') throw new Error('Production requires HTTPS.');
  if (!development && isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Use an independently resolved DNS hostname for WebAuthn, not an IP address.');
  if (development && (url.protocol !== 'http:' || url.hostname !== 'localhost')) throw new Error('Development requires an http://localhost origin.');
  if (development && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Development is restricted to localhost.');
  const host = env.AEGIS_HOST || '127.0.0.1';
  if (development && !['127.0.0.1', '::1'].includes(host)) throw new Error('Development cannot bind to the network.');
  const port = Number(env.PORT || url.port || (development ? 8080 : 8443));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  if (!env.AEGIS_KEY_FILE) throw new Error('AEGIS_KEY_FILE is required; create a separate 32-byte key with the operator CLI.');
  const keyPath = resolve(env.AEGIS_KEY_FILE);
  const keyStat = statSync(keyPath);
  if (!keyStat.isFile() || (keyStat.mode & 0o077)) throw new Error('Storage key must be a private file (chmod 600).');
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Storage key must contain exactly 32 random bytes.');
  const database = resolve(env.AEGIS_DATABASE || 'runtime/aegis.sqlite');
  if (keyPath === database || keyPath.startsWith(resolve(database, '..') + '/')) throw new Error('Store the encryption key outside the database directory.');
  const tls = development ? undefined : {
    key: readFileSync(env.AEGIS_TLS_KEY), cert: readFileSync(env.AEGIS_TLS_CERT),
    ca: readFileSync(env.AEGIS_DEVICE_CA), minVersion: 'TLSv1.3',
    requestCert: true, rejectUnauthorized: true,
    // Keep resumption short. The application checks certificate identity,
    // validity and current admission status again on every HTTP request.
    sessionTimeout: 1,
  };
  const evidenceRoot = resolve(env.AEGIS_EVIDENCE_DIR || resolve(dirname(database), 'evidence'));
  if (keyPath.startsWith(evidenceRoot + '/')) throw new Error('Keep the storage key outside evidence storage.');
  return { development, rehearsal, origin, rpID: url.hostname, host, port, key, database, evidenceRoot, tls,
    idleMs: 15 * 60_000, absoluteMs: 12 * 60 * 60_000, recentMs: 5 * 60_000 };
}
