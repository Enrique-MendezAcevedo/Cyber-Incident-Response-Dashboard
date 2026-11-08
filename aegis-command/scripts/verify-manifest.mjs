import { readFileSync, lstatSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2] || '.');
const manifest = JSON.parse(readFileSync(resolve(root, 'MANIFEST.json'), 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported manifest.');
for (const file of manifest.files) {
  const path = resolve(root, file.path);
  if (!path.startsWith(root + sep) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('Invalid manifest entry.');
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256) throw new Error('Digest mismatch: ' + file.path);
}
console.log(`Verified ${manifest.files.length} files. The archive signature must also be verified against a separately trusted release key.`);
