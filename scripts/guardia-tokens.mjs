// guardia-tokens.mjs — evita que vuelvan a crecer los colores literales (tanda 2 de la auditoría de diseño).
//   node scripts/guardia-tokens.mjs             → compara con scripts/guardia-tokens.baseline.json; sale con 1 si algún archivo AUMENTA
//   node scripts/guardia-tokens.mjs --fijar     → reescribe la línea base (solo después de bajar conteos o de aprobar una excepción)
// Cuenta literales hex (#rgb, #rrggbb) y rgb()/rgba() en src/**/*.css y src/**/*.tsx, sin informes ni tokens.css.
// La línea base solo puede bajar: usar var(--st-*), var(--text-*), var(--surface-*) de src/styles/tokens.css.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(RAIZ, 'scripts', 'guardia-tokens.baseline.json');
const EXCLUIR = /(Report|informe|Informe|infografia|Infografia|lamina|print|exportar|membrete|\.test\.|tokens\.css|utils[\\/])/;

function recorrer(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, salida); else if (/\.(css|tsx)$/.test(e.name)) salida.push(p);
  }
  return salida;
}

const actual = {};
for (const f of recorrer(path.join(RAIZ, 'src'))) {
  const r = path.relative(RAIZ, f).replace(/\\/g, '/');
  if (EXCLUIR.test(r)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const n = (t.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g) || []).length;
  if (n) actual[r] = n;
}
const total = Object.values(actual).reduce((a, b) => a + b, 0);

if (process.argv.includes('--fijar')) {
  fs.writeFileSync(BASE, JSON.stringify({ total, archivos: actual }, null, 1) + '\n');
  console.log(`Línea base fijada: ${total} literales en ${Object.keys(actual).length} archivos.`);
  process.exit(0);
}
if (!fs.existsSync(BASE)) { console.error('Falta la línea base: corre con --fijar'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const sube = Object.entries(actual).filter(([r, n]) => n > (base.archivos[r] ?? 0));
console.log(`Literales de color: ${total} (línea base ${base.total}).`);
if (sube.length) {
  console.error('Aumentaron (usa tokens de src/styles/tokens.css):');
  sube.forEach(([r, n]) => console.error(`  ${r}: ${base.archivos[r] ?? 0} → ${n}`));
  process.exit(1);
}
console.log('OK: ningún archivo aumentó.');
