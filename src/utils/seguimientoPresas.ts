/**
 * seguimientoPresas — analiza el texto plano «Seguimiento de presas» (un párrafo por presa) y lo convierte en lecturas
 * validadas. Lógica PURA: sin React ni Supabase. Regla: lo que no viene en el texto es null (S/D), jamás 0; un «0.00»
 * escrito en el texto sí es un dato (extracción cerrada).
 *
 * Formato esperado de cada presa:
 *   -La presa <nombre> a las HH:MM h del DD/MM/AAAA , se encuentra al P% con una elevación de E msnm, con un almacenamiento
 *    de A Millones de m³, D abajo el NAMO (EN msnm, VN Millones de m³). con una extracción total de X m³/s, y un ingreso de I m³/s.
 */

export interface PresaCatalogo {
  clave: string;
  nombre: string;
  /** Presa del distrito (tabla presas / lecturas_presas). */
  presaId: string | null;
  /** Cuerpo de agua del catálogo de cuenca. */
  cuerpoId: string | null;
  /** Ubicación AQUARIUS (para completar la vista de la cuenca). */
  aqwpUbicacionId: number | null;
  /** NAMO de referencia de SICA (Mm³) para contrastar el que trae el texto. */
  namoRefMm3: number | null;
  /** Capacidad que se usa SIEMPRE para esta presa, sin importar el NAMO que traiga el texto (Madero: 333.32 Mm³). */
  namoFijoMm3?: number;
  alias: string[];
}

export const PRESAS_SEGUIMIENTO: PresaCatalogo[] = [
  { clave: 'boquilla', nombre: 'La Boquilla', presaId: 'PRE-001', cuerpoId: 'CA-LBQCH', aqwpUbicacionId: 536, namoRefMm3: 2846.782, alias: ['boquilla', 'la boquilla'] },
  { clave: 'madero', nombre: 'F. I. Madero (Las Vírgenes)', presaId: 'PRE-002', cuerpoId: 'CA-FIMCH', aqwpUbicacionId: 537, namoRefMm3: 333.32, namoFijoMm3: 333.32, alias: ['las virgenes', 'virgenes', 'madero', 'francisco i madero', 'f i madero'] },
  { clave: 'granero', nombre: 'Luis L. León (El Granero)', presaId: null, cuerpoId: 'CA-LLNCH', aqwpUbicacionId: 526, namoRefMm3: 284.382, alias: ['el granero', 'granero', 'luis l leon', 'luis leon'] },
  { clave: 'gonzalez', nombre: 'A. González', presaId: null, cuerpoId: null, aqwpUbicacionId: null, namoRefMm3: 79.354, alias: ['a gonzalez', 'abraham gonzalez'] },
  { clave: 'lajas', nombre: 'Las Lajas', presaId: null, cuerpoId: null, aqwpUbicacionId: null, namoRefMm3: 83.266, alias: ['las lajas', 'lajas'] },
  { clave: 'tintero', nombre: 'El Tintero', presaId: null, cuerpoId: null, aqwpUbicacionId: null, namoRefMm3: 125.075, alias: ['el tintero', 'tintero'] },
  { clave: 'chihuahua', nombre: 'Chihuahua', presaId: null, cuerpoId: 'CA-CHUCH', aqwpUbicacionId: 538, namoRefMm3: 23.383, alias: ['chihuahua'] },
  { clave: 'rejon', nombre: 'El Rejón', presaId: null, cuerpoId: 'CA-ERECH', aqwpUbicacionId: 539, namoRefMm3: 6.528, alias: ['el rejon', 'rejon'] },
  { clave: 'san_gabriel', nombre: 'San Gabriel', presaId: null, cuerpoId: 'CA-SGBDR', aqwpUbicacionId: 541, namoRefMm3: 245.431, alias: ['san gabriel', 'federalismo mexicano'] },
  { clave: 'pico_aguila', nombre: 'Pico del Águila', presaId: null, cuerpoId: 'CA-PAGCH', aqwpUbicacionId: 540, namoRefMm3: 48.276, alias: ['pico de aguila', 'pico del aguila'] },
];

