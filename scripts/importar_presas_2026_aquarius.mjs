// Importador del export Aquarius/USIBWC 2026 (Boquilla y Madero: fecha + volumen Mm3) → SQL idempotente.
//   Uso:  node scripts/importar_presas_2026_aquarius.mjs [carpeta=public/REPORTES_PRESAS/REPORTE_PRESAS_2026] [salida=supabase/migrations/20261008100000_historico_presas_2026.sql]
// El libro trae SOLO volumen. La escala (msnm) se obtiene invirtiendo la curva vigente (curvas_capacidad) y el %
// con presas.capacidad_max, igual que el resto de presas_historico_diario. Se carga en esa tabla (no en lecturas_presas):
// v_presas_serie_diaria deja prevalecer la lectura operativa/CILA/campo cuando existe.
// Reglas: S/D nunca cero (filas con 0 = apagón del sensor, marcas 00:00:01 / 23:59:59 → se descartan);
// decimales con coma ("693,84") se normalizan; picos imposibles se guardan como REVISAR sin escala ni %.
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const DIR = path.resolve(process.argv[2] ?? 'public/REPORTES_PRESAS/REPORTE_PRESAS_2026');
const SALIDA = path.resolve(process.argv[3] ?? 'supabase/migrations/20261008100000_historico_presas_2026.sql');
const LIBROS = [
  { archivo: 'Boquilla 2026.xlsx', p: 'PRE-001', epoca: 'LEV-2020', cap: 2846.782 },
  { archivo: 'Virgenes 2026.xlsx', p: 'PRE-002', epoca: 'TABLA-SRL', cap: 333.32 },
];
// Un valor se marca REVISAR si se aparta de AMBOS vecinos más de este umbral y los vecinos sí concuerdan entre sí.
const UMBRAL_PICO_MM3 = 25;
const UMBRAL_VECINOS_MM3 = 10;

// Correcciones confirmadas por el usuario (2026-10-08) a valores mal tecleados en el export.
const CORRECCIONES = { 'PRE-002|2026-09-16': 164.961, 'PRE-002|2026-04-06': 229.462 };

const aNumero = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const avisos = [];
const filasSql = [];
for (const l of LIBROS) {
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, l.archivo)));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
  const dias = new Map();
  for (const r of rows) {
    const m = String(r?.[0] ?? '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
    if (!m) continue;
    const v = aNumero(r[2] ?? r[1]);
    if (m[2] !== '00:00:00') { avisos.push(`${l.p} ${m[1]} ${m[2]} descartada (marca fuera de las 00:00)`); continue; }
    if (v === null || v <= 0) { avisos.push(`${l.p} ${m[1]} sin valor válido (${r[2]}) → S/D`); continue; }
    if (typeof (r[2] ?? r[1]) === 'string') avisos.push(`${l.p} ${m[1]} texto "${r[2] ?? r[1]}" → ${v}`);
    const corr = CORRECCIONES[`${l.p}|${m[1]}`];
    if (corr !== undefined) avisos.push(`${l.p} ${m[1]} corregido por el usuario: ${v} → ${corr}`);
    dias.set(m[1], corr ?? v);
  }
  const fechas = [...dias.keys()].sort();
  fechas.forEach((f, i) => {
    const v = dias.get(f), a = dias.get(fechas[i - 1]), b = dias.get(fechas[i + 1]);
    const pico = a != null && b != null && Math.abs(v - a) > UMBRAL_PICO_MM3 && Math.abs(v - b) > UMBRAL_PICO_MM3 && Math.abs(a - b) < UMBRAL_VECINOS_MM3;
    if (pico) avisos.push(`${l.p} ${f} pico atípico ${v} (vecinos ${a} y ${b}) → REVISAR`);
    filasSql.push(`('${l.p}','${f}',${v},${pico ? 'true' : 'false'},'${l.archivo}','${l.epoca}',${l.cap})`);
  });
  console.log(`${l.archivo}: ${fechas.length} días válidos (${fechas[0]} → ${fechas.at(-1)})`);
}

