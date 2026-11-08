import { existsSync } from 'node:fs';
export function chromePath() {
  const paths = [process.env.AEGIS_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', process.env.PROGRAMFILES && process.env.PROGRAMFILES + '/Google/Chrome/Application/chrome.exe'];
  const found = paths.find(p => p && existsSync(p));
  if (!found) throw new Error('Install Chrome/Chromium or set AEGIS_CHROME to its executable path. No browser download is performed.'); return found;
}
export async function virtualKey(context, page) {
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { cdp, authenticatorId };
}
export async function enrollPage(page, token) {
  if (await page.locator('#auth-screen details').getAttribute('open') === null) await page.locator('#auth-screen summary').click();
  await page.locator('#enroll-form [name=token]').fill(token); await page.getByRole('button', { name: 'Enroll security key', exact: true }).click();
  await page.locator('.layout').waitFor({ state: 'visible' });
}
export async function loginPage(page, username) {
  await page.locator('#login-form [name=username]').fill(username); await page.getByRole('button', { name: 'Sign in with security key', exact: true }).click(); await page.locator('.layout').waitFor({ state: 'visible' });
}