/** Capacidad fija por presa del distrito (Mm³): la usan la captura, el % de llenado y la infografía. Madero SIEMPRE 333.32. */
export const CAPACIDAD_FIJA_MM3: Record<string, number> = { 'PRE-002': 333.32 };

export type SeveridadAviso = 'error' | 'aviso';
export interface AvisoSeguimiento { severidad: SeveridadAviso; texto: string }

export interface LecturaSeguimiento {
  clave: string;
  nombreReportado: string;
  catalogo: PresaCatalogo | null;
  /** AAAA-MM-DD (día local de Chihuahua) y HH:MM. */
  fecha: string | null;
  hora: string | null;
  pct: number | null;
  elevacionMsnm: number | null;
  almacenamientoMm3: number | null;
  /** Diferencia con el NAMO en Mm³: positiva = abajo del NAMO, negativa = arriba. */
  difNamoMm3: number | null;
  namoMsnm: number | null;
  namoMm3: number | null;
  extraccionM3s: number | null;
  ingresoM3s: number | null;
  avisos: AvisoSeguimiento[];
  /** Con algún error la lectura no se guarda. */
  valida: boolean;
  parrafo: string;
}

export interface ResultadoSeguimiento {
  lecturas: LecturaSeguimiento[];
  /** Fecha del encabezado («Dl Chihuahua 11 de noviembre 2026»), si viene. */
  fechaEncabezado: string | null;
  /** Presas del catálogo que no vinieron en el texto. */
  faltantes: PresaCatalogo[];
  avisosGenerales: AvisoSeguimiento[];
}

const MESES: Record<string, string> = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normalizarNombre = (s: string): string =>
  sinAcentos(s).toLowerCase().replace(/,\s*[a-z.]{2,8}\.?\s*$/i, '').replace(/^presa\s+/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function buscarPresa(nombre: string): PresaCatalogo | null {
  const n = normalizarNombre(nombre.replace(/,\s*(chih|dgo|chih\.|dgo\.)\.?\s*$/i, ''));
  return PRESAS_SEGUIMIENTO.find((p) => p.alias.includes(n)) ?? null;
}

const NUM = '(-?\\d[\\d,]*(?:\\.\\d+)?|-?\\.\\d+)';
const aNumero = (s: string | undefined): number | null => {
  if (s == null) return null;
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};
const primero = (t: string, re: RegExp) => t.match(re);

/** Fecha del encabezado («11 de noviembre 2026»); null si no se reconoce. */
export function fechaDeEncabezado(texto: string): string | null {
  const m = sinAcentos(texto).toLowerCase().match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (!m || !MESES[m[2]]) return null;
  return `${m[3]}-${MESES[m[2]]}-${m[1].padStart(2, '0')}`;
}

/** Corta el texto en un párrafo por presa (inicia en «La presa»). */
export function separarParrafos(texto: string): string[] {
  const plano = texto.replace(/\r/g, '').replace(/ /g, ' ');
  const partes = plano.split(/(?=(?:^|\n|\s)-?\s*La\s+presa\s)/i).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /la\s+presa\s/i.test(p));
  return partes.map((p) => p.replace(/^-\s*/, ''));
}

