import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, lstatSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const index = process.argv.indexOf('--out');
if (index < 0) throw new Error('Use npm run bundle -- --out /path/aegis-release.tar.gz');
const output = resolve(process.argv[index + 1]);
const includeDemo = process.argv.includes('--include-demo');
if (existsSync(output)) throw new Error('Refusing to replace an existing release.');
const stage = mkdtempSync(join(tmpdir(), 'aegis-release-')); const root = join(stage, 'aegis-command'); mkdirSync(root);
for (const item of ['server.mjs', 'lib', 'web', 'scripts', 'deploy', 'requirements', 'README.md', 'WORKFLOWS.md', 'DEMO.md', 'VALIDATION.md', 'package.json', 'package-lock.json', ...(includeDemo ? ['test'] : [])]) cpSync(item, join(root, item), { recursive: true, dereference: false });
// Assemble from the locked local npm cache; no registry access in this build.
const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith('npm_') && name !== 'INIT_CWD'));
execFileSync('npm', ['ci', ...(includeDemo ? [] : ['--omit=dev']), '--offline', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund'], { cwd: root, env: buildEnv, stdio: 'inherit' });
const entries = [];
function walk(dir, relative = '') {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), rel = relative ? relative + '/' + name : name;
    if (lstatSync(path).isSymbolicLink()) throw new Error('Release contains a symlink: ' + rel);
    if (lstatSync(path).isDirectory()) walk(path, rel);
    else entries.push({ path: rel, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
  }
}
walk(root); writeFileSync(join(root, 'MANIFEST.json'), JSON.stringify({ version: 1, profile: includeDemo ? 'synthetic-rehearsal' : 'independent-appliance', files: entries }, null, 2));
execFileSync('tar', ['-czf', output, '-C', stage, 'aegis-command']);
console.log('Created offline source and dependency bundle: ' + output);
console.log('Sign its bytes using the independent release key; see deploy/README.md. No runtime secrets are included.');
