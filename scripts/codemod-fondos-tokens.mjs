// codemod-fondos-tokens.mjs — tanda 3c de la auditoría de diseño (2026-11-10).
// Sustituye colores literales de FONDO, BORDE, CONTORNO y SOMBRA por tokens de src/styles/tokens.css.
//   node scripts/codemod-fondos-tokens.mjs            → simulacro (resumen + CSV en e2e/out/codemod-fondos-tokens.csv)
//   node scripts/codemod-fondos-tokens.mjs --aplicar  → escribe los cambios
// Regla general (sin redondeos propios): rgba(R,G,B,A) con RGB de un color semántico → color-mix(in srgb, var(--token) A%, transparent),
// que da exactamente el mismo color en el mismo alfa. Blancos translúcidos → --text-1; negros translúcidos → --negro; hex sólidos de la
// escala semántica (cian, verdes, ámbares, rojos) → su token. Lo que no coincide con ninguna regla queda como está y se lista en el CSV.
// Alcance: CSS (background, border*, outline*, box-shadow) y objetos style={{ }} de TSX (background, border*, boxShadow). Excepciones:
// informes/impresos/exportación, reglas de tema claro, @media print, valores dentro de var(..., fallback) y archivos de tokens.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(RAIZ, 'src');
const APLICAR = process.argv.includes('--aplicar');
const CSV = path.join(RAIZ, 'e2e', 'out', 'codemod-fondos-tokens.csv');

const EXCLUIR = /(Report|informe|Informe|infografia|Infografia|lamina|print|exportar|membrete|\.test\.|tokens\.css|ui-base\.css|tanda1-superficies\.css)/;

const RGB_A_TOKEN = new Map();
const hexRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(','); };
const poner = (token, hexes) => hexes.forEach((h) => RGB_A_TOKEN.set(hexRgb(h), token));
poner('--st-info', ['#3fb2f3', '#38bdf8', '#22d3ee', '#3b82f6', '#60a5fa', '#0ea5e9']);
poner('--st-ok', ['#10b981', '#22c55e', '#34d399', '#4ade80', '#7cc520', '#5db22a']);
poner('--st-warn', ['#f59e0b', '#fbbf24', '#eab308', '#d97706']);
poner('--st-crit', ['#ef4444', '#f87171', '#dc2626', '#f43f5e']);
poner('--text-1', ['#ffffff', '#e8eef6', '#f1f5f9', '#e2e8f0']);
poner('--negro', ['#000000']);
poner('--bg-app', ['#061532', '#040e22', '#020a14', '#02060d']);
poner('--surface-1', ['#0a1220', '#0b1624', '#07121f', '#0f172a', '#081f47', '#0b2147', '#0f1a33', '#0d1b38']);
poner('--surface-2', ['#1e293b', '#10284f']);
poner('--text-3', ['#94a3b8', '#8396ad', '#8fa7c8']);
poner('--line-sutil', ['#334155', '#475569']);
poner('--line-fuerte', ['#64748b']);

const HEX_SOLIDO = new Map([...RGB_A_TOKEN].map(([rgb, t]) => [rgb, t]));
// #fff y #000 sólidos no se tocan (se usan para texto sobre relleno y marcas); solo sus versiones translúcidas.
const NO_SOLIDO = new Set(['255,255,255', '0,0,0']);

const filas = [['estado', 'archivo', 'linea', 'original', 'nuevo']];
const resumen = { cambios: 0, sinRegla: new Map() };
const cuenta = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const linea = (t, i) => t.slice(0, i).split('\n').length;
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');

