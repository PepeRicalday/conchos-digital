/**
 * infografiaGoes — datos PUROS de la infografía «Estaciones hidrométricas (GOES)» para compartir (WhatsApp).
 * Compone prepararInformeGoes (misma estadística que la pantalla y el Informe: una sola fuente) y la reduce a lo que cabe en
 * una imagen. Reglas de veracidad: sin dato = S/D (null), nunca 0; el gasto 0.00 de Babisas es dato CENSURADO («< 15 m³/s») y
 * su media un RANGO; con estación sin transmisión se muestra el ÚLTIMO REGISTRO CONOCIDO con su antigüedad y la variación en
 * S/D; no hay comparación presa↔río (ninguna estación mide salida de presa). Sin React ni red.
 */
import {
    ORDEN_ESTACIONES, TITULO_GRUPO, esEntradaPresa, fechaHoraLocal, fmt, fmtDelta, textoBajoUmbral, textoEdad,
    type CeldaEnlace, type ClaveEnlace, type EstacionHidro, type GrupoHidro, type MensajeHidro, type PuntoHidro, type VentanaHidro,
} from './hidroEstaciones';
import type { ResumenEstacion } from './hidroEstadistica';
import { configGoesPorDefecto, etiquetaPeriodoGoes, type PeriodoGoes, type TipoPeriodoGoes } from './informeGoesConfig';
import {
    NOMBRE_CORTO, agregarBanda, pasoParaSpan, prepararInformeGoes, semaforoCobertura, type DatosEstacionGoes, type SemaforoCobertura,
} from './informeGoesDatos';
import type { SeriesPorEstacion } from '../hooks/useHidroEstaciones';

export type DirInfo = 'sube' | 'baja' | 'estable' | 'sd';
export interface VariacionInfo { dir: DirInfo; delta: number | null }
export interface ValorConEdad { v: number; t: number; edadMin: number | null }
/** Último gasto publicable: número, o «bajo el umbral del sensor» (censurado), o null = S/D. */
export type UltimoGastoInfo = ({ tipo: 'valor' } & ValorConEdad) | { tipo: 'censurado'; texto: string; t: number; edadMin: number | null } | null;

/** Estadística de una variable en el periodo (misma fuente que el Informe: ResumenEstacion). */
export interface RangoStat { n: number; min: number; max: number; tMin: number; tMax: number; media: number; mediana: number; p10: number | null; p90: number | null; desv: number }
export interface PuntoSerie { t: number; v: number; min: number; max: number }

/** Lo que usa la ficha TÉCNICA de una estación: estadística completa, volumen, enlace y series con banda. */
export interface TecnicaEstacionInfoGoes {
    nivel: RangoStat | null;
    /** Solo lecturas sobre el umbral en Babisas; el rango de su media va en `gastoRango`. */
    gasto: RangoStat | null;
    volumen: { mm3: number; pctIntegrado: number; gastoMedio: number | null } | null;
    /** Babisas: volumen como rango (ceros como 0 → como umbral), Mm³. */
    volumenRango: { inf: number; sup: number } | null;
    pendienteGastoDia: number | null;
    lecturasGasto: { recibidas: number; bajoUmbral: number };
    cobertura: { recibidas: number; esperadas: number } | null;
    enlace: { buenos: number; total: number; pctBuenos: number | null; senalDbm: number | null; tira: CeldaEnlace[] };
    intervaloMin: number;
    serieNivel: PuntoSerie[]; serieGasto: PuntoSerie[];
}

