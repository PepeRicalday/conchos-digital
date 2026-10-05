// Importador de los reportes mensuales de presas de la SRL (Boquilla y Madero) → SQL idempotente.
//   Uso:  node scripts/importar_historico_presas.mjs [carpeta=public/REPORTES_PRESAS] [salida=supabase/migrations]
// Lee cada libro (hoja «Datos de Presas»), valida su estructura y genera:
//   · <salida>/<ts>_historico_presas_<AAAA>.sql  (INSERT … ON CONFLICT (presa_id,fecha) DO UPDATE; re-ejecutable)
//   · reporte_calidad_historico.md               (conteos por mes, huecos y avisos)
// La normalización (volumen y % con la curva vigente) y la columna `calidad` se calculan EN SQL, con
// fn_vol_desde_escala() y presas.capacidad_max, para que el criterio sea uno solo.
// Regla "S/D nunca cero": celda vacía o con texto → NULL (jamás 0).
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const RAIZ = path.resolve(process.argv[2] ?? 'public/REPORTES_PRESAS');
const SALIDA = path.resolve(process.argv[3] ?? 'supabase/migrations');
const TS_BASE = 20261005160000; // las migraciones de datos se numeran a partir de aquí (+1000 por año)

// Transiciones de curva que el encabezado mensual no refleja: el libro de julio-2021 ya dice 333.32 Mm3 para Madero,
// pero del 1 al 7 los volúmenes seguían calculados con la tabla vieja (levantamiento 2004, 355.286 Mm3).
const CORRECCIONES_EPOCA = [
  { p: 'M', desde: '2021-07-01', hasta: '2021-07-07', epoca: 'LEV-2004', cap: 355.286, nota: 'volúmenes aún con la tabla 2004' },
];

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const sinAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const compacto = s => sinAcentos(s).toUpperCase().replace(/\s+/g, '');
const esNum = x => typeof x === 'number' && Number.isFinite(x);
const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

function archivosXlsx(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosXlsx(p) : /\.xlsx$/i.test(e.name) && !e.name.startsWith('~$') ? [p] : [];
  }).sort();
}

function epoca(presa, cap) {
  if (presa === 'B') return cap > 2890 ? 'CEAC-2893' : Math.abs(cap - 2846.781) < 1 ? 'LEV-2020' : 'DESCONOCIDA';
  return cap > 350 ? 'LEV-2004' : Math.abs(cap - 333.32) < 0.5 ? 'TABLA-SRL' : 'DESCONOCIDA';
}

function leerLibro(archivo) {
  const wb = XLSX.read(fs.readFileSync(archivo));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const avisos = [];

  // mes y año desde el título (tolera «A B R I L», «/ Abril 2023», acentos)
  const iTit = rows.slice(0, 12).findIndex(r => compacto(r?.[0]).includes('DATOSHIDROL'));
  if (iTit < 0) throw new Error('no se encontró el título «Datos Hidrológicos de Presas»');
  const t = compacto(rows[iTit][0]);
  const mes = MESES.findIndex(m => t.includes(m)) + 1;
  const anio = Number(t.match(/(20\d{2})/)?.[1]);
  if (!mes || !anio) throw new Error(`no se pudo leer mes/año de «${rows[iTit][0]}»`);

  // encabezado de la tabla diaria: dos celdas «DIA» (Boquilla y Madero)
  const iH = rows.findIndex(r => r?.filter(c => String(c ?? '').trim().toUpperCase() === 'DIA').length >= 2);
  if (iH < 0) throw new Error('no se encontró el encabezado DIA / DIA');
  const cols = rows[iH].map((c, i) => (String(c ?? '').trim().toUpperCase() === 'DIA' ? i : -1)).filter(i => i >= 0);
  const [cB, cM] = cols;
  for (const [nombre, c] of [['Boquilla', cB], ['Madero', cM]]) {
    const h = [1, 2, 3, 4, 5].map(k => compacto(rows[iH][c + k]));
    if (!h[0].startsWith('ESCALA') || !h[2].startsWith('ALMACEN')) throw new Error(`encabezado inesperado en ${nombre}: ${h.join('|')}`);
  }

  // capacidad del encabezado de cada presa (fila «Almacenam. total: 2,846.781 Mm3 / ELEV. 1,317»)
  const iCap = rows.slice(0, iH).findIndex(r => compacto(r?.[cB]).includes('ALMACENAM'));
  const cap = c => Number(String(rows[iCap]?.[c] ?? '').match(/([\d,]+\.\d+)/)?.[1].replace(/,/g, ''));
  const capB = cap(cB), capM = cap(cM);
  if (!(capB > 0) || !(capM > 0)) avisos.push('capacidad del encabezado ilegible');

  const dMax = diasDelMes(anio, mes);
  const filas = [];
  let omitidos = 0;
  for (let i = iH + 1; i < Math.min(rows.length, iH + 33); i++) {
    const r = rows[i];
    const d = r?.[cB];
    if (!esNum(d) || d < 1 || d > 31) continue;
    if (d > dMax) { omitidos++; continue; }
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    for (const [p, c] of [['B', cB], ['M', cM]]) {
      const v = k => (esNum(r[c + k]) ? r[c + k] : null);
      for (let k = 1; k <= 5; k++) if (typeof r[c + k] === 'string' && r[c + k].trim() !== '') avisos.push(`${fecha} ${p}: texto «${r[c + k].trim().slice(0, 12)}» en columna ${k}`);
      const pct = v(5);
      filas.push({ p, fecha, e: v(1), dm: v(2), vr: v(3), dv: v(4), pct: pct == null ? null : pct <= 1.5 ? pct * 100 : pct });
    }
  }
  if (filas.length === 0) throw new Error('no se leyeron días');
  return { anio, mes, capB, capM, filas, avisos, omitidos };
}

