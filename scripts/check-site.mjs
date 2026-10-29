// Validate the static package without downloading models or starting the camera.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const errors = [];
let checked = 0;
async function reference(from, value) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return;
  if (value.startsWith('/')) { errors.push(`${from}: root-relative URL breaks project Pages hosting: ${value}`); return; }
  const target = path.resolve(root, path.dirname(from), decodeURIComponent(value.split(/[?#]/)[0]));
  if (target !== root && !target.startsWith(root + path.sep)) { errors.push(`${from}: path escapes dist: ${value}`); return; }
  try { await stat(target); checked++; }
  catch { errors.push(`${from}: missing ${value}`); }
}
async function walk(dir = '') {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!/\.(js|html|css)$/.test(file)) continue;
    const text = await readFile(path.join(root, file), 'utf8');
    // Literal module imports, re-exports and worker URLs used by this buildless app.
    const patterns = file.endsWith('.js') ? [
      /\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
      /\bimportScripts\s*\(\s*['"]([^'"]+)['"]/g,
      /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
    ] : file.endsWith('.html') ? [/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g] : [/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) await reference(file, match[1]);
    if (file.endsWith('.html')) {
      const ids = [...text.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
      for (const id of new Set(ids)) if (ids.filter(value => value === id).length > 1) errors.push(`${file}: duplicate id ${id}`);
    }
  }
}
await walk();
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
const shell = worker.match(/const SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shell) errors.push('sw.js: SHELL cache list not found');
else for (const match of shell[1].matchAll(/['"]([^'"]+)['"]/g)) await reference('sw.js', match[1]);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) await reference('manifest.webmanifest', icon.src);
await reference('manifest.webmanifest', manifest.start_url);
await reference('index.html', './.nojekyll');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Static site checked: ${checked} local references, manifest and offline cache`);