export interface DatosEstacionInfoGoes {
    id: string; nombre: string; nombreCorto: string;
    grupo: GrupoHidro; grupoTitulo: string;
    /** «Entrada a la presa La Boquilla» · «Estación de río» (se rotula siempre: una entrada no es una salida). */
    rolTexto: string; entrada: boolean;
    lat: number | null; lon: number | null;
    enlace: { clave: ClaveEnlace; etiqueta: string; edadMin: number | null };
    /** El dato ya no es actual (estación sin transmisión o último registro > 3 h): se rotula «Último registro … hace X». */
    obsoleto: boolean;
    ultimoNivel: ValorConEdad | null;
    ultimoGasto: UltimoGastoInfo;
    nivel: { min: number; media: number; max: number } | null;
    /** Solo lecturas sobre el umbral (Babisas) o todas (resto). */
    gasto: { min: number; media: number; max: number } | null;
    /** Babisas: media del gasto como rango (ceros como 0 → como umbral). */
    gastoRango: { inf: number; sup: number; umbral: number; pctBajoUmbral: number; representativo: boolean } | null;
    var24: { nivel: VariacionInfo; gasto: VariacionInfo };
    var7: { nivel: VariacionInfo; gasto: VariacionInfo };
    coberturaPct: number | null; coberturaSemaforo: SemaforoCobertura;
    /** Serie de la minigráfica (≈40 puntos). Babisas con más de la mitad bajo el umbral grafica el NIVEL (el gasto sin ceros engaña). */
    spark: { t: number; v: number }[]; variableSpark: 'gasto' | 'nivel';
    sinDatos: boolean;
    tec: TecnicaEstacionInfoGoes;
}

export interface DatosInfografiaGoes {
    /** Código del periodo: 24h, 7d, 30d o rango (las variaciones a 24 h y 7 d solo existen en 24h y 7d). */
    ventana: TipoPeriodoGoes; etiquetaVentana: string; desdeMs: number; hastaMs: number;
    corteMs: number; corteTexto: string;
    estaciones: DatosEstacionInfoGoes[];
    resumen: { enLinea: number; conRetraso: number; sinTx: number; total: number; texto: string };
    lectura: string[];
    fuente: string; limitaciones: string[];
}

export interface EntradaInfografiaGoes {
    /** Periodo del informe; si falta se toma `ventana` (24h/7d/30d). */
    periodo?: PeriodoGoes;
    ventana?: VentanaHidro;
    /** Ids de estación a incluir (por defecto, todas las recibidas). */
    incluir?: string[];
    estaciones: EstacionHidro[];
    series: SeriesPorEstacion;
    mensajes: MensajeHidro[];
    ahoraMs: number;
}

/** Orden de lectura de la infografía (pedido del distrito): Boca del Río, Madero–Vírgenes, Babisas y al final Ojinaga. */
export const ORDEN_INFOGRAFIA_GOES = ['C63009B2', 'C6301AC4', 'C6301416', 'C6300760', 'IBWC-08373000'] as const;
const posicion = (id: string): number => { const i = (ORDEN_INFOGRAFIA_GOES as readonly string[]).indexOf(id); return i < 0 ? 99 : i; };

const TOPE_PUNTOS_SPARK = 40;
/** Un último registro más viejo que esto ya no es actual (mismo criterio que STALE_GOES_MIN de la ficha). */
const OBSOLETO_MIN = 180;

const var1 = (t: { dir: 'sube' | 'baja' | 'estable'; delta: number } | null | undefined): VariacionInfo => (t ? { dir: t.dir, delta: t.delta } : { dir: 'sd', delta: null });

export function rolTexto(e: Pick<EstacionHidro, 'rol' | 'presa_id'>): string {
    if (esEntradaPresa(e)) return `Entrada a la presa ${e.presa_id === 'PRE-001' ? 'La Boquilla' : 'Fco. I. Madero (Las Vírgenes)'}`;
    return e.rol === 'rio_san_pedro' ? 'Estación de río · Río Conchos, salida del distrito' : 'Estación de río · Río Conchos';
}

const resumirSpark = (puntos: { t: number; v: number }[], desde: number, hasta: number): { t: number; v: number }[] => {
    if (!puntos.length) return [];
    const paso = Math.max(pasoParaSpan((hasta - desde) * 6), 5);
    return agregarBanda(puntos, paso).map((p) => ({ t: p.t, v: p.v }));
};

