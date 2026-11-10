// codemod-color-tokens.mjs — tanda 2 de la auditoría de diseño (2026-11-10).
// Sustituye colores de TEXTO literales por tokens semánticos de src/styles/tokens.css.
//   node scripts/codemod-color-tokens.mjs            → simulacro: imprime resumen y escribe el CSV de pendientes/excepciones
//   node scripts/codemod-color-tokens.mjs --aplicar  → escribe los cambios
//   --csv=ruta.csv  → dónde dejar el detalle (por defecto e2e/out/codemod-color-tokens.csv)
// Alcance deliberado (nada se reemplaza "a ojo"):
//   · CSS: declaraciones `color: #hex` (no background, border, fill ni sombras).
//   · TSX: `color: '#hex'` dentro de `style={{ ... }}` (los objetos de opciones de ECharts/canvas no se tocan: no resuelven var()).
//   · Excepciones fijas: informes e infografías (impresos, hoja clara), reglas de tema claro, @media print, archivos con
//     superficie blanca (`bg-white`), sica-capture (otra app) y utils/ (HTML de exportación).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(RAIZ, 'src');
const APLICAR = process.argv.includes('--aplicar');
const csvArg = (process.argv.find((a) => a.startsWith('--csv=')) || '').slice(6);
const CSV = csvArg || path.join(RAIZ, 'e2e', 'out', 'codemod-color-tokens.csv');

// hex (minúsculas) → token. Los valores de los tokens están en src/styles/tokens.css.
const MAPA = new Map();
const poner = (token, hexes) => hexes.forEach((h) => MAPA.set(h, token));
poner('--text-1', ['#e2e8f0', '#f1f5f9', '#f8fafc', '#e8eef6']);
poner('--text-2', ['#cbd5e1', '#b4c2d4', '#aab6c8', '#b4c6dd']);
poner('--text-3', ['#8396ad', '#94a3b8', '#7d8ea3', '#9fb6d6', '#8fa7c8', '#a3b3c7', '#64748b', '#475569', '#60718a']);
poner('--st-ok', ['#10b981', '#22c55e', '#34d399', '#4ade80', '#16a34a', '#059669']);
poner('--st-warn', ['#f59e0b', '#fbbf24', '#d97706', '#eab308']);
poner('--st-crit', ['#ef4444', '#f87171', '#dc2626', '#f43f5e']);
poner('--st-info', ['#3fb2f3', '#38bdf8', '#22d3ee', '#7dd3fc', '#60a5fa', '#3b82f6']);

const EXCLUIR_RUTA = /(Report|informe|Informe|infografia|Infografia|lamina|print|exportar|membrete)/;
const filas = [['estado', 'archivo', 'linea', 'hex', 'token']];
const resumen = { reemplazados: 0, excepciones: 0, sinToken: new Map() };
const contar = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function recorrer(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'utils') recorrer(p, salida); } else salida.push(p);
  }
  return salida;
}
const linea = (txt, idx) => txt.slice(0, idx).split('\n').length;
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');

// rangos [ini, fin) de @media print { ... } para saltarlos
function rangosPrint(css) {
  const r = [];
  const re = /@media\s+print[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let prof = 1, i = re.lastIndex;
    while (i < css.length && prof > 0) { if (css[i] === '{') prof++; else if (css[i] === '}') prof--; i++; }
    r.push([m.index, i]);
  }
  return r;
}

for (const f of recorrer(SRC)) {
  const ext = path.extname(f);
  if (ext !== '.css' && ext !== '.tsx') continue;
  const r = rel(f);
  if (EXCLUIR_RUTA.test(r) || r.endsWith('tokens.css') || r.endsWith('tanda1-superficies.css') || /\.test\./.test(r)) continue;
  const orig = fs.readFileSync(f, 'utf8');
  let txt = orig;

  if (ext === '.css') {
    const prints = rangosPrint(orig);
    const enPrint = (i) => prints.some(([a, b]) => i >= a && i < b);
    txt = orig.replace(/([^{}]+)\{([^{}]*)\}/g, (bloque, sel, decl, off) => {
      if (enPrint(off)) return bloque;
      const claro = /data-theme\s*=\s*["']?light/.test(sel);
      return sel + '{' + decl.replace(/(^|[;\s])color:\s*(#[0-9a-fA-F]{3,6})\b/g, (mm, pre, hex, pos) => {
        const h = hex.toLowerCase();
        const token = MAPA.get(h);
        const ln = linea(orig, off + sel.length + 1 + pos);
        if (claro) { filas.push(['excepcion-tema-claro', r, ln, h, '']); resumen.excepciones++; return mm; }
        if (!token) { filas.push(['sin-token', r, ln, h, '']); contar(resumen.sinToken, h); return mm; }
        filas.push(['reemplazado', r, ln, h, token]); resumen.reemplazados++;
        return `${pre}color: var(${token})`;
      }) + '}';
    });
  } else {
    if (/bg-white|bg-slate-50\b/.test(orig)) { filas.push(['excepcion-superficie-clara', r, 0, '', '']); resumen.excepciones++; continue; }
    txt = orig.replace(/style=\{\{([^{}]*)\}\}/g, (_bloque, interior, off) => {
      const nuevo = interior.replace(/(^|[,\s])color:\s*'(#[0-9a-fA-F]{3,6})'/g, (mm, pre, hex, pos) => {
        const h = hex.toLowerCase();
        const token = MAPA.get(h);
        const ln = linea(orig, off + 8 + pos);
        if (!token) { filas.push(['sin-token', r, ln, h, '']); contar(resumen.sinToken, h); return mm; }
        filas.push(['reemplazado', r, ln, h, token]); resumen.reemplazados++;
        return `${pre}color: 'var(${token})'`;
      });
      return `style={{${nuevo}}}`;
    });
  }
  if (APLICAR && txt !== orig) fs.writeFileSync(f, txt, 'utf8');
}

fs.mkdirSync(path.dirname(CSV), { recursive: true });
fs.writeFileSync(CSV, filas.map((x) => x.join(',')).join('\n'), 'utf8');
console.log(`${APLICAR ? 'APLICADO' : 'SIMULACRO'} · reemplazados: ${resumen.reemplazados} · excepciones: ${resumen.excepciones} · sin token: ${[...resumen.sinToken.values()].reduce((a, b) => a + b, 0)}`);
console.log('sin token (top):', [...resumen.sinToken.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h, n]) => `${h}×${n}`).join(' '));
console.log('detalle:', rel(CSV));
