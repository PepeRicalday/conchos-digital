// ═══════════════════════════════════════════════════════════════════════════
// INFORME DEL VASO — modelo de datos (capa pura, sin DOM ni fetch)
// ---------------------------------------------------------------------------
// Recibe el histórico de escenas NDWI, la validación cruzada y el estado actual de la presa; aplica la ventana de filtros y
// devuelve todo lo que el HTML necesita ya calculado: serie, deltas, huecos reales, hallazgos y avisos de calidad.
// S/D = null; nunca 0. Los "avisos" se imprimen dentro del informe (nada se omite en silencio).
// ═══════════════════════════════════════════════════════════════════════════
import { mesLegible } from './informeBase';
import { estadoEmbalse, type EstadoEmbalse } from './presaNiveles';

export interface EscenaVaso {
    fecha_escena: string;
    area_km2: number;
    perimetro_km: number;
    num_islas: number;
    nubosidad_pct?: number | null;
    ratio_elongacion: number | null;
    delta_area_km2: number | null;
    pct_del_maximo_ciclo: number | null;
    contorno_geojson: { type: 'Polygon'; coordinates: [number, number][][] };
}

export interface ValidacionVaso {
    fecha_escena: string;
    areaSatelite: number;
    sinReferencia: boolean;
    fechaLectura?: string;
    escalaLectura?: number;
    diasDiferencia?: number;
    areaEsperadaKm2?: number;
    pctCoincidencia?: number | null;
}

export interface TexturaVaso { urlPublica: string; bbox: [number, number, number, number]; fechaEscena: string | null }

/** Estado vigente de la presa (misma fuente que la pantalla). Todo nullable: S/D nunca 0. */
export interface EstadoActualVaso {
    nivel: number | null;
    pct: number | null;
    volumen: number | null;
    capacidad: number | null;
    namo: number | null;
    deficit: number | null;
    fechaLectura: string | null;
    procedencia: string | null;
}

export type SeccionVaso = 'resumen' | 'mapa' | 'relieve' | 'tendencia' | 'tabla' | 'validacion' | 'metodologia';
export const SECCIONES_VASO: { id: SeccionVaso; etiqueta: string }[] = [
    { id: 'resumen', etiqueta: 'Resumen ejecutivo y estado actual' },
    { id: 'mapa', etiqueta: 'Evolución del polígono y comparativo' },
    { id: 'relieve', etiqueta: 'Relieve 3D y contexto satelital' },
    { id: 'tendencia', etiqueta: 'Tendencia de área y perímetro' },
    { id: 'tabla', etiqueta: 'Detalle mensual' },
    { id: 'validacion', etiqueta: 'Validación cruzada con la curva oficial' },
    { id: 'metodologia', etiqueta: 'Metodología y limitaciones' },
];
export const ORDEN_SECCIONES_VASO: SeccionVaso[] = SECCIONES_VASO.map((s) => s.id);

export interface ConfigInformeVaso {
    /** Fechas ISO (AAAA-MM-DD) inclusivas sobre la fecha de la escena; null = sin límite. */
    desde: string | null;
    hasta: string | null;
    secciones: SeccionVaso[];
    hoja: 'letter' | 'a4';
}

export const configVasoPorDefecto = (): ConfigInformeVaso => ({ desde: null, hasta: null, secciones: [...ORDEN_SECCIONES_VASO], hoja: 'letter' });

const dia = (iso: string) => iso.slice(0, 10);

export function filtrarEscenas(escenas: EscenaVaso[], c: Pick<ConfigInformeVaso, 'desde' | 'hasta'>): EscenaVaso[] {
    return [...escenas]
        .filter((e) => (!c.desde || dia(e.fecha_escena) >= c.desde) && (!c.hasta || dia(e.fecha_escena) <= c.hasta))
        .sort((a, b) => a.fecha_escena.localeCompare(b.fecha_escena));
}

