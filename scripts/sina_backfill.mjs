// Extrae del portal SINA de CONAGUA (https://sinav30.conagua.gob.mx:8080/Presas/) el cierre de cada mes de las presas
// de Chihuahua/Conchos y genera la migración semilla de public.sina_presas (ficha) y public.sina_presas_diario (crudo).
//
// El portal publica UN reporte nacional por día (≈210 presas): GET /PresasPG/presas/reporte/AAAA-MM-DD → arreglo JSON;
// un día sin dato responde 200 con []. La fecha tope sale de GET /SINA45/fechaMonitoreo/ultimo (2025-04-23 al 2026-11-11:
// el portal dejó de actualizarse). Sin autenticación. Está tras un CDN: solo GET y con pausa entre peticiones.
//
// Uso (desde conchos-digital/):
//   node scripts/sina_backfill.mjs --sql supabase/migrations/20261111130000_sina_seed_2021_2025.sql [--desde 2021-01] [--cache ruta.json]
// --cache guarda/reutiliza las respuestas ya filtradas (no vuelve a pedir fechas que ya tiene).
//
// Si el CDN del portal redirige a los clientes que no son navegador (302 en bucle, pasó el 2026-11-11), NO se disfrazan
// las peticiones: se abre la página en un navegador real (Playwright), se piden ahí las mismas URL con pausa y se guarda
// el resultado crudo como { "<fecha de cierre>": [registros del portal…] }. Ese archivo entra con --entrada:
//   node scripts/sina_backfill.mjs --entrada sina_crudo.json --sql supabase/migrations/…sql
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://sinav30.conagua.gob.mx:8080';
const PAUSA_MS = 400;
/** Presas de la cuenca del Conchos + las otras tres de Chihuahua (cuencas cerradas y Pacífico) para la etapa estatal. */
export const CLAVES_SINA = ['LBQCH', 'FIMCH', 'LLNCH', 'SGBDR', 'PAGCH', 'CHUCH', 'ERECH', 'PAZCH', 'TNTCH', 'LJSCH', 'AGZCH'];

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

/** Último día de cada mes desde `desde` (AAAA-MM) hasta el mes ANTERIOR al de `tope`; al final, `tope` tal cual. */
export function fechasDeCierre(desde, tope) {
  const [a0, m0] = desde.split('-').map(Number);
  const out = [];
  for (let a = a0, m = m0; ; m === 12 ? (a++, m = 1) : m++) {
    const fin = iso(new Date(Date.UTC(a, m, 0)));
    if (fin > tope) break;
    out.push(fin);
  }
  if (out[out.length - 1] !== tope) out.push(tope);
  return out;
}

/** null si el valor no es un número finito (el portal manda textos y huecos): S/D, nunca 0. */
export const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Quita el ruido de punto flotante del portal (2893.57104492188 → 2893.571). */
const red = (v, d = 3) => (v == null ? null : Number(v.toFixed(d)));

export function filaDiaria(r) {
  return {
    clave: r.clavesih, fecha: r.fechamonitoreo,
    elev: red(num(r.elevacionactual), 2), alm: red(num(r.almacenaactual)), llenado: red(num(r.llenano), 6),
    namoAlm: red(num(r.namoalmac)), namoElev: red(num(r.namoelev), 2), nameAlm: red(num(r.namealmac)), nameElev: red(num(r.nameelev), 2),
    id: num(r.idmonitoreodiario),
  };
}

/** El portal mezcla codificaciones («R.Â Chuviscar»): quita el residuo y compacta espacios. Vacío → null. */
const txt = (v) => {
  const t = String(v ?? '').replace(/Â/g, '').replace(/[\s ]+/g, ' ').trim();
  return t || null;
};

export function ficha(r) {
  r = { ...r, nombreoficial: txt(r.nombreoficial), nombrecomun: txt(r.nombrecomun), estado: txt(r.estado), nommunicipio: txt(r.nommunicipio), regioncna: txt(r.regioncna), uso: txt(r.uso), corriente: txt(r.corriente), tipovertedor: txt(r.tipovertedor) };
  return {
    clave: r.clavesih, oficial: r.nombreoficial, comun: r.nombrecomun, estado: r.estado, municipio: r.nommunicipio, region: r.regioncna,
    lat: num(r.latitud), lon: num(r.longitud), uso: r.uso, corriente: r.corriente, vertedor: r.tipovertedor,
    inicio: num(r.inicioop), corona: red(num(r.elevcorona), 2), bordo: red(num(r.bordolibre), 2), cortina: red(num(r.alturacortina), 2),
  };
}

async function pedir(url) {
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) throw Object.assign(new Error('el CDN del portal redirige a este cliente; usa --entrada con una captura hecha desde un navegador'), { fatal: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (e.fatal || intento >= 4) throw new Error(`${url}: ${e.message}`);
      await pausa(2000 * intento);
    }
  }
}

