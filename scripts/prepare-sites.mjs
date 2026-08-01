import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/_appgen_meta', { recursive: true });
await copyFile('public/_appgen_meta/appgarden.json', 'dist/_appgen_meta/appgarden.json');