export function analizarParrafo(parrafo: string): LecturaSeguimiento {
  const avisos: AvisoSeguimiento[] = [];
  const err = (t: string) => avisos.push({ severidad: 'error', texto: t });
  const av = (t: string) => avisos.push({ severidad: 'aviso', texto: t });

  const mNom = primero(parrafo, /presa\s+(.+?)\s+a\s+las\s/i);
  const nombreReportado = mNom ? mNom[1].trim() : '';
  const catalogo = nombreReportado ? buscarPresa(nombreReportado) : null;
  if (!nombreReportado) err('No se encontró el nombre de la presa.');
  else if (!catalogo) err(`«${nombreReportado}» no está en el catálogo de presas; no se guardará.`);

  const mF = primero(parrafo, /a\s+las\s+(\d{1,2}):(\d{2})\s*h?\s+del\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const fecha = mF ? `${mF[5]}-${mF[4].padStart(2, '0')}-${mF[3].padStart(2, '0')}` : null;
  const hora = mF ? `${mF[1].padStart(2, '0')}:${mF[2]}` : null;
  if (!mF) err('No se encontró la fecha y hora («a las 07:00 h del 11/11/2026»).');

  const pct = aNumero(primero(parrafo, new RegExp(`se\\s+encuentra\\s+al\\s+${NUM}\\s*%`, 'i'))?.[1]);
  const elevacionMsnm = aNumero(primero(parrafo, new RegExp(`elevaci[oó]n\\s+de\\s+${NUM}\\s*msnm`, 'i'))?.[1]);
  const almacenamientoMm3 = aNumero(primero(parrafo, new RegExp(`almacenamiento\\s+de\\s+${NUM}\\s*millones`, 'i'))?.[1]);
  const mN = primero(parrafo, new RegExp(`${NUM}\\s+(abajo|arriba)\\s+(?:del|de|el|al)\\s+NAMO\\s*\\(\\s*${NUM}\\s*msnm\\s*,\\s*${NUM}\\s*millones`, 'i'));
  const difAbs = mN ? aNumero(mN[1]) : null;
  const difNamoMm3 = difAbs == null || !mN ? null : mN[2].toLowerCase() === 'arriba' ? -difAbs : difAbs;
  const namoMsnm = mN ? aNumero(mN[3]) : null, namoMm3 = mN ? aNumero(mN[4]) : null;
  const extraccionM3s = aNumero(primero(parrafo, new RegExp(`extracci[oó]n\\s+total\\s+de\\s+${NUM}\\s*m`, 'i'))?.[1]);
  const ingresoM3s = aNumero(primero(parrafo, new RegExp(`ingreso\\s+de\\s+${NUM}\\s*m`, 'i'))?.[1]);

  if (almacenamientoMm3 == null) err('Falta el almacenamiento (Mm³).');
  else if (almacenamientoMm3 < 0) err('Almacenamiento negativo.');
  if (elevacionMsnm == null) av('Sin elevación (msnm): quedará S/D.');
  else if (elevacionMsnm < 800 || elevacionMsnm > 3500) err(`Elevación fuera de rango (${elevacionMsnm} msnm).`);
  if (pct == null) av('Sin porcentaje de llenado: se calculará con el NAMO de SICA.');
  else if (pct < 0 || pct > 120) err(`Porcentaje fuera de rango (${pct} %).`);
  if (extraccionM3s == null) av('Sin extracción: quedará S/D.');
  else if (extraccionM3s < 0 || extraccionM3s > 400) err(`Extracción fuera de rango (${extraccionM3s} m³/s).`);
  if (ingresoM3s != null && (ingresoM3s < 0 || ingresoM3s > 2000)) err(`Ingreso fuera de rango (${ingresoM3s} m³/s).`);

  // Capacidad fija (Madero 333.32): el NAMO del texto se ignora y todo se calcula con la capacidad fija.
  let namoFinal = namoMm3, difFinal = difNamoMm3;
  const fija = catalogo?.namoFijoMm3;
  if (fija != null) {
    if (namoMm3 != null && Math.abs(namoMm3 - fija) / fija > 0.005) av(`Se usa siempre ${fija} Mm³ de capacidad; el NAMO del texto (${namoMm3} Mm³) se ignora.`);
    namoFinal = fija;
    difFinal = almacenamientoMm3 != null ? Math.round((fija - almacenamientoMm3) * 1000) / 1000 : null;
    if (pct != null && almacenamientoMm3 != null && Math.abs((almacenamientoMm3 / fija) * 100 - pct) > 0.5) av(`El % (${pct}) no corresponde a ${fija} Mm³ de capacidad (${((almacenamientoMm3 / fija) * 100).toFixed(2)} %): revisar la cifra.`);
  } else {
    // Coherencias internas del propio texto: delatan un número mal tecleado o un NAMO de otra época.
    if (almacenamientoMm3 != null && namoMm3 != null && difNamoMm3 != null) {
      const esperada = namoMm3 - almacenamientoMm3;
      if (Math.abs(esperada - difNamoMm3) > Math.max(0.05, Math.abs(difNamoMm3) * 0.002)) {
        av(`«${difAbs} ${difNamoMm3 < 0 ? 'arriba' : 'abajo'} del NAMO» no cuadra con NAMO − almacenamiento (${esperada.toFixed(3)}): revisar las cifras.`);
      }
    }
    if (almacenamientoMm3 != null && namoMm3 != null && pct != null && namoMm3 > 0) {
      const calc = (almacenamientoMm3 / namoMm3) * 100;
      if (Math.abs(calc - pct) > 0.5) av(`El % (${pct}) no es almacenamiento ÷ NAMO del texto (${calc.toFixed(2)} %): el texto usa otra capacidad para el porcentaje.`);
    }
    if (catalogo?.namoRefMm3 != null && namoMm3 != null && Math.abs(namoMm3 - catalogo.namoRefMm3) / catalogo.namoRefMm3 > 0.01) {
      av(`El NAMO del texto (${namoMm3} Mm³) difiere del de SICA (${catalogo.namoRefMm3} Mm³). El % se calcula con el de SICA.`);
    }
  }

  return {
    clave: catalogo?.clave ?? `desconocida:${normalizarNombre(nombreReportado)}`, nombreReportado, catalogo, fecha, hora, pct, elevacionMsnm, almacenamientoMm3,
    difNamoMm3: difFinal, namoMsnm, namoMm3: namoFinal, extraccionM3s, ingresoM3s, avisos, valida: !avisos.some((a) => a.severidad === 'error'), parrafo,
  };
}

/** Analiza el texto completo. `hoyISO` permite avisar de fechas futuras o muy viejas. */
export function analizarSeguimiento(texto: string, hoyISO?: string): ResultadoSeguimiento {
  const avisosGenerales: AvisoSeguimiento[] = [];
  const parrafos = separarParrafos(texto);
  const lecturas = parrafos.map(analizarParrafo);
  const fechaEncabezado = fechaDeEncabezado(texto.split(/La\s+presa/i)[0] ?? '');
  if (!parrafos.length && texto.trim()) avisosGenerales.push({ severidad: 'error', texto: 'No se encontró ninguna presa. Cada una debe empezar con «La presa …».' });

  const vistas = new Map<string, LecturaSeguimiento>();
  for (const l of lecturas) {
    if (!l.catalogo) continue;
    const previa = vistas.get(l.clave);
    if (previa) { l.avisos.push({ severidad: 'error', texto: `${l.catalogo.nombre} aparece más de una vez en el texto.` }); l.valida = false; }
    else vistas.set(l.clave, l);
  }
  const fechas = new Set(lecturas.filter((l) => l.fecha).map((l) => l.fecha as string));
  if (fechas.size > 1) avisosGenerales.push({ severidad: 'aviso', texto: `El texto trae ${fechas.size} fechas distintas (${[...fechas].sort().join(', ')}); cada presa se guarda con la suya.` });
  if (fechaEncabezado && fechas.size && ![...fechas].includes(fechaEncabezado)) avisosGenerales.push({ severidad: 'aviso', texto: `El encabezado dice ${fechaEncabezado} y las presas ${[...fechas].sort().join(', ')}.` });
  if (hoyISO) {
    for (const l of lecturas) {
      if (!l.fecha) continue;
      const dias = Math.round((Date.parse(`${hoyISO}T12:00:00Z`) - Date.parse(`${l.fecha}T12:00:00Z`)) / 86_400_000);
      if (dias < 0) { l.avisos.push({ severidad: 'error', texto: `Fecha futura (${l.fecha}).` }); l.valida = false; }
      else if (dias > 5) l.avisos.push({ severidad: 'aviso', texto: `La fecha tiene ${dias} días de antigüedad.` });
    }
  }
  const faltantes = lecturas.length ? PRESAS_SEGUIMIENTO.filter((p) => !vistas.has(p.clave)) : [];
  return { lecturas, fechaEncabezado, faltantes, avisosGenerales };
}

/** Marca de procedencia en lecturas_presas: SIN la marca de CILA, así la captura prevalece sobre CILA (resolverNivel → campo_prevalece). */
export const MARCA_SEGUIMIENTO = 'Seguimiento de presas (texto plano)';

/** Fila de lecturas_presas para una presa del distrito. El % se calcula con el NAMO de SICA salvo que el texto coincida con él. */
export function filaLecturaPresas(l: LecturaSeguimiento, capacidadSicaMm3: number, responsable: string) {
  if (!l.catalogo?.presaId || !l.fecha || l.almacenamientoMm3 == null) return null;
  const calc = capacidadSicaMm3 > 0 ? Math.round((l.almacenamientoMm3 / capacidadSicaMm3) * 10000) / 100 : null;
  const pct = l.pct != null && calc != null && Math.abs(l.pct - calc) <= 0.2 ? l.pct : calc;
  return {
    presa_id: l.catalogo.presaId, fecha: l.fecha, escala_msnm: l.elevacionMsnm, almacenamiento_mm3: l.almacenamientoMm3, porcentaje_llenado: pct,
    extraccion_total_m3s: l.extraccionM3s, responsable, notas: l.hora ? `${MARCA_SEGUIMIENTO} · ${l.hora} h` : MARCA_SEGUIMIENTO,
  };
}

/** Fila de seguimiento_presas (todas las presas, del distrito o no). */
export function filaSeguimiento(l: LecturaSeguimiento, capturadoPor: string) {
  if (!l.catalogo || !l.fecha || l.almacenamientoMm3 == null) return null;
  return {
    clave: l.clave, fecha: l.fecha, hora: l.hora, nombre_reportado: l.nombreReportado, presa_id: l.catalogo.presaId, cuerpo_id: l.catalogo.cuerpoId,
    aqwp_ubicacion_id: l.catalogo.aqwpUbicacionId, pct_reportado: l.pct, elevacion_msnm: l.elevacionMsnm, almacenamiento_mm3: l.almacenamientoMm3,
    dif_namo_mm3: l.difNamoMm3, namo_msnm: l.namoMsnm, namo_mm3: l.namoMm3, extraccion_m3s: l.extraccionM3s, ingreso_m3s: l.ingresoM3s,
    parrafo_origen: l.parrafo, capturado_por: capturadoPor, actualizado_en: new Date().toISOString(),
  };
}

/** Lectura mínima de seguimiento_presas que se superpone al estado de AQUARIUS. */
export interface SeguimientoReciente { aqwpUbicacionId: number; fecha: string; almacenamientoMm3: number; ingresoM3s: number | null; extraccionM3s: number | null }

/**
 * La captura manual es PRIORITARIA: si su fecha es igual o posterior a la del estado AQUARIUS, sustituye almacenamiento, aportación
 * (= ingreso) y extracción. El % se recalcula con el NAMO de la propia fuente (AQUARIUS) para no mezclar capacidades. Un dato capturado
 * limpia la marca de «sin actualizar». Devuelve también qué ubicaciones se sustituyeron.
 */
export function aplicarSeguimiento<E extends { ubicacionId: number; fecha: string | null; almacenamientoMm3: number | null; pctNamo: number | null; namoMm3: number | null; aportacionM3s: number | null; extraccionTotalM3s: number | null; estancado: boolean; diasIgual: number | null; igualDesde: string | null }>(
  estados: E[], filas: SeguimientoReciente[],
): { estados: E[]; sustituidas: Map<number, string> } {
  const ultimo = new Map<number, SeguimientoReciente>();
  for (const f of filas) { const p = ultimo.get(f.aqwpUbicacionId); if (!p || f.fecha > p.fecha) ultimo.set(f.aqwpUbicacionId, f); }
  const sustituidas = new Map<number, string>();
  const out = estados.map((e) => {
    const s = ultimo.get(e.ubicacionId);
    if (!s || (e.fecha != null && s.fecha < e.fecha)) return e;
    sustituidas.set(e.ubicacionId, s.fecha);
    const pct = e.namoMm3 != null && e.namoMm3 > 0 ? Math.round((s.almacenamientoMm3 / e.namoMm3) * 10000) / 100 : e.pctNamo;
    return {
      ...e, fecha: s.fecha, almacenamientoMm3: s.almacenamientoMm3, pctNamo: pct, aportacionM3s: s.ingresoM3s ?? e.aportacionM3s,
      extraccionTotalM3s: s.extraccionM3s ?? e.extraccionTotalM3s, estancado: false, diasIgual: null, igualDesde: null,
    };
  });
  return { estados: out, sustituidas };
}