const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const n = (v) => (v == null ? 'NULL' : String(v));

async function principal() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const rutaSql = opt('--sql'), rutaCache = opt('--cache'), rutaEntrada = opt('--entrada');
  let desde = opt('--desde') ?? '2021-01';
  if (!rutaSql) { console.error('Uso: node scripts/sina_backfill.mjs --sql <ruta.sql> [--desde AAAA-MM] [--cache ruta.json]'); process.exit(2); }

  const cache = rutaCache && existsSync(rutaCache) ? JSON.parse(readFileSync(rutaCache, 'utf8')) : { dias: {}, fichas: {} };
  const sinDato = [];
  let tope;
  if (rutaEntrada) {
    // Captura hecha desde un navegador: { fechaCierre: [registros crudos] }.
    const crudo = JSON.parse(readFileSync(rutaEntrada, 'utf8'));
    for (const fechaCierre of Object.keys(crudo).sort()) {
      const filas = crudo[fechaCierre].filter((r) => CLAVES_SINA.includes(r.clavesih));
      if (!filas.length) { sinDato.push(fechaCierre); continue; }
      cache.dias[fechaCierre] = filas.map(filaDiaria);
      for (const r of filas) cache.fichas[r.clavesih] = ficha(r);
    }
    const fechas = Object.values(cache.dias).flat().map((d) => d.fecha).sort();
    desde = fechas[0].slice(0, 7); tope = fechas[fechas.length - 1];
    console.error(`Entrada ${rutaEntrada}: ${Object.keys(crudo).length} fechas, ${desde} → ${tope}`);
  } else {
    tope = (await pedir(`${BASE}/SINA45/fechaMonitoreo/ultimo`))[0].fecha;
    console.error(`Fecha más reciente con datos en el portal: ${tope}`);
  }

  for (const fechaCierre of rutaEntrada ? [] : fechasDeCierre(desde, tope)) {
    if (cache.dias[fechaCierre]) continue;
    // Si el día del cierre no trae datos se retrocede hasta 3 días; la fila conserva SU fecha real.
    let filas = [], fecha = fechaCierre;
    for (let atras = 0; atras <= 3; atras++) {
      const d = new Date(`${fechaCierre}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - atras);
      fecha = iso(d);
      const arr = await pedir(`${BASE}/PresasPG/presas/reporte/${fecha}`);
      await pausa(PAUSA_MS);
      if (Array.isArray(arr) && arr.length) { filas = arr.filter((r) => CLAVES_SINA.includes(r.clavesih)); break; }
    }
    if (!filas.length) { sinDato.push(fechaCierre); cache.dias[fechaCierre] = []; continue; }
    cache.dias[fechaCierre] = filas.map(filaDiaria);
    for (const r of filas) cache.fichas[r.clavesih] = ficha(r); // la más reciente gana
    console.error(`  ${fechaCierre}${fecha !== fechaCierre ? ` (dato del ${fecha})` : ''}: ${filas.length} presas`);
    if (rutaCache) writeFileSync(rutaCache, JSON.stringify(cache));
  }
  if (rutaCache) writeFileSync(rutaCache, JSON.stringify(cache));

  const diarias = Object.values(cache.dias).flat().sort((a, b) => a.clave.localeCompare(b.clave) || a.fecha.localeCompare(b.fecha));
  const fichas = Object.values(cache.fichas).sort((a, b) => a.clave.localeCompare(b.clave));
  const faltan = CLAVES_SINA.filter((c) => !cache.fichas[c]);
  if (faltan.length) console.error(`AVISO: claves sin ningún dato en el portal: ${faltan.join(', ')}`);
  if (sinDato.length) console.error(`AVISO: cierres sin dato (ni 3 días antes): ${sinDato.join(', ')}`);

  const hoy = iso(new Date());
  // NAMO/NAME cambian pocas veces: se escriben como vigencias y la fila diaria queda en clave, fecha, elevación,
  // almacenamiento e id (semilla compacta, aplicable por MCP). llenado_frac = almacenamiento / NAMO del día.
  const vig = [];
  for (const d of diarias) {
    const k = [d.namoAlm, d.namoElev, d.nameAlm, d.nameElev].join('|');
    const u = vig[vig.length - 1];
    if (u && u.clave === d.clave && u.k === k) u.hasta = d.fecha;
    else vig.push({ clave: d.clave, k, desde: d.fecha, hasta: d.fecha, ...d });
  }
  const descuadre = diarias.filter((d) => d.alm != null && d.namoAlm && d.llenado != null && Math.abs(d.alm / d.namoAlm - d.llenado) > 2e-6);
  if (descuadre.length) console.error(`AVISO: ${descuadre.length} filas cuyo llenado del portal no es almacenamiento/NAMO (se guarda el cociente)`);
  const suma = (f) => diarias.reduce((t, d) => t + (f(d) ?? 0), 0);
  console.error(`Control: ${diarias.length} filas, Σ almacenamiento = ${suma((d) => d.alm).toFixed(3)}, Σ elevación = ${suma((d) => d.elev).toFixed(2)}, ${vig.length} vigencias de NAMO/NAME`);

  const sql = `-- SINA CONAGUA: ficha y cierres de mes ${desde} → ${tope} (generado por scripts/sina_backfill.mjs el ${hoy}).
-- Fuente: ${BASE}/PresasPG/presas/reporte/{fecha}. ${diarias.length} filas, ${fichas.length} presas.
-- El portal dejó de actualizarse el ${tope}; la última fila de cada presa NO es un cierre de mes si esa fecha no es fin de mes.
-- Control: Σ almacenamiento = ${suma((d) => d.alm).toFixed(3)} Mm³, Σ elevación = ${suma((d) => d.elev).toFixed(2)} m.
INSERT INTO public.sina_presas
  (clave_sih, nombre_oficial, nombre_comun, estado, municipio, region_cna, latitud, longitud, uso, corriente, tipo_vertedor, inicio_operacion, elev_corona_msnm, bordo_libre_m, altura_cortina_m)
VALUES
${fichas.map((f) => `(${q(f.clave)}, ${q(f.oficial)}, ${q(f.comun)}, ${q(f.estado)}, ${q(f.municipio)}, ${q(f.region)}, ${n(f.lat)}, ${n(f.lon)}, ${q(f.uso)}, ${q(f.corriente)}, ${q(f.vertedor)}, ${n(f.inicio)}, ${n(f.corona)}, ${n(f.bordo)}, ${n(f.cortina)})`).join(',\n')}
ON CONFLICT (clave_sih) DO UPDATE SET
  nombre_oficial = EXCLUDED.nombre_oficial, nombre_comun = EXCLUDED.nombre_comun, estado = EXCLUDED.estado, municipio = EXCLUDED.municipio,
  region_cna = EXCLUDED.region_cna, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, uso = EXCLUDED.uso, corriente = EXCLUDED.corriente,
  tipo_vertedor = EXCLUDED.tipo_vertedor, inicio_operacion = EXCLUDED.inicio_operacion, elev_corona_msnm = EXCLUDED.elev_corona_msnm,
  bordo_libre_m = EXCLUDED.bordo_libre_m, altura_cortina_m = EXCLUDED.altura_cortina_m, actualizado_en = now();

WITH vig (clave, desde, hasta, namo_mm3, namo_msnm, name_mm3, name_msnm) AS (VALUES
${vig.map((v) => `(${q(v.clave)}, DATE ${q(v.desde)}, DATE ${q(v.hasta)}, ${n(v.namoAlm)}::numeric, ${n(v.namoElev)}::numeric, ${n(v.nameAlm)}::numeric, ${n(v.nameElev)}::numeric)`).join(',\n')}
), d (clave, fecha, elev, alm, id) AS (VALUES
${diarias.map((d, i) => `(${q(d.clave)},${i ? '' : 'DATE '}${q(d.fecha)},${n(d.elev)}${i ? '' : '::numeric'},${n(d.alm)}${i ? '' : '::numeric'},${n(d.id)}${i ? '' : '::bigint'})`).join(',\n')}
)
INSERT INTO public.sina_presas_diario
  (clave_sih, fecha, elevacion_msnm, almacenamiento_mm3, llenado_frac, namo_mm3, namo_msnm, name_mm3, name_msnm, id_monitoreo)
SELECT d.clave, d.fecha::date, d.elev, d.alm,
       CASE WHEN v.namo_mm3 > 0 AND d.alm IS NOT NULL THEN round(d.alm / v.namo_mm3, 6) END,
       v.namo_mm3, v.namo_msnm, v.name_mm3, v.name_msnm, d.id
FROM d LEFT JOIN vig v ON v.clave = d.clave AND d.fecha::date BETWEEN v.desde AND v.hasta
ON CONFLICT (clave_sih, fecha) DO UPDATE SET
  elevacion_msnm = EXCLUDED.elevacion_msnm, almacenamiento_mm3 = EXCLUDED.almacenamiento_mm3, llenado_frac = EXCLUDED.llenado_frac,
  namo_mm3 = EXCLUDED.namo_mm3, namo_msnm = EXCLUDED.namo_msnm, name_mm3 = EXCLUDED.name_mm3, name_msnm = EXCLUDED.name_msnm,
  id_monitoreo = EXCLUDED.id_monitoreo, consultado_en = now();
`;
  writeFileSync(rutaSql, sql);
  console.error(`→ ${rutaSql}: ${diarias.length} filas diarias, ${fichas.length} fichas (${(sql.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/sina_backfill.mjs')) await principal();