function ultimoCrudo(serie: PuntoHidro[] | undefined, hasta: number): PuntoHidro | null {
    let u: PuntoHidro | null = null;
    for (const p of serie ?? []) if (p.t <= hasta && (u == null || p.t > u.t)) u = p;
    return u;
}

const stat = (x: ResumenEstacion | null): RangoStat | null => (x ? { n: x.n, min: x.min, max: x.max, tMin: x.tMin, tMax: x.tMax, media: x.media, mediana: x.mediana, p10: x.p10, p90: x.p90, desv: x.desv } : null);
const serie = (s: { t: number; v: number; min: number; max: number }[]): PuntoSerie[] => s.map((p) => ({ t: p.t, v: p.v, min: p.min, max: p.max }));

export function construirDatosInfografiaGoes(e: EntradaInfografiaGoes): DatosInfografiaGoes {
    const periodo: PeriodoGoes = e.periodo ?? { tipo: e.ventana ?? '24h', desde: '', hasta: '' };
    const ids = (e.incluir?.length ? e.incluir : [...ORDEN_ESTACIONES]).filter((id) => e.estaciones.some((x) => x.id === id));
    const config = {
        ...configGoesPorDefecto(periodo.tipo === 'rango' ? '24h' : periodo.tipo), periodo, estaciones: ids,
        variables: ['nivel', 'gasto'] as ('nivel' | 'gasto')[],
    };
    const informe = prepararInformeGoes({ config, estaciones: e.estaciones, series: e.series, meteo: {}, mensajes: e.mensajes, ahoraMs: e.ahoraMs });
    const porId = new Map(e.estaciones.map((x) => [x.id, x]));

    const estaciones: DatosEstacionInfoGoes[] = informe.estaciones.map((d: DatosEstacionGoes) => {
        const est = porId.get(d.id)!;
        const cen = d.est.censurado;
        const crudo = ultimoCrudo(e.series[d.id]?.gasto_m3s, e.ahoraMs);
        const ceroUltimo = d.ceroReciente && crudo != null;
        const gastoVigente = d.ultimoGasto;
        const edadGasto = ceroUltimo ? (e.ahoraMs - crudo!.t) / 60000 : gastoVigente?.edadMin ?? null;
        const ultimoGasto: UltimoGastoInfo = ceroUltimo
            ? { tipo: 'censurado', texto: textoBajoUmbral(d.id), t: crudo!.t, edadMin: edadGasto }
            : gastoVigente ? { tipo: 'valor', ...gastoVigente } : null;
        const noRepresentativo = !!cen && !d.est.gastoRepresentativo;
        const variableSpark: 'gasto' | 'nivel' = (noRepresentativo || !d.serieGasto.length) ? 'nivel' : 'gasto';
        const fuenteSpark = variableSpark === 'gasto' ? d.serieGasto : d.serieNivel;
        const obsoleto = d.enlace.clave === 'sin_transmision' || d.enlace.clave === 'sd'
            || (d.ultimoNivel?.edadMin ?? 0) > OBSOLETO_MIN || (edadGasto ?? 0) > OBSOLETO_MIN;
        // Babisas con la lectura más reciente bajo el umbral: la variación del gasto (calculada sin ceros) compararía otra cosa → S/D.
        const gasto24 = ceroUltimo ? { dir: 'sd' as const, delta: null } : var1(d.est.variacionGasto.h24);
        const gasto7 = ceroUltimo ? { dir: 'sd' as const, delta: null } : var1(d.est.variacionGasto.d7);
        const r = (x: typeof d.est.nivel) => (x ? { min: x.min, media: x.media, max: x.max } : null);
        return {
            id: d.id, nombre: d.nombre, nombreCorto: NOMBRE_CORTO[d.id] ?? d.nombre,
            grupo: d.grupo, grupoTitulo: TITULO_GRUPO[d.grupo], rolTexto: rolTexto(est), entrada: d.entrada,
            lat: est.latitud != null ? Number(est.latitud) : null, lon: est.longitud != null ? Number(est.longitud) : null,
            enlace: { clave: d.enlace.clave, etiqueta: d.enlace.etiqueta, edadMin: d.enlace.edadMin },
            obsoleto,
            ultimoNivel: d.ultimoNivel ? { v: d.ultimoNivel.v, t: d.ultimoNivel.t, edadMin: d.ultimoNivel.edadMin } : null,
            ultimoGasto,
            nivel: r(d.est.nivel), gasto: r(d.est.gasto),
            gastoRango: cen ? { inf: cen.mediaInf, sup: cen.mediaSup, umbral: cen.umbral, pctBajoUmbral: cen.pct, representativo: d.est.gastoRepresentativo } : null,
            var24: { nivel: var1(d.est.variacionNivel.h24), gasto: gasto24 },
            var7: { nivel: var1(d.est.variacionNivel.d7), gasto: gasto7 },
            coberturaPct: d.est.cobertura?.pct ?? null, coberturaSemaforo: semaforoCobertura(d.est.cobertura?.pct),
            spark: resumirSpark(fuenteSpark.map((p) => ({ t: p.t, v: p.v })), informe.desdeMs, informe.hastaMs).slice(-TOPE_PUNTOS_SPARK * 2),
            variableSpark, sinDatos: d.sinDatos,
            tec: {
                nivel: stat(d.est.nivel), gasto: stat(d.est.gasto),
                volumen: d.est.volumen ? { mm3: d.est.volumen.mm3, pctIntegrado: d.est.volumen.pctIntegrado, gastoMedio: d.est.volumen.gastoMedio } : null,
                volumenRango: cen && cen.volInfMm3 != null && cen.volSupMm3 != null ? { inf: cen.volInfMm3, sup: cen.volSupMm3 } : null,
                pendienteGastoDia: d.est.pendienteGastoDia,
                lecturasGasto: { recibidas: d.est.gastoRecibidas, bajoUmbral: d.est.excluidas },
                cobertura: d.est.cobertura ? { recibidas: d.est.cobertura.recibidas, esperadas: d.est.cobertura.esperadas } : null,
                enlace: { buenos: d.salud.buenos, total: d.salud.total, pctBuenos: d.salud.pctBuenos, senalDbm: d.salud.senalDbm, tira: d.tira },
                intervaloMin: d.intervaloMin,
                serieNivel: serie(d.serieNivel), serieGasto: serie(d.serieGasto),
            },
        };
    }).sort((a, b) => posicion(a.id) - posicion(b.id));

    const enLinea = estaciones.filter((x) => x.enlace.clave === 'en_linea').length;
    const conRetraso = estaciones.filter((x) => x.enlace.clave === 'retraso').length;
    const sinTx = estaciones.filter((x) => x.enlace.clave === 'sin_transmision' || x.enlace.clave === 'sd').length;
    const total = estaciones.length;
    const resumen = {
        enLinea, conRetraso, sinTx, total,
        texto: `${enLinea} de ${total} en línea${conRetraso ? `, ${conRetraso} con retraso` : ''}${sinTx ? `, ${sinTx} sin transmisión` : ''}`,
    };

    const base = { ventana: periodo.tipo, etiquetaVentana: etiquetaPeriodoGoes(periodo, e.ahoraMs), desdeMs: informe.desdeMs, hastaMs: informe.hastaMs, estaciones, resumen };
    const limitaciones = [
        'Sin dato = S/D, nunca 0.',
        'Boca del Río y Madero–Vírgenes miden la ENTRADA a su presa, no la extracción. No se compara presa con río.',
    ];
    return {
        ...base,
        corteMs: e.ahoraMs, corteTexto: `Corte: ${fechaHoraLocal(e.ahoraMs)} h (Chihuahua)`,
        lectura: redactarLecturaInfografiaGoes(base),
        fuente: 'Telemetría satelital GOES · monitor Sutron · hora de Chihuahua. Los equipos transmiten cada hora; el dato puede llegar con retraso.',
        limitaciones,
    };
}

