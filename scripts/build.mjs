import { mkdir, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const files = ['index.html','styles.css','app.js','coach-engine.js','coach-llm.js','llm-worker.js','skills/index.js','skills/common.js','skills/football.js','skills/squats.js','skills/balance.js'];
await mkdir(path.join(root, 'dist', 'skills'), { recursive: true });
for (const file of files) await copyFile(path.join(root,file), path.join(root,'dist',file));
const html = await readFile(path.join(root,'dist/index.html'),'utf8');
if (!html.includes('cameraVideo') || !html.includes('app.js')) throw new Error('Missing app entry points');
console.log('Built dist/: ' + files.join(', '));
