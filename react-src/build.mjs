/**
 * Bundles src/index.tsx -- React, React DOM and every line of grid code -- into ONE self-contained
 * IIFE, with its CSS extracted alongside, then copies both into the static resource folder.
 *
 * Deliberately NO CDN. Experience Cloud pages can be public or served to users on locked-down
 * corporate networks, so a runtime fetch from unpkg or cdnjs is not a dependency we are allowed to
 * take. Everything ships inside the bundle.
 */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'dist');
const staticResourceDir = path.join(
  __dirname,
  '..',
  'force-app',
  'main',
  'default',
  'staticresources',
  'reactGridBundle'
);

mkdirSync(outDir, { recursive: true });
mkdirSync(staticResourceDir, { recursive: true });

await build({
  entryPoints: [path.join(__dirname, 'src', 'index.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  // IIFE, not ESM: the LWC host loads this with platformResourceLoader's loadScript, which is a
  // plain <script> tag. A module build would never execute and window.ReactGrid would be undefined.
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(outDir, 'reactGrid.js'),
  loader: { '.css': 'css' },
});

copyFileSync(path.join(outDir, 'reactGrid.js'), path.join(staticResourceDir, 'reactGrid.js'));
copyFileSync(path.join(outDir, 'reactGrid.css'), path.join(staticResourceDir, 'reactGrid.css'));

console.log(`Built react grid bundle -> ${staticResourceDir}`);
