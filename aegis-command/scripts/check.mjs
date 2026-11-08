import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'runtime', '.git'].includes(entry.name)) continue;
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) visit(path);
    else if (/\.(mjs|js)$/.test(path)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
visit('.'); console.log('JavaScript syntax checks passed.');