// regiones dentro de var( ... ) — sus valores de respaldo no se tocan
function enVar(valor) {
  const r = [];
  const re = /var\(/g; let m;
  while ((m = re.exec(valor))) { let d = 1, i = re.lastIndex; while (i < valor.length && d > 0) { if (valor[i] === '(') d++; else if (valor[i] === ')') d--; i++; } r.push([m.index, i]); }
  return r;
}
function convertirColores(valor, ctx) {
  const prot = enVar(valor);
  const dentro = (i) => prot.some(([a, b]) => i >= a && i < b);
  return valor.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, (c, r, g, b, a, off) => {
    if (dentro(off)) return c;
    let rgb, alfa = 1;
    if (c.startsWith('#')) { rgb = hexRgb(c.toLowerCase()); if (NO_SOLIDO.has(rgb)) { return c; } }
    else { rgb = `${r},${g},${b}`; alfa = a === undefined ? 1 : parseFloat(a); }
    const token = (c.startsWith('#') ? HEX_SOLIDO : RGB_A_TOKEN).get(rgb);
    if (!token) { cuenta(resumen.sinRegla, c.toLowerCase().replace(/\s+/g, '')); filas.push(['sin-regla', ctx.arch, ctx.ln, c, '']); return c; }
    let nuevo;
    if (c.startsWith('#') || alfa >= 0.995) nuevo = `var(${token})`;
    else nuevo = `color-mix(in srgb, var(${token}) ${Math.round(alfa * 1000) / 10}%, transparent)`;
    resumen.cambios++; filas.push(['cambiado', ctx.arch, ctx.ln, c, nuevo]);
    return nuevo;
  });
}
function recorrer(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'utils') recorrer(p, salida); } else salida.push(p);
  }
  return salida;
}
function rangosPrint(css) {
  const r = []; const re = /@media\s+print[^{]*\{/g; let m;
  while ((m = re.exec(css))) { let d = 1, i = re.lastIndex; while (i < css.length && d > 0) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; } r.push([m.index, i]); }
  return r;
}

const PROP_CSS = /^(background(?:-color|-image)?|border(?:-top|-right|-bottom|-left)?(?:-color)?|outline(?:-color)?|box-shadow)$/;
for (const f of recorrer(SRC)) {
  const ext = path.extname(f); if (ext !== '.css' && ext !== '.tsx') continue;
  const r = rel(f); if (EXCLUIR.test(r)) continue;
  const orig = fs.readFileSync(f, 'utf8'); const crlf = orig.includes('\r\n'); const base = orig.replace(/\r\n/g, '\n');
  let txt = base;
  if (ext === '.css') {
    const prints = rangosPrint(base); const enPrint = (i) => prints.some(([a, b]) => i >= a && i < b);
    txt = base.replace(/([^{}]+)\{([^{}]*)\}/g, (bloque, sel, decl, off) => {
      if (enPrint(off) || /data-theme\s*=\s*["']?light/.test(sel) || /\.tema-sol/.test(sel)) return bloque;
      const nuevo = decl.replace(/(^|;|\s)([a-z-]+)\s*:\s*([^;]+?)(\s*!important)?(\s*;|\s*$)/g, (m, pre, prop, val, imp, fin, pos) => {
        if (!PROP_CSS.test(prop)) return m;
        if (!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(val)) return m;
        const ctx = { arch: r, ln: linea(base, off + sel.length + 1 + pos) };
        return `${pre}${prop}: ${convertirColores(val, ctx)}${imp || ''}${fin}`;
      });
      return sel + '{' + nuevo + '}';
    });
  } else {
    if (/bg-white|bg-slate-50\b/.test(base)) continue;
    txt = base.replace(/style=\{\{([^{}]*)\}\}/g, (bloque, interior, off) => {
      const nuevo = interior.replace(/(background|backgroundColor|border|borderTop|borderRight|borderBottom|borderLeft|borderColor|boxShadow)\s*:\s*'([^']*)'/g, (m, prop, val, pos) => {
        if (!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(val)) return m;
        const ctx = { arch: r, ln: linea(base, off + 8 + pos) };
        return `${prop}: '${convertirColores(val, ctx)}'`;
      });
      return `style={{${nuevo}}}`;
    });
  }
  if (APLICAR && txt !== base) fs.writeFileSync(f, crlf ? txt.replace(/\n/g, '\r\n') : txt, 'utf8');
}
fs.mkdirSync(path.dirname(CSV), { recursive: true });
fs.writeFileSync(CSV, filas.map((x) => x.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'utf8');
console.log(`${APLICAR ? 'APLICADO' : 'SIMULACRO'} · colores convertidos: ${resumen.cambios} · sin regla: ${[...resumen.sinRegla.values()].reduce((a, b) => a + b, 0)}`);
console.log('sin regla (top):', [...resumen.sinRegla.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k}×${n}`).join(' '));
console.log('detalle:', rel(CSV));