const lista = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** Frases en palabras derivadas de los números (nunca inventan: lo que no hay es S/D). */
export function redactarLecturaInfografiaGoes(d: Pick<DatosInfografiaGoes, 'ventana' | 'etiquetaVentana' | 'estaciones' | 'resumen'>): string[] {
    const out: string[] = [];
    const con = d.estaciones.filter((x) => !x.sinDatos);
    if (!con.length) return ['Sin lecturas en el periodo (S/D) en ninguna de las estaciones.'];
    const sinTx = d.estaciones.filter((x) => x.enlace.clave === 'sin_transmision' || x.enlace.clave === 'sd');
    // Con todo en línea el sello ya lo dice: no se repite.
    if (d.resumen.enLinea !== d.resumen.total) out.push(`${d.resumen.texto}${sinTx.length ? ` (${lista(sinTx.map((x) => x.nombreCorto))}: se muestra su último registro conocido)` : ''}.`);

    const h = d.ventana === '24h' ? 'var24' : d.ventana === '7d' ? 'var7' : null;
    if (h) {
        const rotulo = d.ventana === '24h' ? '24 h' : '7 días';
        const g: Record<'sube' | 'baja' | 'estable' | 'sd', string[]> = { sube: [], baja: [], estable: [], sd: [] };
        const soloNivel: string[] = [];
        for (const x of con.filter((y) => !y.obsoleto)) {
            const vg = x[h].gasto;
            if (vg.dir === 'sd' || vg.delta == null) {
                // Sin gasto comparable (p. ej. Babisas bajo el umbral): el nivel se dice como nivel, nunca como gasto.
                const vn = x[h].nivel;
                if (vn.dir === 'sd' || vn.delta == null) g.sd.push(x.nombreCorto);
                else if (!x.gastoRango) soloNivel.push(`${x.nombreCorto}: sin gasto comparable; su nivel ${vn.dir === 'estable' ? 'se mantiene estable' : `${vn.dir === 'sube' ? 'sube' : 'baja'} (${fmtDelta(vn.delta, 2)} m)`}`);
                continue;
            }
            g[vg.dir].push(vg.dir === 'estable' ? x.nombreCorto : `${x.nombreCorto} (${fmtDelta(vg.delta, 1)} m³/s)`);
        }
        const fr: string[] = [];
        if (g.baja.length) fr.push(`baja en ${lista(g.baja)}`);
        if (g.sube.length) fr.push(`sube en ${lista(g.sube)}`);
        if (g.estable.length) fr.push(`se mantiene estable en ${lista(g.estable)}`);
        if (fr.length) out.push(`En ${rotulo}, el gasto ${fr.join('; ')}${g.sd.length ? `. Sin base para comparar (S/D): ${lista(g.sd)}` : ''}.`);
        else if (g.sd.length) out.push(`Sin base para comparar el cambio en ${rotulo} (S/D): ${lista(g.sd)}.`);
        for (const t of soloNivel) out.push(`${t}.`);
    }
    const bab = d.estaciones.find((x) => x.gastoRango);
    if (bab?.gastoRango) {
        const vn = (d.ventana === '7d' ? bab.var7 : bab.var24).nivel;
        const nivel = d.ventana === '30d' || vn.dir === 'sd' || vn.delta == null ? '' : `; su nivel ${vn.dir === 'estable' ? 'se mantiene estable' : `${vn.dir === 'sube' ? 'sube' : 'baja'} (${fmtDelta(vn.delta, 2)} m)`}`;
        out.push(`${bab.nombreCorto} (río San Pedro): ${fmt(bab.gastoRango.pctBajoUmbral, 0)} % de las lecturas de gasto quedó bajo el umbral del sensor (~${bab.gastoRango.umbral} m³/s) y el gasto medio está entre ${fmt(bab.gastoRango.inf, 1)} y ${fmt(bab.gastoRango.sup, 1)} m³/s${nivel}. Causa sin confirmar.`);
    }
    return out;
}

/** Texto del último registro: «hace 3 h 4 min» o el instante exacto si el dato es obsoleto. */
export function antiguedadTexto(edadMin: number | null): string {
    return textoEdad(edadMin);
}
