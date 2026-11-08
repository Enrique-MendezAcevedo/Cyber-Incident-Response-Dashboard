import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import AxeBuilder from '@axe-core/playwright';
import { startDemo, demoSmoke } from './demo.mjs';
import { restore } from '../lib/backup.mjs';
import { createApp } from '../server.mjs';
import { virtualKey, loginPage } from './browser-kit.mjs';
import { INCIDENT } from '../lib/access.mjs';
import { sha256 } from '../lib/blobs.mjs';
import { mutate } from '../lib/incident.mjs';
import { randomUUID } from 'node:crypto';

const output = resolve('../artifacts/demo-qa'); mkdirSync(output, { recursive: true });
const started = performance.now(), demo = await startDemo({ headless: true, port: 0 });
const result = { release: '1.0.0', kind: 'Automated validation; not a human usability study or penetration test', checkedAt: new Date().toISOString(), startupMs: Math.round(performance.now() - started), accessibility: [], checks: [] };
let restoredApp;
const maya = demo.profiles.get('maya').page, alex = demo.profiles.get('alex').page;
async function audit(page, name) {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const violations = scan.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, targets: v.nodes.map(n => n.target) }));
  result.accessibility.push({ screen: name, violations });
  assert.deepEqual(violations, [], 'Accessibility defects on ' + name + ': ' + JSON.stringify(violations));
}
try {
  await audit(maya, 'Overview');
  await maya.screenshot({ path: join(output, 'overview-desktop.png'), fullPage: true });
  assert.equal(await maya.locator('.pulse-tile').count(), 4);
  await maya.getByRole('button', { name: /^Open tasks/ }).click();
  await maya.getByRole('heading', { name: 'Incident tasks', exact: true }).waitFor();
  await audit(maya, 'Tasks');
  const targets = await maya.locator('.task-filter, .task-card button, .task-card summary').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }).filter(box => box.width && box.height));
  assert(targets.every(box => box.width >= 44 && box.height >= 44), 'Task controls must retain 44px targets');
  assert.match(await maya.locator('.task-card').first().innerText(), /Critical priority/);
  await maya.getByRole('button', { name: /^Blocked\s/ }).click();
  assert.equal(await maya.locator('.task-card').count(), 1);
  assert.match(await maya.locator('.task-card').innerText(), /Correlate outbound transfer/);
  await maya.getByRole('button', { name: /^Overdue\s/ }).click();
  await maya.getByText('No matching tasks.', { exact: true }).waitFor();
  await maya.getByRole('group', { name: 'Filter tasks' }).getByRole('button', { name: /^All\s/ }).click();
  const restoreTask = maya.locator('.task-card').filter({ hasText: 'Validate clean restore of customer records' });
  await restoreTask.getByText('Task details', { exact: true }).click();
  assert.equal(await restoreTask.locator('details[data-disclosure]').getAttribute('open'), '');
  await maya.screenshot({ path: join(output, 'tasks-desktop.png'), fullPage: true });
  for (const width of [320, 720]) {
    await maya.setViewportSize({ width, height: 900 });
    assert.equal(await maya.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Task reflow overflow at ' + width);
    await maya.screenshot({ path: join(output, `tasks-${width}.png`), fullPage: true });
  }
  await maya.setViewportSize({ width: 1440, height: 1000 });
  // An overdue cue must refresh even when no one changes the incident record.
  const imminent = new Date(Date.now() + 60_000).toISOString();
  const originalDeadline = await demo.app.store.run(data => {
    const commander = data.users.find(u => u.username === 'maya');
    const task = data.incidents[INCIDENT].tasks.find(t => t.title === 'Correlate outbound transfer with file access');
    const previous = task.dueAt;
    mutate(data, { kind: 'task-update', id: randomUUID(), entityId: task.id, revision: task.revision, dueAt: imminent, body: 'Synthetic deadline-refresh check' }, commander, INCIDENT);
    return previous;
  });
  await maya.waitForFunction(imminent => [...document.querySelectorAll('.task-card')].some(card => card.textContent.includes('Correlate outbound transfer') && card.querySelector('.deadline')?.title.includes(imminent.slice(11, 19))), imminent);
  await maya.evaluate(() => { window.aegisRealNow = Date.now; Date.now = () => window.aegisRealNow() + 120_000; });
  await maya.locator('.task-card').filter({ hasText: 'Correlate outbound transfer' }).locator('.deadline.overdue').waitFor();
  assert.equal(await restoreTask.locator('details[data-disclosure]').getAttribute('open'), '');
  assert.match(await maya.locator('.task-card').first().innerText(), /Correlate outbound transfer/);
  await maya.getByRole('button', { name: /^Overdue\s/ }).click(); assert.equal(await maya.locator('.task-card').count(), 1);
  await maya.evaluate(() => { Date.now = window.aegisRealNow; delete window.aegisRealNow; });
  await demo.app.store.run(data => {
    const commander = data.users.find(u => u.username === 'maya'), task = data.incidents[INCIDENT].tasks.find(t => t.title === 'Correlate outbound transfer with file access');
    mutate(data, { kind: 'task-update', id: randomUUID(), entityId: task.id, revision: task.revision, dueAt: originalDeadline, body: 'Restore the synthetic presentation deadline' }, commander, INCIDENT);
  });
  await maya.getByRole('group', { name: 'Filter tasks' }).getByRole('button', { name: /^All\s/ }).click();
  result.checks.push('Clickable response counts, priority/overdue order, blocked/overdue task filters, live deadline refresh, retained open details and task reflow');
  await maya.locator('.rail [data-page=MyTasks]').click();
  await maya.getByRole('heading', { name: 'My tasks', level: 2, exact: true }).waitFor();
  await audit(maya, 'My tasks');
  await maya.screenshot({ path: join(output, 'my-tasks-desktop.png'), fullPage: true });
  await maya.getByRole('button', { name: 'Open incident tasks', exact: true }).first().click();
  await maya.getByRole('button', { name: 'Scope', exact: true }).click(); await audit(maya, 'Scope');
  await maya.screenshot({ path: join(output, 'scope-desktop.png'), fullPage: true });
  await maya.locator('.skip').focus(); await maya.keyboard.press('Enter');
  let reached = false;
  for (let i = 0; i < 45; i++) { await maya.keyboard.press('Tab'); reached = await maya.evaluate(() => document.activeElement?.dataset.action === 'scope-create'); if (reached) break; }
  assert(reached, 'Keyboard navigation cannot reach Add asset or dataset');
  await maya.keyboard.press('Enter'); await maya.locator('#editor').waitFor({ state: 'visible' });
  assert(await maya.evaluate(() => !!document.activeElement.closest('dialog')), 'Dialog did not receive keyboard focus');
  await audit(maya, 'Scope creation dialog'); await maya.keyboard.press('Shift+Tab');
  assert(await maya.evaluate(() => !!document.activeElement.closest('dialog')), 'Dialog focus escaped');
  await maya.keyboard.press('Escape'); await maya.locator('#editor').waitFor({ state: 'hidden' });
  result.checks.push('Keyboard skip link, action reachability and native modal focus trap');
  await maya.setViewportSize({ width: 320, height: 844 });
  assert.equal(await maya.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '320px reflow overflow');
  await maya.screenshot({ path: join(output, 'scope-320.png'), fullPage: true });
  await maya.setViewportSize({ width: 1440, height: 1000 });
  await maya.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert.equal(await maya.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '200% zoom overflow');
  await maya.screenshot({ path: join(output, 'scope-zoom200.png'), fullPage: true });
  await maya.evaluate(() => { document.documentElement.style.zoom = ''; });
  result.checks.push('320 CSS pixel reflow and 200% zoom');
  await maya.getByRole('button', { name: 'Evidence', exact: true }).click(); await audit(maya, 'Evidence');
  await maya.locator('article').filter({ hasText: 'EV-014' }).getByRole('button', { name: 'Review original disposition' }).click();
  await maya.locator('#edit-form [name=status]').selectOption('Approved for controlled download'); await maya.locator('#edit-form [name=body]').fill('Independent synthetic forensic review complete; controlled original approved for judge demonstration');
  await maya.getByRole('button', { name: 'Save original disposition' }).click(); await maya.locator('#editor').waitFor({ state: 'hidden' });
  const originalReady = maya.waitForEvent('download'); await maya.getByRole('link', { name: 'Download controlled original' }).click(); const original = await originalReady;
  const originalPath = join(output, 'synthetic-original.log'); await original.saveAs(originalPath);
  assert.equal(sha256(readFileSync(originalPath)), demo.app.store.read().incidents[INCIDENT].evidenceRegister[0].attachments[0].sha256);
  result.checks.push('Quarantined original review and byte-verified controlled download');
  await alex.getByRole('button', { name: 'Communications', exact: true }).click();
  await alex.context().route('**/api/v1/**', route => route.abort('internetdisconnected'));
  const draft = 'Synthetic reconnect check — retain this unsaved draft';
  await alex.locator('#message').fill(draft); await alex.getByRole('button', { name: 'Send update', exact: true }).click();
  await alex.getByText('Delivery uncertain. Retry this same draft to avoid a duplicate.', { exact: true }).waitFor();
  await alex.locator('#network-warning').waitFor({ state: 'visible', timeout: 7000 }); assert.equal(await alex.locator('#message').inputValue(), draft);
  await alex.context().unroute('**/api/v1/**'); await alex.getByRole('button', { name: 'Send update', exact: true }).click();
  await alex.getByText('Sent · saved on server', { exact: true }).waitFor();
  let lost = false;
  await alex.context().route('**/api/v1/incidents/IR-2026-017', async route => {
    if (!lost && route.request().method() === 'POST' && route.request().postDataJSON()?.kind === 'message') { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  const uncertain = 'Synthetic lost-response check — server accepts once';
  await alex.locator('#message').fill(uncertain); await alex.getByRole('button', { name: 'Send update', exact: true }).click();
  await alex.getByText('Delivery uncertain. Retry this same draft to avoid a duplicate.', { exact: true }).waitFor();
  await alex.context().unroute('**/api/v1/incidents/IR-2026-017'); await alex.getByRole('button', { name: 'Send update', exact: true }).click(); await alex.getByText('Sent · saved on server', { exact: true }).waitFor();
  assert.equal(demo.app.store.read().incidents[INCIDENT].messages.filter(m => m.body === uncertain).length, 1);
  result.checks.push('Disconnected draft retention, reconnection, lost response and duplicate-safe retry');
  await maya.getByRole('button', { name: 'Review', exact: true }).click(); await audit(maya, 'Review and lessons');
  await maya.getByRole('button', { name: 'Record lesson learned', exact: true }).click();
  let lessonForm = maya.locator('#edit-form');
  await lessonForm.locator('[name=title]').fill('Verify the independent recovery copy quarterly'); await lessonForm.locator('[name=observation]').fill('The synthetic recovery process needs a regularly verified independent copy'); await lessonForm.locator('[name=impact]').fill('A verified recovery point preserves coordination records'); await lessonForm.locator('[name=recommendation]').fill('Schedule a quarterly encrypted restore drill'); await lessonForm.locator('[name=actionTitle]').fill('Schedule an independent restore drill');
  await lessonForm.getByRole('button', { name: 'Save lesson' }).click(); await maya.locator('#editor').waitFor({ state: 'hidden' });
  // Finish the incident through the actual forms before generating the final report.
  await maya.getByRole('button', { name: 'Evidence', exact: true }).click(); await maya.getByRole('button', { name: 'Register evidence', exact: true }).click();
  let form = maya.locator('#edit-form');
  await form.locator('[name=reference]').fill('EV-RESTORE'); await form.locator('[name=title]').fill('Clean restore validation'); await form.locator('[name=source]').fill('Synthetic recovery validation');
  await form.locator('[name=description]').fill('Synthetic application checks and data hashes match the clean recovery baseline.'); await form.locator('[name=storageReference]').fill('Synthetic responder kit / restore-validation.txt');
  await form.getByRole('button', { name: 'Save evidence record' }).click(); await maya.locator('#editor').waitFor({ state: 'hidden' });
  await alex.getByRole('button', { name: 'Evidence', exact: true }).click();
  const record = alex.locator('article').filter({ hasText: 'EV-RESTORE' }); await record.locator('[type=file]').setInputFiles(join(demo.runRoot, 'sample-evidence/restore-validation.txt'));
  await record.getByRole('button', { name: 'Upload to quarantine', exact: true }).click(); await record.getByRole('heading', { name: 'restore-validation.txt', exact: true }).waitFor();
  await maya.getByRole('button', { name: 'Scope', exact: true }).click(); await maya.locator('article').filter({ hasText: 'Customer records' }).getByRole('button', { name: 'Edit assessment', exact: true }).click();
  form = maya.locator('#edit-form'); await form.locator('[name=availability]').selectOption('Accessible'); await form.locator('[name=recovery]').selectOption('Validated'); await form.locator('[name=recoveryEvidence]').fill('EV-RESTORE: clean application and hash validation'); await form.locator('[name=body]').fill('Validated a clean restore; exposure and exfiltration remain under investigation');
  await form.getByRole('button', { name: 'Save assessment' }).click(); await maya.locator('#editor').waitFor({ state: 'hidden' });
  await alex.getByRole('button', { name: 'Tasks', exact: true }).click(); await alex.locator('li').filter({ hasText: 'Validate clean restore of customer records' }).getByRole('button', { name: 'Update task' }).click();
  form = alex.locator('#edit-form'); await form.locator('[name=status]').selectOption('Complete'); await form.locator('[name=completionEvidence]').fill('EV-RESTORE confirms synthetic application and hash checks'); await form.locator('[name=body]').fill('Restore validation completed'); await form.getByRole('button', { name: 'Save task' }).click(); await alex.locator('#editor').waitFor({ state: 'hidden' });
  await maya.getByRole('button', { name: 'Review', exact: true }).click();
  for (const phase of ['Recovering', 'Closed']) {
    await maya.getByRole('button', { name: 'Change phase', exact: true }).click(); form = maya.locator('#edit-form'); await form.locator('[name=phase]').selectOption(phase); await form.locator('[name=body]').fill('Commander recorded validated ' + phase.toLowerCase());
    if (phase === 'Closed') { await form.locator('[name=impactSummary]').fill('Synthetic customer service restored; exposure assessment remains open'); await form.locator('[name=residualRisk]').fill('Maya retains ownership of the suspected exfiltration investigation and follow-up review'); await form.locator('[name=recoveryValidation]').fill('EV-RESTORE: application and hash validation'); const alexId = demo.app.store.read().users.find(u => u.username === 'alex').id; await form.locator('[name=reviewOwnerId]').selectOption(alexId); }
    await form.getByRole('button', { name: 'Record transition' }).click(); await maya.locator('#editor').waitFor({ state: 'hidden' });
  }
  await alex.getByRole('button', { name: 'Review', exact: true }).click(); await alex.getByRole('button', { name: 'Update review', exact: true }).click(); form = alex.locator('#edit-form'); await form.locator('[name=status]').selectOption('Complete'); await form.locator('[name=notes]').fill('Synthetic response reviewed; residual exposure work remains assigned, and an improvement action is tracked'); await form.locator('[name=body]').fill('Post-incident review completed'); await form.getByRole('button', { name: 'Save review' }).click(); await alex.locator('#editor').waitFor({ state: 'hidden' });
  await alex.getByRole('button', { name: 'Update improvement action', exact: true }).click(); form = alex.locator('#edit-form'); await form.locator('[name=status]').selectOption('Complete'); await form.locator('[name=completionEvidence]').fill('SYN-DRILL-1: next clean-kit exercise assigned in the synthetic schedule'); await form.locator('[name=body]').fill('Improvement action scheduled and recorded'); await form.getByRole('button', { name: 'Save task' }).click(); await alex.locator('#editor').waitFor({ state: 'hidden' });
  await alex.locator('li').filter({ hasText: 'Rehearse the independent responder kit monthly' }).getByRole('button', { name: 'Update lesson', exact: true }).click(); form = alex.locator('#edit-form'); await form.locator('[name=status]').selectOption('Complete'); await form.locator('[name=body]').fill('Verified the linked improvement action'); await form.getByRole('button', { name: 'Save lesson' }).click(); await alex.locator('#editor').waitFor({ state: 'hidden' });
  result.checks.push('Evidence registration/upload, restored scope without clearing exposure, closure and owner-led review, and completed improvement action');
  await maya.locator('.rail [data-page=People]').click(); await maya.getByRole('heading', { name: 'People & incident assignments' }).waitFor(); await audit(maya, 'People');
  await maya.locator('.rail [data-page=Incidents]').click(); await audit(maya, 'Incident list');
  await maya.locator('li').filter({ hasText: 'Northbridge ransomware' }).getByRole('button', { name: 'Open incident' }).click();
  await demo.app.store.run(data => { const mayaId = data.users.find(u => u.username === 'maya').id; for (const session of data.sessions.filter(s => s.userId === mayaId)) session.verified = Date.now() - demo.cfg.recentMs - 1; });
  const smoke = await demoSmoke(demo); result.checks.push(smoke.note, 'Recent-key verification from the open report dialog retains the pending draft');
  copyFileSync(smoke.reportPath, join(output, 'sample-after-action-report.html')); copyFileSync(smoke.manifestPath, join(output, 'sample-after-action-report.manifest.json'));
  copyFileSync(join(demo.runRoot, 'report-preview.png'), join(output, 'report-preview.png'));
  const restoredCfg = { ...demo.cfg, database: join(demo.runRoot, 'restored/data.sqlite'), evidenceRoot: join(demo.runRoot, 'restored/evidence'), port: 0 };
  restore(restoredCfg, smoke.backup, true); restoredApp = await createApp(restoredCfg); await new Promise(done => restoredApp.server.listen(0, '127.0.0.1', done)); restoredCfg.port = restoredApp.server.address().port; restoredCfg.origin = 'http://localhost:' + restoredCfg.port;
  const context = await demo.browser.newContext(), restoredPage = await context.newPage(), device = await virtualKey(context, restoredPage);
  const restoredUser = restoredApp.store.read().users.find(u => u.username === 'maya');
  const credentials = (await demo.profiles.get('maya').cdp.send('WebAuthn.getCredentials', { authenticatorId: demo.profiles.get('maya').authenticatorId })).credentials;
  for (const credential of credentials) { const stored = restoredUser.credentials.find(c => c.id === Buffer.from(credential.credentialId, 'base64').toString('base64url')); if (stored) await device.cdp.send('WebAuthn.addCredential', { authenticatorId: device.authenticatorId, credential: { ...credential, signCount: stored.counter + 1 } }); }
  await restoredPage.goto(restoredCfg.origin); await restoredPage.locator('#auth-screen').waitFor({ state: 'visible' }); await loginPage(restoredPage, 'maya');
  await restoredPage.getByRole('heading', { name: 'Northbridge ransomware', exact: true }).waitFor();
  await restoredPage.getByRole('button', { name: 'Evidence', exact: true }).click(); await restoredPage.getByRole('heading', { name: 'EV-014 · Outbound gateway transfer summary' }).waitFor();
  assert.equal(restoredApp.store.read().incidents[INCIDENT].messages.filter(m => m.body === uncertain).length, 1);
  result.checks.push('Fresh restore, revoked prior sessions, WebAuthn rehearsal-key reauthentication and evidence/record continuity');
  const persisted = demo.app.store.read().incidents[INCIDENT].sequence; await demo.stop();
  const resumed = await startDemo({ headless: true, port: 0, resume: demo.runRoot });
  try { assert.equal(resumed.app.store.read().incidents[INCIDENT].sequence, persisted); await resumed.profiles.get('maya').page.getByRole('heading', { name: 'Northbridge ransomware', exact: true }).waitFor(); }
  finally { await resumed.stop(); }
  result.checks.push('Resume a prior rehearsal with encrypted virtual-key cache and committed records retained');
  result.totalMs = Math.round(performance.now() - started); result.pass = true;
  writeFileSync(join(output, 'validation-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: true, screens: result.accessibility.length, checks: result.checks, results: join(output, 'validation-results.json'), totalMs: result.totalMs }, null, 2));
} catch (error) {
  result.pass = false; result.error = error.message;
  try { result.formError = await maya.locator('#edit-error').textContent({ timeout: 500 }); await maya.screenshot({ path: join(output, 'failure.png'), fullPage: true }); } catch { /* a closed browser has no page to capture */ }
  writeFileSync(join(output, 'validation-results.json'), JSON.stringify(result, null, 2)); throw error;
} finally { if (restoredApp) await restoredApp.close(); await demo.stop(); }
