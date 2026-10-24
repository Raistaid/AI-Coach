import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const files = ['index.html','styles.css','app.js','coach-engine.js'];
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of files) await copyFile(path.join(root,file), path.join(root,'dist',file));
const html = await readFile(path.join(root,'dist/index.html'),'utf8');
if (!html.includes('cameraVideo') || !html.includes('app.js')) throw new Error('Missing app entry points');
console.log('Built dist/: ' + files.join(', '));