export function validarConfigVaso(c: ConfigInformeVaso, escenas: EscenaVaso[]): string[] {
    const e: string[] = [];
    if (c.desde && c.hasta && c.desde > c.hasta) e.push('La fecha inicial es posterior a la final.');
    if (c.secciones.length === 0) e.push('Elige al menos una sección.');
    if (filtrarEscenas(escenas, c).length === 0) e.push('No hay escenas satelitales en el periodo elegido.');
    return e;
}

export function avisosConfigVaso(c: ConfigInformeVaso, escenas: EscenaVaso[]): string[] {
    const a: string[] = [];
    const n = filtrarEscenas(escenas, c).length;
    if (n === 1) a.push('Con una sola escena no hay tendencia ni comparativo: esas secciones saldrán con aviso.');
    return a;
}

/** Meses calendario ('AAAA-MM') SIN escena entre la primera y la última de la serie (huecos reales, no estimados). */
export function mesesSinEscena(escenas: Pick<EscenaVaso, 'fecha_escena'>[]): string[] {
    if (escenas.length < 2) return [];
    const con = new Set(escenas.map((e) => e.fecha_escena.slice(0, 7)));
    const ord = [...con].sort();
    const [y0, m0] = ord[0].split('-').map(Number);
    const [y1, m1] = ord[ord.length - 1].split('-').map(Number);
    const faltan: string[] = [];
    for (let i = y0 * 12 + m0 - 1; i <= y1 * 12 + m1 - 1; i++) {
        const k = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
        if (!con.has(k)) faltan.push(k);
    }
    return faltan;
}

export const UMBRAL_NUBES_AVISO_PCT = 10;
export const UMBRAL_DESVIO_PCT = 12;
export const DIAS_ESCENA_VIEJA = 20;

export interface EntradaInformeVaso {
    nombrePresa: string;
    escenas: EscenaVaso[];
    validacion: ValidacionVaso[];
    estado: EstadoActualVaso;
    textura: TexturaVaso | null;
    imagenRelieve: string | null;
    logoSrlOk: boolean;
    ahora: Date;
    emisor: string | null;
    version: string;
}

export interface AvisoVaso { texto: string }

export interface InformeVaso {
    nombrePresa: string;
    config: ConfigInformeVaso;
    folioPrefijo: 'VASO';
    ahora: Date;
    emisor: string;
    version: string;
    estado: EstadoActualVaso & { estadoEmbalse: EstadoEmbalse };
    escenas: EscenaVaso[];
    primero: EscenaVaso | null;
    ultimo: EscenaVaso | null;
    deltaArea: number | null;
    deltaPerimetro: number | null;
    areaMax: number | null;
    areaMin: number | null;
    huecos: string[];
    validacion: ValidacionVaso[];
    hallazgos: string[];
    avisos: AvisoVaso[];
    textura: TexturaVaso | null;
    imagenRelieve: string | null;
}

const f1 = (v: number) => v.toFixed(1);
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });

