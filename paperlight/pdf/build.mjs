import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/pdf', { recursive: true });
await build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.cjs' });
await build({ entryPoints: ['src/viewer.ts'], bundle: true, platform: 'browser', target: 'es2024', format: 'esm', outfile: 'dist/viewer.js' });
await cp('src/viewer.css', 'dist/viewer.css');
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'web/images']) {
	await cp(`node_modules/pdfjs-dist/${directory}`, `dist/pdf/${directory}`, { recursive: true });
}
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf/pdf.worker.mjs');
await cp('node_modules/pdfjs-dist/web/pdf_viewer.css', 'dist/pdf/web/pdf_viewer.css');
await cp('node_modules/pdfjs-dist/LICENSE', 'dist/pdf/LICENSE');
