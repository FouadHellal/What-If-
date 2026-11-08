// Bundles the server (and the workspace packages it uses) into dist/.
// npm dependencies stay external and are installed in the runtime image.
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = [
  ...Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@whatif/')),
  '@electric-sql/pglite',
  'pino-pretty',
  'pg-native',
];

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: { index: 'src/index.ts', migrate: 'src/cli/migrate.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
