import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { config } from '../lib/config.mjs';
import { createApp } from '../server.mjs';
import { newInvite, INCIDENT } from '../lib/access.mjs';
import { seal, unseal } from '../lib/store.mjs';
import { sha256 } from '../lib/blobs.mjs';
import { backup } from '../lib/backup.mjs';
import { chromePath, virtualKey, enrollPage, loginPage } from './browser-kit.mjs';
import { demoPeople, prepareFixture } from './demo-fixture.mjs';

export async function startDemo({ headless = false, port = 8080, resume } = {}) {
  process.umask(0o077); const executablePath = chromePath();
  const runRoot = resume ? resolve(resume) : resolve('runtime/demo-runs', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  const marker = join(runRoot, 'demo.json'), keyFile = join(runRoot, 'secrets/storage.key');
  if (resume) {
    if (!existsSync(marker) || JSON.parse(readFileSync(marker)).kind !== 'aegis-synthetic-rehearsal') throw new Error('Resume accepts only a prior synthetic demo run directory.');
  } else {
    mkdirSync(join(runRoot, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ kind: 'aegis-synthetic-rehearsal', createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  }
  const cfg = config({ AEGIS_MODE: 'development', AEGIS_REHEARSAL: '1', AEGIS_ORIGIN: 'http://localhost:' + port, AEGIS_HOST: '127.0.0.1', PORT: String(port), AEGIS_KEY_FILE: keyFile, AEGIS_DATABASE: join(runRoot, 'data/aegis.sqlite') });
  let app = await createApp(cfg), browser, closing = false;
  const profiles = new Map();
  const keyCachePath = join(runRoot, 'secrets/virtual-keys.aegis');
  const cache = resume ? unseal(readFileSync(keyCachePath), cfg.key) : {};
  try {
    await new Promise((done, reject) => { app.server.once('error', reject); app.server.listen(cfg.port, cfg.host, done); });
    cfg.port = app.server.address().port; cfg.origin = 'http://localhost:' + cfg.port;
    const environment = { AEGIS_MODE: 'development', AEGIS_REHEARSAL: '1', AEGIS_ORIGIN: cfg.origin, AEGIS_HOST: cfg.host, PORT: String(cfg.port), AEGIS_DATABASE: cfg.database, AEGIS_EVIDENCE_DIR: cfg.evidenceRoot, AEGIS_KEY_FILE: keyFile };
    writeFileSync(join(runRoot, 'demo.env'), Object.entries(environment).map(([name, value]) => name + '=' + JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
    browser = await chromium.launch({ executablePath, headless, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-default-browser-check'] });
    const invitations = resume ? [] : await app.store.run(data => demoPeople.map(p => newInvite(data, p, 'offline-demo-custodians', cfg, { admin: p.admin })));
    for (let i = 0; i < demoPeople.length; i++) {
      const person = demoPeople[i], context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      const page = await context.newPage(), device = await virtualKey(context, page);
      if (resume) {
        const user = app.store.read().users.find(u => u.username === person.username);
        if (!user || user.status !== 'active') throw new Error('Restore the demo account access first, or start a new rehearsal.');
        for (const credential of cache[person.username] || []) {
          const stored = user.credentials.find(c => c.id === Buffer.from(credential.credentialId, 'base64').toString('base64url'));
          if (stored) await device.cdp.send('WebAuthn.addCredential', { authenticatorId: device.authenticatorId, credential: { ...credential, signCount: stored.counter + 1 } });
        }
      }
      await page.goto(cfg.origin);
      if (resume) await loginPage(page, person.username); else await enrollPage(page, invitations[i].token);
      profiles.set(person.username, { ...person, page, context, ...device });
    }
    if (!resume) {
      const { original } = await prepareFixture(app, cfg, runRoot);
      const alex = profiles.get('alex').page;
      const uploaded = await alex.evaluate(async ({ bytes, origin, requestId }) => {
        const me = await fetch('/api/v1/me').then(r => r.json()), state = await fetch('/api/v1/incidents/IR-2026-017').then(r => r.json());
        const evidence = state.evidenceRegister.find(e => e.reference === 'EV-014');
        const response = await fetch(`/api/v1/incidents/IR-2026-017/evidence/${evidence.id}/attachments`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': me.csrf, 'X-Aegis-File-Name': 'gateway-transfer.log', 'X-Submission-ID': requestId }, body: new Uint8Array(bytes) });
        return { status: response.status, body: await response.json() };
      }, { bytes: [...original], origin: cfg.origin, requestId: randomUUID() });
      if (uploaded.status !== 200) throw new Error('Demo attachment preparation failed: ' + JSON.stringify(uploaded.body));
    }
    const saveKeys = async () => {
      for (const [name, profile] of profiles) {
        try { cache[name] = (await profile.cdp.send('WebAuthn.getCredentials', { authenticatorId: profile.authenticatorId })).credentials; } catch { /* retain the previous encrypted rehearsal credential copy */ }
      }
      writeFileSync(keyCachePath, seal(cache, cfg.key), { mode: 0o600, flush: true });
    };
    await saveKeys();
    for (const profile of profiles.values()) { await profile.page.reload(); await profile.page.getByRole('heading', { name: 'Northbridge ransomware', exact: true }).waitFor(); }
    await profiles.get('maya').page.bringToFront();
    return { cfg, runRoot, profiles, get app() { return app; }, browser, saveKeys,
      async restart() {
        await saveKeys(); await app.close(); app = await createApp(cfg);
        await new Promise((done, reject) => { app.server.once('error', reject); app.server.listen(cfg.port, cfg.host, done); });
      },
      async stop() { if (closing) return; closing = true; await saveKeys(); await browser.close(); await app.close(); },
    };
  } catch (error) { if (browser) await browser.close(); await app.close(); throw error; }
}

export async function demoSmoke(demo) {
  const { profiles, runRoot } = demo, maya = profiles.get('maya').page, jordan = profiles.get('jordan').page;
  const errors = [], external = [];
  for (const p of profiles.values()) { p.page.on('pageerror', e => errors.push(e.message)); p.page.on('request', r => { if (!r.url().startsWith(demo.cfg.origin)) external.push(r.url()); }); }
  await maya.getByRole('button', { name: 'Evidence', exact: true }).click();
  await maya.getByRole('heading', { name: 'EV-014 · Outbound gateway transfer summary' }).waitFor();
  await maya.screenshot({ path: join(runRoot, 'evidence.png'), fullPage: true });
  await maya.getByRole('button', { name: 'Review', exact: true }).click();
  await maya.getByRole('button', { name: 'Request incident report', exact: true }).click();
  await maya.locator('#edit-form [name=body]').fill('Synthetic judge walkthrough and after-action record');
  await maya.getByRole('button', { name: 'Request report approval', exact: true }).click();
  await Promise.race([maya.locator('#editor').waitFor({ state: 'hidden' }), maya.locator('#editor').getByRole('button', { name: 'Verify key again', exact: true }).waitFor()]);
  if (await maya.locator('#editor').isVisible()) {
    await maya.locator('#editor').getByRole('button', { name: 'Verify key again', exact: true }).click();
    await maya.getByText('Key verified. Retry the same save; your draft is preserved.', { exact: true }).waitFor();
    await maya.getByRole('button', { name: 'Request report approval', exact: true }).click();
  }
  await maya.locator('#editor').waitFor({ state: 'hidden' });
  await jordan.getByRole('button', { name: 'Review', exact: true }).click();
  await jordan.getByRole('button', { name: 'Approve report as second commander', exact: true }).waitFor();
  const previewReady = jordan.context().waitForEvent('page'); await jordan.getByRole('link', { name: 'Preview requested report', exact: true }).click();
  const preview = await previewReady; await preview.waitForLoadState(); await preview.getByRole('heading', { name: 'Lessons learned and improvement register' }).waitFor();
  await preview.screenshot({ path: join(runRoot, 'report-preview.png'), fullPage: true }); await preview.close();
  await jordan.getByRole('button', { name: 'Approve report as second commander', exact: true }).click();
  await jordan.locator('#edit-form [name=body]').fill('Reviewed the synthetic report snapshot and approved controlled demonstration export');
  await jordan.getByRole('button', { name: 'Approve report', exact: true }).click(); await jordan.locator('#editor').waitFor({ state: 'hidden' });
  const downloadReady = maya.waitForEvent('download'); await maya.getByRole('link', { name: 'Download approved report', exact: true }).click();
  const download = await downloadReady, reportPath = join(runRoot, download.suggestedFilename()); await download.saveAs(reportPath);
  const manifestReady = maya.waitForEvent('download'); await maya.getByRole('link', { name: 'Download verification manifest', exact: true }).click();
  const manifest = await manifestReady, manifestPath = join(runRoot, manifest.suggestedFilename()); await manifest.saveAs(manifestPath);
  if (sha256(readFileSync(reportPath)) !== JSON.parse(readFileSync(manifestPath)).sha256) throw new Error('Downloaded report manifest mismatch.');
  await maya.screenshot({ path: join(runRoot, 'review.png'), fullPage: true });
  const before = demo.app.store.read().incidents[INCIDENT].sequence; await demo.restart();
  await maya.locator('.rail [data-page=Incidents]').click(); await maya.getByRole('button', { name: 'Refresh incidents', exact: true }).click();
  if (demo.app.store.read().incidents[INCIDENT].sequence !== before) throw new Error('Restart changed committed incident data.');
  await demo.app.store.tail; const backupResult = await backup(demo.cfg, join(runRoot, 'backup-smoke-' + Date.now()));
  if (errors.length || external.length) throw new Error('Browser validation failed: ' + JSON.stringify({ errors, external }));
  return { reportPath, manifestPath, backup: backupResult.path, note: 'Authenticated roles, evidence, preview, second-commander export, SHA-256 verification, restart persistence and encrypted backup passed.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const smoke = args.includes('--smoke');
  const demo = await startDemo({ headless: args.includes('--headless'), port: Number(opt('--port') ?? (smoke ? 0 : 8080)), resume: opt('--resume') });
  console.log(`SYNTHETIC REHEARSAL — ${demo.cfg.origin}\nMaya: commander/admin · Alex: responder · Jordan: second commander/admin · Olivia: observer\nRun directory: ${demo.runRoot}\nVirtual security keys are encrypted in this rehearsal directory. These are simulated credentials, not physical isolation.\n`);
  if (smoke) { try { console.log(JSON.stringify(await demoSmoke(demo), null, 2)); } finally { await demo.stop(); } }
  else {
    console.log('Demo windows are ready. See DEMO.md.\nTerminal commands: restart (retain committed data), backup (encrypted snapshot), quit. Ctrl+C stops the rehearsal.');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    let exiting = false;
    const stop = async () => { if (exiting) return; exiting = true; input.close(); await demo.stop(); };
    process.once('SIGINT', () => stop().then(() => process.exit(0))); process.once('SIGTERM', () => stop().then(() => process.exit(0)));
    for await (const line of input) {
      try {
        if (line.trim() === 'restart') { await demo.restart(); console.log('Server restarted. Encrypted records and sessions retained; browser polling reconnects.'); }
        else if (line.trim() === 'backup') console.log(JSON.stringify(await backup(demo.cfg, join(demo.runRoot, 'backup-' + Date.now())), null, 2));
        else if (['quit', 'q', 'exit'].includes(line.trim())) { await stop(); break; }
        else console.log('Commands: restart, backup, quit.');
      } catch (e) { console.error(e.message); }
    }
    if (!exiting) await stop();
  }
}
