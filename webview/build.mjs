// Bundles the diff view into ../build/generated/webview/bpmn-compare, which Gradle adds as a resource root.
// Also writes THIRD-PARTY-NOTICES.txt with the copyright and license text of every bundled npm package,
// as their licenses (MIT, bpmn.io license, ...) require these notices to ship with the bundle.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'build', 'generated', 'webview', 'bpmn-compare');
const noticesFile = 'THIRD-PARTY-NOTICES.txt';

await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [ path.join(here, 'src', 'main.js') ],
  outfile: path.join(outDir, 'bundle.js'),
  bundle: true,
  minify: true,
  metafile: true,
  format: 'iife',
  target: [ 'chrome110' ],
  loader: { '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl' },
  // keep @license / @preserve comments of bundled code
  legalComments: 'eof',
  banner: {
    js: `/*! Contains bpmn-js and other third-party code, see ${noticesFile} for copyright and license notices. */`,
    css: `/*! Contains styles of bpmn-js / diagram-js, see ${noticesFile} for copyright and license notices. */`
  },
  logLevel: 'info'
});

await copyFile(path.join(here, 'src', 'index.html'), path.join(outDir, 'index.html'));
await writeFile(path.join(outDir, noticesFile), await thirdPartyNotices(result.metafile));

/** Collects package name, version, license and the full license file of every package in the bundle. */
async function thirdPartyNotices(metafile) {
  const packageDirs = new Set();

  for (const input of Object.keys(metafile.inputs)) {
    const match = input.split(path.sep).join('/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);

    if (match) {
      packageDirs.add(match[1]);
    }
  }

  const sections = [];

  for (const dir of [ ...packageDirs ].sort()) {
    const absoluteDir = path.resolve(here, dir);
    const pkg = JSON.parse(await readFile(path.join(absoluteDir, 'package.json'), 'utf8'));
    const licenseFiles = (await readdir(absoluteDir)).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name));

    if (!licenseFiles.length) {
      throw new Error(`No license file found for bundled package ${ pkg.name }@${ pkg.version }`);
    }

    const texts = await Promise.all(licenseFiles.map((name) => readFile(path.join(absoluteDir, name), 'utf8')));
    const homepage = pkg.homepage || (pkg.repository && (pkg.repository.url || pkg.repository)) || '';

    sections.push([
      '-'.repeat(80),
      `${ pkg.name } ${ pkg.version }`,
      `License: ${ pkg.license || 'see below' }`,
      homepage ? `Source: ${ homepage }` : null,
      '',
      texts.map((text) => text.trim()).join('\n\n')
    ].filter((line) => line !== null).join('\n'));
  }

  return [
    'BPMN Compare plugin - third-party software notices',
    '',
    'The diagram view of this plugin bundles the following open source packages.',
    'Their copyright and license notices are reproduced below.',
    '',
    ...sections,
    '-'.repeat(80),
    ''
  ].join('\n');
}
