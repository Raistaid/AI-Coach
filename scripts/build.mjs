// Copies the buildless app into dist/ for static hosting (GitHub Pages).
import { mkdir, cp, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const files = ['index.html', 'styles.css', 'coach-engine.js', 'coach-llm.js', 'coach-planner.js', 'coach-talk.js', 'llm-worker.js'];
const dirs = ['app', 'skills'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) await copyFile(path.join(root, file), path.join(dist, file));
for (const dir of dirs) await cp(path.join(root, dir), path.join(dist, dir), { recursive: true });
await writeFile(path.join(dist, '.nojekyll'), '');

const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('cameraVideo') || !html.includes('app/main.js')) throw new Error('Missing app entry points');
console.log(`Built dist/: ${files.join(', ')} + ${dirs.map(d => d + '/').join(', ')}`);
