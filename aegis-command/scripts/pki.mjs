import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireThat } from '../lib/access.mjs';
process.umask(0o077);
const [command, directory, ...args] = process.argv.slice(2);
requireThat(directory, 'Usage: node scripts/pki.mjs <init-ca|server-request|device-request|sign-server|sign-device|export-device|fingerprint> <directory> [arguments]');
const dir = resolve(directory); mkdirSync(dir, { recursive: true, mode: 0o700 });
const path = name => resolve(dir, name);
function openssl(...parameters) { const result = spawnSync('openssl', parameters, { stdio: 'inherit' }); requireThat(result.status === 0, 'OpenSSL command failed.'); }
function unused(...names) { for (const name of names) requireThat(!existsSync(path(name)), 'Refusing to overwrite ' + name); }
if (command === 'init-ca') {
  unused('ca.key', 'ca.crt');
  const label = args[0] || 'Aegis Independent Root'; requireThat(/^[a-zA-Z0-9 ._-]{1,80}$/.test(label), 'Invalid root label.');
  openssl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-aes-256-cbc', '-out', path('ca.key'));
  openssl('req', '-x509', '-new', '-key', path('ca.key'), '-sha256', '-days', '3650', '-subj', '/CN=' + label, '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', path('ca.crt'));
} else if (['server-request', 'device-request'].includes(command)) {
  const server = command === 'server-request'; const label = args[0];
  requireThat(server ? /^[a-z0-9][a-z0-9.-]{0,250}$/.test(label || '') : /^[a-zA-Z0-9._-]{1,80}$/.test(label || ''), 'Provide a DNS hostname or device label.');
  unused('identity.key', 'identity.csr');
  openssl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', path('identity.key'));
  openssl('req', '-new', '-key', path('identity.key'), '-subj', '/CN=' + label, '-out', path('identity.csr'));
} else if (['sign-server', 'sign-device'].includes(command)) {
  const [csr, output, hostname] = args; const server = command === 'sign-server';
  requireThat(csr && output && !existsSync(output), 'Provide CSR path and a new output certificate path.');
  if (server) requireThat(/^[a-z0-9][a-z0-9.-]{0,250}$/.test(hostname || ''), 'Provide the exact server DNS hostname.');
  const extensions = ['basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=' + (server ? 'serverAuth' : 'clientAuth'), ...(server ? ['subjectAltName=DNS:' + hostname] : [])];
  writeFileSync(path('signing.ext'), extensions.join('\n'), { mode: 0o600 });
  openssl('x509', '-req', '-in', resolve(csr), '-CA', path('ca.crt'), '-CAkey', path('ca.key'), '-CAcreateserial', '-days', '90', '-sha256', '-extfile', path('signing.ext'), '-out', resolve(output));
} else if (command === 'export-device') {
  requireThat(args[0], 'Provide device CA certificate path.'); unused('device.p12');
  openssl('pkcs12', '-export', '-inkey', path('identity.key'), '-in', path('identity.crt'), '-certfile', resolve(args[0]), '-out', path('device.p12'));
} else if (command === 'fingerprint') openssl('x509', '-in', path('identity.crt'), '-noout', '-fingerprint', '-sha256');
else requireThat(false, 'Unknown PKI command.');
