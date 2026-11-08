import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../lib/config.mjs';
import { Store, audit } from '../lib/store.mjs';
import { newInvite, requireThat } from '../lib/access.mjs';
import { backup, restore } from '../lib/backup.mjs';
process.umask(0o077);
const [command, ...args] = process.argv.slice(2);
function option(name) { const index = args.indexOf('--' + name); return index < 0 ? undefined : args[index + 1]; }
if (command === 'keygen') {
  const out = option('out'); requireThat(out, 'Use keygen --out /separate/secret/storage.key');
  mkdirSync(dirname(resolve(out)), { recursive: true, mode: 0o700 });
  writeFileSync(out, randomBytes(32), { flag: 'wx', mode: 0o600 });
  console.log('Created private storage key. Keep a separately controlled recovery copy.');
} else {
  const cfg = config();
  if (command === 'backup') { console.log(JSON.stringify(await backup(cfg, option('out')), null, 2)); process.exit(0); }
  if (command === 'restore') { console.log(JSON.stringify(restore(cfg, option('from'), args.includes('--acknowledge-authorization-rollback')), null, 2)); process.exit(0); }
  const store = new Store(cfg.database, cfg.key);
  try {
    const result = await store.run(data => {
      if (command === 'bootstrap') {
        requireThat(!data.users.length && !data.invites.length, 'Bootstrap is one-time only.');
        const first = { username: option('first'), name: option('first-name'), fingerprint: option('first-device') };
        const second = { username: option('second'), name: option('second-name'), fingerprint: option('second-device') };
        requireThat(first.username !== second.username && first.name !== second.name, 'Two distinct named custodians are required.');
        audit(data, 'offline-custodians', 'bootstrap.started');
        return [first, second].map(person => newInvite(data, person, 'offline-custodians', cfg, { admin: true }));
      }
      if (command === 'renew-bootstrap') {
        requireThat(data.users.length < 2, 'Bootstrap recovery is disabled after two accounts enroll.');
        const invite = data.invites.find(i => i.username === option('username') && i.admin && i.createdBy === 'offline-custodians' && !i.used);
        requireThat(invite, 'Pending bootstrap custodian not found.');
        invite.used = true;
        return newInvite(data, { ...invite, fingerprint: invite.device }, 'offline-custodians', cfg, { admin: true });
      }
      if (command === 'audit-checkpoint') return { sequence: data.audit.length, hash: data.audit.at(-1)?.hash || null, createdAt: new Date().toISOString() };
      requireThat(false, 'Commands: keygen, bootstrap, renew-bootstrap, audit-checkpoint, backup, restore.');
    });
    // Invitation secrets are printed only here or once to the requesting administrator.
    console.log(JSON.stringify(result, null, 2));
  } finally { store.close(); }
}
