// Publica una versión nueva en GitHub Releases, que es de donde la app instalada se actualiza sola.
// Uso: sube "version" en package.json, haz commit y push, y luego: npm run release
//
// Comprueba antes de publicar: tests en verde, sin cambios sin commit, el commit ya está en GitHub
// y esa versión no existe todavía. Después compila y sube el instalador, su .blockmap y latest.yml
// (lo que lee electron-updater) más la versión portable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { owner, repo } = pkg.build.publish[0];
const version = pkg.version;
const tag = `v${version}`;
// Solo npm necesita shell en Windows (es npm.cmd). git y gh van sin shell: con ella, los
// argumentos con espacios (título y notas del release) se partían en varios.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npm', ...opts });
const fail = (msg) => { console.error(`\n✖ ${msg}`); process.exit(1); };

console.log(`Release ${tag} → ${owner}/${repo}`);

if (run('git', ['status', '--porcelain']).trim()) fail('Hay cambios sin commit. Haz commit antes de publicar.');
run('git', ['fetch', 'origin', '--quiet']);
const head = run('git', ['rev-parse', 'HEAD']).trim();
if (run('git', ['branch', '-r', '--contains', head]).indexOf('origin/main') < 0) fail('El commit actual no está en origin/main. Haz push antes de publicar.');
let exists = true;
try { run('gh', ['release', 'view', tag, '--repo', `${owner}/${repo}`], { stdio: 'ignore' }); } catch { exists = false; }
if (exists) fail(`La versión ${tag} ya existe. Sube "version" en package.json.`);

console.log('Tests…');
run('npm', ['test'], { stdio: 'inherit' });
console.log('Compilando…');
run('npm', ['run', 'dist'], { stdio: 'inherit' });

const files = [
  `dist/Music-Desktop-Setup-${version}.exe`,
  `dist/Music-Desktop-Setup-${version}.exe.blockmap`,
  'dist/latest.yml',
  `dist/Music-Desktop-${version}-portable.exe`,
].map((f) => join(root, f));
for (const f of files) if (!existsSync(f)) fail(`Falta ${f}`);
const latest = readFileSync(join(root, 'dist/latest.yml'), 'utf8');
if (!latest.includes(`version: ${version}`)) fail('latest.yml no corresponde a esta versión.');

console.log('Publicando…');
run('gh', ['release', 'create', tag, ...files, '--repo', `${owner}/${repo}`, '--target', head, '--title', `Music Desktop ${version}`,
  '--notes', `Music Desktop ${version}. Installed copies update themselves on launch; for a first install, download Music-Desktop-Setup-${version}.exe.`], { stdio: 'inherit' });
console.log(`\n✔ Publicada: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
