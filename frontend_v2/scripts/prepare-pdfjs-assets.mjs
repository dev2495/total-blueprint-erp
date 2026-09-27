import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  const target = path.join(root, 'public', 'pdfjs', name);
  mkdirSync(target, { recursive: true });
  cpSync(path.join(root, 'node_modules', 'pdfjs-dist', name), target, { recursive: true });
}