const lit = (x, d) => (x == null ? 'NULL' : String(+x.toFixed(d)));
const q = s => `'${String(s).replace(/'/g, "''")}'`;

const porAnio = new Map();
const reporte = [];
for (const archivo of archivosXlsx(RAIZ)) {
  const nombre = path.basename(archivo);
  try {
    const L = leerLibro(archivo);
    (porAnio.get(L.anio) ?? porAnio.set(L.anio, []).get(L.anio)).push({ nombre, ...L });
    const cB = L.filas.filter(f => f.p === 'B'), cM = L.filas.filter(f => f.p === 'M');
    reporte.push({ nombre, anio: L.anio, mes: L.mes, dias: cB.length, escB: cB.filter(f => f.e != null).length, escM: cM.filter(f => f.e != null).length, capB: L.capB, capM: L.capM, avisos: L.avisos });
  } catch (err) {
    reporte.push({ nombre, error: err.message });
    console.error(`✗ ${nombre}: ${err.message}`);
  }
}

fs.mkdirSync(SALIDA, { recursive: true });
let total = 0;
[...porAnio.keys()].sort().forEach((anio, idx) => {
  const libros = porAnio.get(anio).sort((a, b) => a.mes - b.mes);
  const meta = libros.flatMap(l => {
    const ym = `${l.anio}-${String(l.mes).padStart(2, '0')}`;
    return [`(${q(ym)},'B',${q(l.nombre)},${l.capB},${q(epoca('B', l.capB))})`, `(${q(ym)},'M',${q(l.nombre)},${l.capM},${q(epoca('M', l.capM))})`];
  });
  const valores = libros.flatMap(l => l.filas.map(f => `(${q(f.p)},'${f.fecha}',${lit(f.e, 2)},${lit(f.vr, 3)},${lit(f.pct, 4)},${lit(f.dm, 2)},${lit(f.dv, 3)})`));
  total += valores.length;
  const sql = `-- Histórico de presas ${anio} — reportes mensuales SRL (generado por scripts/importar_historico_presas.mjs)
-- ${libros.length} libros, ${valores.length} filas (presa×día). Idempotente: re-ejecutar actualiza, no duplica.
-- B = La Boquilla (PRE-001), M = Fco. I. Madero (PRE-002). Normalización y calidad se calculan aquí con fn_vol_desde_escala().
WITH meta(ym, p, arch, cap, epoca) AS (VALUES
${meta.join(',\n')}
), v(p, f, e, vr, pr, dm, dv) AS (VALUES
${valores.join(',\n')}
)
INSERT INTO public.presas_historico_diario
  (presa_id, fecha, escala_msnm, almacenamiento_reportado_mm3, pct_reportado, dif_mts_reportada, dif_mm3_reportada,
   cap_base_reportada_mm3, curva_epoca, archivo_origen, almacenamiento_norm_mm3, pct_norm, calidad)
SELECT pr.id, v.f::date, v.e::numeric, v.vr::numeric, v.pr::numeric, v.dm::numeric, v.dv::numeric,
       m.cap, m.epoca, m.arch, x.vn,
       CASE WHEN x.vn IS NOT NULL THEN round((x.vn / pr.capacidad_max * 100)::numeric, 4) END,
       CASE WHEN v.e IS NULL THEN 'SIN_DATO'
            WHEN x.vn IS NULL THEN 'FUERA_DE_RANGO'
            WHEN m.epoca IN ('LEV-2020', 'TABLA-SRL') AND v.vr IS NOT NULL AND abs(v.vr::numeric - x.vn) > 2 THEN 'REVISAR'
            ELSE 'OK' END
FROM v
JOIN meta m ON m.ym = to_char(v.f::date, 'YYYY-MM') AND m.p = v.p
JOIN public.presas pr ON pr.id = CASE v.p WHEN 'B' THEN 'PRE-001' ELSE 'PRE-002' END
CROSS JOIN LATERAL (SELECT round(public.fn_vol_desde_escala(pr.id, v.e::numeric), 3) AS vn) x
ON CONFLICT (presa_id, fecha) DO UPDATE SET
  escala_msnm = EXCLUDED.escala_msnm, almacenamiento_reportado_mm3 = EXCLUDED.almacenamiento_reportado_mm3,
  pct_reportado = EXCLUDED.pct_reportado, dif_mts_reportada = EXCLUDED.dif_mts_reportada,
  dif_mm3_reportada = EXCLUDED.dif_mm3_reportada, cap_base_reportada_mm3 = EXCLUDED.cap_base_reportada_mm3,
  curva_epoca = EXCLUDED.curva_epoca, archivo_origen = EXCLUDED.archivo_origen,
  almacenamiento_norm_mm3 = EXCLUDED.almacenamiento_norm_mm3, pct_norm = EXCLUDED.pct_norm, calidad = EXCLUDED.calidad;
`;
  const corr = CORRECCIONES_EPOCA.filter(c => c.desde.startsWith(String(anio)));
  const sqlCorr = corr.map(c => `
-- Corrección de época (${c.nota}): ${c.p === 'B' ? 'Boquilla' : 'Madero'} ${c.desde} a ${c.hasta}
UPDATE public.presas_historico_diario
SET curva_epoca = ${q(c.epoca)}, cap_base_reportada_mm3 = ${c.cap}, calidad = 'OK'
WHERE presa_id = ${q(c.p === 'B' ? 'PRE-001' : 'PRE-002')} AND fecha BETWEEN ${q(c.desde)} AND ${q(c.hasta)}
  AND calidad = 'REVISAR';`).join('\n');
  const f = path.join(SALIDA, `${TS_BASE + idx * 1000}_historico_presas_${anio}.sql`);
  fs.writeFileSync(f, sql + sqlCorr + (sqlCorr ? '\n' : ''));
  console.log(`✓ ${path.relative(process.cwd(), f)}  (${libros.length} libros, ${valores.length} filas, ${(sql.length / 1024).toFixed(0)} kB)`);
});

