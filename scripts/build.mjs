import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
const hash = content => createHash('sha256').update(content).digest('hex').slice(0, 12);
const engine = await readFile(path.join(root, 'coach-engine.js'), 'utf8');
const css = await readFile(path.join(root, 'styles.css'), 'utf8');
const app = (await readFile(path.join(root, 'app.js'), 'utf8'))
  .replace("from './coach-engine.js'", `from './coach-engine.js?v=${hash(engine)}'`);
const html = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace('href="./styles.css"', `href="./styles.css?v=${hash(css)}"`)
  .replace('src="./app.js"', `src="./app.js?v=${hash(app)}"`);
if (!html.includes('cameraVideo') || !html.includes('app.js?v=')) throw new Error('Missing app entry points');
await mkdir(out, { recursive: true });
for (const [name, content] of Object.entries({ 'index.html': html, 'styles.css': css, 'app.js': app, 'coach-engine.js': engine })) {
  await writeFile(path.join(out, name), content);
}
console.log('Built dist/ with content-versioned CSS, application and vision engine.');