export function construirDatosVaso(e: EntradaInformeVaso, config: ConfigInformeVaso): InformeVaso {
    const escenas = filtrarEscenas(e.escenas, config);
    const primero = escenas[0] ?? null;
    const ultimo = escenas.length ? escenas[escenas.length - 1] : null;
    const hayTendencia = escenas.length >= 2 && primero && ultimo;
    const deltaArea = hayTendencia ? ultimo.area_km2 - primero.area_km2 : null;
    const deltaPerimetro = hayTendencia ? ultimo.perimetro_km - primero.perimetro_km : null;
    const areas = escenas.map((x) => x.area_km2);
    const fechasOk = new Set(escenas.map((x) => x.fecha_escena));
    const validacion = e.validacion.filter((v) => fechasOk.has(v.fecha_escena));
    const huecos = mesesSinEscena(escenas);

    const hallazgos: string[] = [];
    if (!hayTendencia) {
        hallazgos.push('Histórico insuficiente para calcular tendencia: se requieren al menos 2 escenas dentro del periodo.');
    } else {
        const tramo = `entre ${fechaCorta(primero.fecha_escena)} y ${fechaCorta(ultimo.fecha_escena)}`;
        if (deltaArea! < -1) hallazgos.push(`Contracción neta: el espejo de agua perdió ${f1(Math.abs(deltaArea!))} km² ${tramo}.`);
        else if (deltaArea! > 1) hallazgos.push(`Expansión neta: el espejo de agua ganó ${f1(deltaArea!)} km² ${tramo}.`);
        else hallazgos.push(`Superficie estable: variación neta menor a 1 km² ${tramo}.`);
        if (ultimo.pct_del_maximo_ciclo != null && ultimo.pct_del_maximo_ciclo < 70) {
            hallazgos.push(`Por debajo del máximo: la escena más reciente equivale a ${ultimo.pct_del_maximo_ciclo.toFixed(0)} % de la superficie máxima registrada.`);
        }
    }
    const conRef = validacion.filter((v) => !v.sinReferencia && v.pctCoincidencia != null);
    const desvios = conRef.filter((v) => Math.abs((v.pctCoincidencia ?? 100) - 100) > UMBRAL_DESVIO_PCT);
    if (conRef.length && desvios.length) hallazgos.push(`Validación cruzada con desviación relevante: ${desvios.length} de ${conRef.length} escena(s) difieren más de ${UMBRAL_DESVIO_PCT} % del área esperada por la curva oficial.`);
    else if (conRef.length) hallazgos.push('Validación cruzada consistente: el área satelital coincide con la curva oficial dentro del margen en las escenas con lectura de campo cercana.');

    // ── Avisos de calidad: lo que el lector debe saber antes de confiar en las cifras ──
    const avisos: AvisoVaso[] = [];
    if (!e.logoSrlOk) avisos.push({ texto: 'No se pudo cargar el logotipo institucional; la cabecera muestra solo el texto.' });
    if (e.estado.nivel == null || e.estado.pct == null) avisos.push({ texto: 'La presa no tiene lectura oficial vigente: el estado actual se muestra como S/D.' });
    if (ultimo) {
        const edad = (e.ahora.getTime() - new Date(ultimo.fecha_escena).getTime()) / 864e5;
        if (edad > DIAS_ESCENA_VIEJA) avisos.push({ texto: `La escena satelital más reciente del periodo tiene ${Math.floor(edad)} días: la superficie puede no reflejar el nivel de hoy.` });
        if (ultimo.nubosidad_pct != null && ultimo.nubosidad_pct > UMBRAL_NUBES_AVISO_PCT) avisos.push({ texto: `La escena más reciente (${fechaCorta(ultimo.fecha_escena)}) tiene ${ultimo.nubosidad_pct.toFixed(1)} % de nubes; el contorno puede subestimar el espejo de agua.` });
    }
    if (huecos.length) avisos.push({ texto: `${huecos.length} mes(es) sin escena confiable dentro del periodo (nubosidad o cobertura): ${huecos.map((m) => mesLegible(m, true)).join(', ')}. No se rellenan ni se cuentan como cero.` });
    if (desvios.length) avisos.push({ texto: `El área satelital se aparta más de ${UMBRAL_DESVIO_PCT} % de la curva oficial en ${desvios.length} escena(s); revisar la curva batimétrica o el umbral NDWI antes de decidir con la superficie.` });
    if (config.secciones.includes('relieve') && !e.imagenRelieve && !e.textura) avisos.push({ texto: 'No hay modelo de relieve ni imagen satelital de contexto disponibles para esta presa; esa sección se omite.' });
    if (config.secciones.includes('validacion') && conRef.length === 0) avisos.push({ texto: 'Ninguna escena tiene una lectura de campo a menos de 20 días: no hay validación cruzada que mostrar.' });

    return {
        nombrePresa: e.nombrePresa, config, folioPrefijo: 'VASO', ahora: e.ahora, emisor: e.emisor ?? 'SICA 005', version: e.version,
        estado: { ...e.estado, estadoEmbalse: estadoEmbalse(e.estado.pct) },
        escenas, primero, ultimo, deltaArea, deltaPerimetro,
        areaMax: areas.length ? Math.max(...areas) : null, areaMin: areas.length ? Math.min(...areas) : null,
        huecos, validacion, hallazgos, avisos, textura: e.textura, imagenRelieve: e.imagenRelieve,
    };
}
