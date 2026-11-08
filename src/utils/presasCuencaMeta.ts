/**
 * presasCuencaMeta — fichas de las presas de la cuenca del Conchos (portal USIBWC / CONAGUA).
 *
 * REGLA: solo se llena lo que tiene fuente. Un dato sin verificar es `null` (nunca se inventa). Las fuentes son
 * secundarias (prensa, Wikipedia, documentos de IBWC y del Congreso de Chihuahua): hay que contrastarlas con CONAGUA/SINA
 * antes de usarlas como dato oficial. `verificado` indica que estado/municipio/río tienen al menos una fuente.
 *
 * El nombre del portal no trae el estado y confunde presas homónimas (p. ej. "Pico del Águila" de Chihuahua frente a
 * "Peña del Águila" de Durango). `etiqueta` agrega el estado SOLO cuando difiere del contexto de la cuenca (Chihuahua):
 * "San Gabriel, Dgo.". Poner ", Chih." a las otras seis ensuciaría tablas y leyendas sin informar nada.
 */

export interface MetaPresa {
  /** id_number de aqwp_ubicaciones. */
  ubicacionId: number;
  /** Código del portal (08-SGBCH-CONAGUA). */
  codigo: string;
  /** Nombre corto tal como lo usa la interfaz. */
  nombre: string;
  /** Nombre para mostrar: lleva el estado solo si NO es Chihuahua ("San Gabriel, Dgo."); si no, igual al nombre. */
  etiqueta: string;
  /** Abreviatura del estado (Chih., Dgo.) o null. */
  estado: string | null;
  municipio: string | null;
  rio: string | null;
  /** Otros nombres con que se le conoce. */
  tambienLlamada: string | null;
  /** Distrito de riego que abastece o con el que se relaciona. */
  dr: string | null;
  /** Presa a la que alimenta aguas abajo (código del portal), solo si hay fuente. */
  alimentaA: string | null;
  coordenadas: { lat: number; lon: number } | null;
  /** estado/municipio/río respaldados por al menos una fuente. */
  verificado: boolean;
  /** Fuente(s) de la ficha; null si no hay ficha. */
  fuente: string | null;
}

const SIN_FICHA = {
  estado: null, municipio: null, rio: null, tambienLlamada: null, dr: null, alimentaA: null, coordenadas: null,
  verificado: false, fuente: null,
} as const;

export const META_PRESAS: Record<string, MetaPresa> = {
  '08-LBQCH-CONAGUA': {
    ubicacionId: 536, codigo: '08-LBQCH-CONAGUA', nombre: 'La Boquilla', etiqueta: 'La Boquilla',
    estado: 'Chih.', municipio: 'San Francisco de Conchos', rio: 'Conchos', tambienLlamada: 'Lago Toronto', dr: 'DR-005 Delicias',
    alimentaA: null, coordenadas: { lat: 27.5517, lon: -105.4375 }, verificado: true,
    fuente: 'Hispanopedia; Wikipedia (La Boquilla Dam); coordenadas: src/utils/geoDistrito.ts',
  },
  '08-FIMCH-CONAGUA': {
    ubicacionId: 537, codigo: '08-FIMCH-CONAGUA', nombre: 'Francisco I. Madero', etiqueta: 'F. I. Madero',
    estado: 'Chih.', municipio: 'Rosales', rio: 'San Pedro', tambienLlamada: 'Las Vírgenes', dr: 'DR-005 Delicias',
    alimentaA: null, coordenadas: { lat: 28.3364, lon: -105.5278 }, verificado: true,
    fuente: 'Tiempo.com.mx (22-jul-2026); Redalyc; coordenadas: src/utils/geoDistrito.ts',
  },
  '08-SGBCH-CONAGUA': {
    ubicacionId: 541, codigo: '08-SGBCH-CONAGUA', nombre: 'San Gabriel', etiqueta: 'San Gabriel, Dgo.',
    estado: 'Dgo.', municipio: 'Ocampo', rio: 'Florido', tambienLlamada: 'Federalismo Mexicano', dr: 'DR-103 Río Florido',
    alimentaA: '08-PAGCH-CONAGUA', coordenadas: { lat: 26.4367, lon: -105.5611 }, verificado: true,
    fuente: 'Wikipedia/Hispanopedia (Presa San Gabriel); IBWC a TCEQ 2024; Congreso de Chihuahua. NAMO 245.431 Mm³ y muerto 9.44 Mm³ del portal.',
  },
  '08-PAGCH-CONAGUA': {
    ubicacionId: 540, codigo: '08-PAGCH-CONAGUA', nombre: 'Pico del Águila', etiqueta: 'Pico del Águila',
    estado: 'Chih.', municipio: 'Coronado', rio: 'Florido', tambienLlamada: null, dr: 'DR-103 Río Florido',
    alimentaA: null, coordenadas: null, verificado: true,
    fuente: 'Uno TV (Chihuahua); IBWC; Congreso de Chihuahua. Recibe de San Gabriel. Río exacto por confirmar.',
  },
  '08-LLNCH-CONAGUA': {
    ubicacionId: 526, codigo: '08-LLNCH-CONAGUA', nombre: 'Luis L. León', etiqueta: 'Luis L. León',
    estado: 'Chih.', municipio: 'Aldama', rio: 'Conchos', tambienLlamada: 'El Granero', dr: null,
    alimentaA: null, coordenadas: null, verificado: true,
    fuente: 'Wikipedia (El Granero Dam); Gobierno de México. La capacidad total de la fuente (356 Mm³) no coincide con el NAMO del portal (284.4): no usar sin CONAGUA.',
  },
  // Sin fuente verificada: se dejan en null hasta consultar SINA / Gerencia de Aguas Superficiales de CONAGUA.
  '08-CHUCH-CONAGUA': { ubicacionId: 538, codigo: '08-CHUCH-CONAGUA', nombre: 'Chihuahua', etiqueta: 'Chihuahua', ...SIN_FICHA },
  '08-ERECH-CONAGUA': { ubicacionId: 539, codigo: '08-ERECH-CONAGUA', nombre: 'El Rejón', etiqueta: 'El Rejón', ...SIN_FICHA },
};

const POR_UBICACION = new Map(Object.values(META_PRESAS).map((m) => [m.ubicacionId, m]));

export const metaPresa = (codigo: string): MetaPresa | null => META_PRESAS[codigo] ?? null;
export const metaPresaPorUbicacion = (ubicacionId: number): MetaPresa | null => POR_UBICACION.get(ubicacionId) ?? null;

/** Nombre para mostrar: con estado si hay ficha ("San Gabriel, Dgo."); si no, el nombre que trae el portal. */
export function etiquetaPresa(ubicacionId: number, nombrePortal: string): string {
  return POR_UBICACION.get(ubicacionId)?.etiqueta ?? nombrePortal;
}