const sql = `-- Histórico de presas 2026 (ene-oct) — export Aquarius/USIBWC (generado por scripts/importar_presas_2026_aquarius.mjs)
-- ${filasSql.length} filas (presa×día). Idempotente. Escala = inversa de curvas_capacidad; % = volumen / capacidad_max.
-- Aplicar con: npx supabase db query --linked -f <este archivo>   (NO db push)
WITH v(p, f, vol, pico, arch, epoca, cap) AS (VALUES
${filasSql.join(',\n')}
), c AS (
  SELECT v.*, lo.e AS e_lo, lo.vl AS v_lo, hi.e AS e_hi, hi.vl AS v_hi
  FROM v
  LEFT JOIN LATERAL (SELECT cc.elevacion_msnm AS e, cc.volumen_mm3 AS vl FROM public.curvas_capacidad cc
                     WHERE cc.presa_id = v.p AND cc.volumen_mm3 <= v.vol ORDER BY cc.volumen_mm3 DESC, cc.elevacion_msnm DESC LIMIT 1) lo ON true
  LEFT JOIN LATERAL (SELECT cc.elevacion_msnm AS e, cc.volumen_mm3 AS vl FROM public.curvas_capacidad cc
                     WHERE cc.presa_id = v.p AND cc.volumen_mm3 >= v.vol ORDER BY cc.volumen_mm3 ASC, cc.elevacion_msnm ASC LIMIT 1) hi ON true
), e AS (
  SELECT c.*,
    CASE WHEN c.e_lo IS NULL OR c.e_hi IS NULL THEN NULL
         WHEN c.v_hi = c.v_lo THEN c.e_lo
         ELSE c.e_lo + (c.vol - c.v_lo) / (c.v_hi - c.v_lo) * (c.e_hi - c.e_lo) END AS esc
  FROM c
)
INSERT INTO public.presas_historico_diario
  (presa_id, fecha, escala_msnm, almacenamiento_reportado_mm3, pct_reportado, cap_base_reportada_mm3, curva_epoca,
   archivo_origen, almacenamiento_norm_mm3, pct_norm, calidad)
SELECT e.p, e.f::date,
       CASE WHEN NOT e.pico THEN round(e.esc::numeric, 2) END,
       e.vol, round((e.vol / e.cap * 100)::numeric, 4), e.cap, e.epoca, e.arch,
       CASE WHEN NOT e.pico AND e.esc IS NOT NULL THEN e.vol END,
       CASE WHEN NOT e.pico AND e.esc IS NOT NULL THEN round((e.vol / e.cap * 100)::numeric, 4) END,
       CASE WHEN e.pico THEN 'REVISAR' WHEN e.esc IS NULL THEN 'FUERA_DE_RANGO' ELSE 'OK' END
FROM e
ON CONFLICT (presa_id, fecha) DO UPDATE SET
  escala_msnm = EXCLUDED.escala_msnm, almacenamiento_reportado_mm3 = EXCLUDED.almacenamiento_reportado_mm3,
  pct_reportado = EXCLUDED.pct_reportado, cap_base_reportada_mm3 = EXCLUDED.cap_base_reportada_mm3,
  curva_epoca = EXCLUDED.curva_epoca, archivo_origen = EXCLUDED.archivo_origen,
  almacenamiento_norm_mm3 = EXCLUDED.almacenamiento_norm_mm3, pct_norm = EXCLUDED.pct_norm, calidad = EXCLUDED.calidad;
`;
fs.writeFileSync(SALIDA, sql);
console.log(`✓ ${path.relative(process.cwd(), SALIDA)} (${filasSql.length} filas)`);
console.log(avisos.length ? 'Avisos:\n - ' + avisos.join('\n - ') : 'Sin avisos');