// ── reporte de calidad ─────────────────────────────────────────────────────────
const linea = r => r.error
  ? `| ${r.nombre} | — | ERROR | ${r.error} |`
  : `| ${r.nombre} | ${r.anio}-${String(r.mes).padStart(2, '0')} | ${r.dias} | Boq ${r.escB}/${r.dias} · Mad ${r.escM}/${r.dias} | ${r.capB} / ${r.capM} | ${r.avisos.length ? r.avisos.slice(0, 3).join('; ') : ''} |`;
const presentes = new Set(reporte.filter(r => !r.error).map(r => `${r.anio}-${String(r.mes).padStart(2, '0')}`));
const anios = [...new Set(reporte.filter(r => !r.error).map(r => r.anio))].sort();
const faltan = [];
for (let a = anios[0]; a <= anios.at(-1); a++) for (let m = 1; m <= 12; m++) { const k = `${a}-${String(m).padStart(2, '0')}`; if (!presentes.has(k)) faltan.push(k); }
const md = `# Reporte de calidad — histórico de presas
Generado: ${new Date().toISOString().slice(0, 10)} · carpeta: \`${path.relative(process.cwd(), RAIZ)}\` · ${reporte.filter(r => !r.error).length} libros · ${total} filas (presa×día)

**Meses sin archivo:** ${faltan.length ? faltan.join(', ') : 'ninguno'}

| Archivo | Mes | Días | Días con escala | Cap. Boq / Mad (Mm³) | Avisos |
|---|---|---|---|---|---|
${reporte.map(linea).join('\n')}

La columna \`calidad\` definitiva (OK / SIN_DATO / REVISAR / FUERA_DE_RANGO) se calcula en la base de datos.
`;
fs.writeFileSync(path.resolve('reporte_calidad_historico.md'), md);
console.log(`\nMeses sin archivo: ${faltan.join(', ') || 'ninguno'} · errores de lectura: ${reporte.filter(r => r.error).length} · reporte_calidad_historico.md`);
