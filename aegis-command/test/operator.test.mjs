import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { config } from '../lib/config.mjs';
import { Store } from '../lib/store.mjs';

test('offline operator bootstrap has no reusable account and cannot be repeated', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-operator-'));
  const keyPath = join(root, 'secrets/storage.key');
  const env = { ...process.env, AEGIS_MODE: 'development', AEGIS_ORIGIN: 'http://localhost:8080', AEGIS_KEY_FILE: keyPath, AEGIS_DATABASE: join(root, 'data/vault.sqlite') };
  const run = (...args) => spawnSync(process.execPath, ['scripts/operator.mjs', ...args], { env, encoding: 'utf8' });
  assert.equal(run('keygen', '--out', keyPath).status, 0);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  assert.notEqual(run('keygen', '--out', keyPath).status, 0);
  const args = ['bootstrap', '--first', 'first', '--first-name', 'First Custodian', '--second', 'second', '--second-name', 'Second Custodian'];
  const bootstrap = run(...args); assert.equal(bootstrap.status, 0);
  const invites = JSON.parse(bootstrap.stdout); assert.equal(invites.length, 2);
  assert(invites.every(i => typeof i.token === 'string' && i.token.length === 43));
  assert.notEqual(run(...args).status, 0);
  const renewed = run('renew-bootstrap', '--username', 'second'); assert.equal(renewed.status, 0);
  assert.notEqual(JSON.parse(renewed.stdout).token, invites[1].token);
  const cfg = config(env); const store = new Store(cfg.database, cfg.key);
  try {
    const data = store.read();
    assert.equal(data.users.length, 0); // bootstrap creates invitations, never a usable account
    assert(data.invites.every(i => i.admin && !i.role && !Object.hasOwn(i, 'token')));
    await store.run(current => { current.users = [{ id: 'first' }, { id: 'second' }]; });
  } finally { store.close(); }
  assert.notEqual(run('renew-bootstrap', '--username', 'second').status, 0);
});
