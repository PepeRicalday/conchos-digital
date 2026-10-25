/**
 * ndviVolumen — relación entre volumen entregado (hm³) y NDVI medio de la temporada, módulo por módulo.
 *
 * Por qué por módulo: mezclar los seis módulos da r ≈ −0.27 (efecto de módulo: tamaño y suelo de cada uno), mientras que
 * dentro de cada módulo el volumen y el NDVI medio mar–sep suben juntos en 2021–2024 (r de 0.69 a 0.98, salvo M4: −0.18).
 * Con solo 4 años únicamente M2 supera el R² crítico (0.90): el resto es indicativo. La relación es descriptiva: la
 * superficie sembrada explica casi tanto como el volumen y no se puede separar de él.
 *
 * El año actual (2026) se dibuja aparte y NO entra al ajuste: su volumen viene de otra fuente (hoja SRL provisional) y no
 * está conciliado con ACUM_INF (2021–2024).
 *
 * Regla «S/D nunca cero»: sin volumen o sin NDVI no hay punto; nada se rellena con 0.
 */
import { r2CriticoAlfa05, tendenciaLineal } from './estadisticaHistorica';
import {
    MESES_TEMPORADA, MIN_MESES_ANIO_COMPLETO, UMBRAL_SIN_CAMBIO, cruceAnual, resumenAnio, type FilaNdviV2, type FilaSupVol,
} from './ndviInteranual';
import { volumenAcumuladoPorModuloHm3 } from './indicesSrl';

export type EstadoRelacion = 'acompaña' | 'sin-relacion' | 'sin-evidencia';

/** r desde el cual se dice que el volumen y el NDVI se mueven juntos (con signo positivo). */
export const R_MINIMO_ACOMPANA = 0.5;
/** Años mínimos para ajustar una recta. */
export const MIN_PUNTOS_AJUSTE = 3;
export const ANIO_ACTUAL = 2026;

export interface PuntoVolNdvi {
    anio: number;
    volumenHm3: number;
    /** NDVI medio de la temporada (frontera del módulo). */
    ndviMedio: number;
    /** Algún renglón del informe fuente con captura atípica (se suma tal cual). */
    atipico: boolean;
    mesesNdvi: number;
}

export interface VolumenActual {
    /** Volumen mar–sep por módulo (hm³); un módulo ausente = sin volumen (S/D). */
    porModulo: Map<number, number>;
    /** Meses de mar–sep con fila, por módulo. */
    mesesPorModulo: Map<number, number>;
    /** Meses de la ventana marcados como parciales en la hoja. */
    mesesParciales: string[];
    error: string | null;
}

export interface PuntoActual extends PuntoVolNdvi {
    provisional: true;
    /** Faltan meses de la ventana o alguno está marcado como parcial: no es comparable con un año completo. */
    volumenIncompleto: boolean;
    /** Diferencia de NDVI contra la referencia (positivo = por encima). null si no hay referencia. */
    desviacion: number | null;
    referencia: 'recta' | 'promedio' | null;
    /** Volumen fuera del rango de los años ajustados (la recta se estaría extrapolando). */
    fueraDeRango: boolean;
}

export interface RelacionVolNdvi {
    modulo: number;
    /** Puntos del ajuste: años anteriores al actual con volumen y NDVI de temporada completa. */
    puntos: PuntoVolNdvi[];
    n: number;
    pendiente: number | null;
    intercepto: number | null;
    /** Pearson con signo: signo(pendiente)·√R². */
    r: number | null;
    r2: number | null;
    /** r positivo y R² por encima del crítico al 5 % para n puntos. */
    firme: boolean;
    estado: EstadoRelacion;
    /** Cambio de NDVI medio por cada +10 hm³ según la recta (indicativo). */
    por10Hm3: number | null;
    actual: PuntoActual | null;
    /** Por qué no hay punto actual (S/D). */
    motivoSinActual: string | null;
    /** Años con volumen y NDVI pero temporada de NDVI incompleta: no entran al ajuste. */
    excluidos: number[];
}

const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * Relación volumen–NDVI de un módulo. `volumenActual`: volumen mar–sep del año actual ya cargado
 * (null = aún no cargado). Los años anteriores salen de ACUM_INF (`supVol`); el actual, aparte, de la hoja SRL.
 */
export function relacionVolumenNdvi(
    filasNdvi: FilaNdviV2[], supVol: FilaSupVol[], volumenActual: VolumenActual | null, modulo: number, anioActual: number = ANIO_ACTUAL,
): RelacionVolNdvi {
    const anios = new Set<number>();
    for (const f of filasNdvi) if (f.numero_modulo === modulo) anios.add(Number(f.mes.slice(0, 4)));
    for (const s of supVol) if (s.numero_modulo === modulo) anios.add(s.anio);

    const puntos: PuntoVolNdvi[] = [];
    const excluidos: number[] = [];
    for (const anio of [...anios].filter(a => a < anioActual).sort((a, b) => a - b)) {
        const c = cruceAnual(filasNdvi, supVol, modulo, anio);
        if (c.volumenHm3 == null || c.mediaNdvi == null) continue;
        const mesesNdvi = resumenAnio(filasNdvi, modulo, anio).mesesConDato;
        if (mesesNdvi < MIN_MESES_ANIO_COMPLETO) { excluidos.push(anio); continue; }
        puntos.push({ anio, volumenHm3: c.volumenHm3, ndviMedio: c.mediaNdvi, atipico: c.atipicos > 0, mesesNdvi });
    }

    const n = puntos.length;
    const t = tendenciaLineal(puntos.map(p => ({ x: p.volumenHm3, y: p.ndviMedio })));
    const r = t ? Math.sign(t.pendiente) * Math.sqrt(t.r2) : null;
    const estado: EstadoRelacion = !t || r == null ? 'sin-evidencia' : r >= R_MINIMO_ACOMPANA ? 'acompaña' : 'sin-relacion';
    const firme = !!t && estado === 'acompaña' && t.r2 >= r2CriticoAlfa05(t.n);

    // Punto del año actual, aparte del ajuste.
    let actual: PuntoActual | null = null;
    let motivoSinActual: string | null = null;
    if (!volumenActual) {
        motivoSinActual = `Volumen ${anioActual} de la hoja SRL no cargado.`;
    } else if (volumenActual.error) {
        motivoSinActual = `No se pudo leer el volumen ${anioActual} de la hoja SRL (${volumenActual.error}). No significa que sea cero.`;
    } else {
        const vol = volumenActual.porModulo.get(modulo);
        const ra = resumenAnio(filasNdvi, modulo, anioActual);
        if (vol == null || !Number.isFinite(vol)) motivoSinActual = `Sin volumen ${anioActual} cargado para el módulo (S/D).`;
        else if (ra.media == null) motivoSinActual = `Sin NDVI ${anioActual} para el módulo (S/D).`;
        else {
            const incompleto = (volumenActual.mesesPorModulo.get(modulo) ?? 0) < MESES_TEMPORADA.length || volumenActual.mesesParciales.length > 0;
            let desviacion: number | null = null;
            let referencia: PuntoActual['referencia'] = null;
            if (t && estado === 'acompaña') { desviacion = ra.media - (t.intercepto + t.pendiente * vol); referencia = 'recta'; }
            else if (n >= MIN_PUNTOS_AJUSTE) { desviacion = ra.media - media(puntos.map(p => p.ndviMedio)); referencia = 'promedio'; }
            const vols = puntos.map(p => p.volumenHm3);
            actual = {
                anio: anioActual, volumenHm3: vol, ndviMedio: ra.media, atipico: false, mesesNdvi: ra.mesesConDato, provisional: true,
                volumenIncompleto: incompleto, desviacion, referencia,
                fueraDeRango: vols.length > 0 && (vol < Math.min(...vols) || vol > Math.max(...vols)),
            };
        }
    }

    return {
        modulo, puntos, n, pendiente: t?.pendiente ?? null, intercepto: t?.intercepto ?? null, r, r2: t?.r2 ?? null,
        firme, estado, por10Hm3: t ? t.pendiente * 10 : null, actual, motivoSinActual, excluidos,
    };
}

const dec = (v: number, d: number) => Math.abs(v).toFixed(d);
const sg = (v: number, d: number) => `${v < 0 ? '−' : '+'}${dec(v, d)}`;

/** Frase del módulo, en tres estados; descriptiva, sin causa. */
export function fraseRelacion(rel: RelacionVolNdvi): string {
    if (rel.estado === 'sin-evidencia' || rel.r == null) {
        return `Sin evidencia: se necesitan al menos ${MIN_PUNTOS_AJUSTE} años con volumen y NDVI; hay ${rel.n}.`;
    }
    const rTxt = `r = ${sg(rel.r, 2)}`;
    if (rel.estado === 'acompaña') {
        return rel.firme
            ? `Acompaña, y con firmeza: en los ${rel.n} años, más volumen fue de la mano de más vegetación (${rTxt}).`
            : `Acompaña, pero con solo ${rel.n} años aún no es firme (${rTxt}).`;
    }
    return rel.r <= -R_MINIMO_ACOMPANA
        ? `Sin relación a favor: los años con más volumen no tuvieron más vegetación, más bien al revés (${rTxt}).`
        : `Sin relación visible: los años con más volumen no tuvieron más vegetación (${rTxt}).`;
}

/** Frase del punto del año actual respecto a su referencia; descriptiva. */
export function fraseActual(rel: RelacionVolNdvi): string {
    const a = rel.actual;
    if (!a) return rel.motivoSinActual ?? 'Sin dato del año actual (S/D).';
    const aviso = a.volumenIncompleto ? ' Volumen incompleto: no es comparable con un año entero.' : '';
    if (a.desviacion == null || a.referencia == null) return `${a.anio}: sin referencia suficiente para compararlo (S/D).${aviso}`;
    const ref = a.referencia === 'recta' ? 'lo que sugiere la recta para ese volumen' : 'promedio de los años anteriores';
    const cuerpo = Math.abs(a.desviacion) < UMBRAL_SIN_CAMBIO
        ? `NDVI en línea con ${a.referencia === 'recta' ? '' : 'el '}${ref} (${sg(a.desviacion, 2)})`
        : `NDVI ${dec(a.desviacion, 2)} ${a.desviacion > 0 ? 'por encima' : 'por debajo'} ${a.referencia === 'recta' ? 'de lo que sugiere la recta para ese volumen' : 'del promedio de los años anteriores'}`;
    return `${a.anio}: ${cuerpo}.${a.fueraDeRango ? ' Su volumen queda fuera del rango de los años comparados.' : ''}${aviso}`;
}

/** Lectura general de los módulos: cuántos acompañan, cuáles son firmes, cuáles no, y qué pasó en el año actual. */
export function lecturaGeneral(rels: RelacionVolNdvi[]): string {
    const con = rels.filter(r => r.estado !== 'sin-evidencia');
    if (!con.length) return 'Sin evidencia suficiente para comparar volumen y vegetación (S/D).';
    const acompanan = con.filter(r => r.estado === 'acompaña');
    const firmes = acompanan.filter(r => r.firme);
    const sin = con.filter(r => r.estado === 'sin-relacion');
    const n = Math.max(...con.map(r => r.n));
    const nota = firmes.length ? `; ${firmes.length === 1 ? 'el único firme' : 'firmes'}: ${firmes.map(r => 'M' + r.modulo).join(', ')}` : '; ninguno es firme';
    let t = `Dentro de cada módulo, los años con más agua entregada tuvieron más vegetación en ${acompanan.length} de ${con.length} módulos (solo ${n} años de comparación${nota}).`;
    if (sin.length) t += ` ${sin.length > 1 ? 'Excepciones' : 'Excepción'}: ${sin.map(r => 'M' + r.modulo).join(', ')}.`;
    const act = con.map(r => r.actual).filter((a): a is PuntoActual => !!a && a.desviacion != null);
    if (act.length) {
        const bajos = act.filter(a => (a.desviacion as number) <= -UMBRAL_SIN_CAMBIO).length;
        const anio = act[0].anio;
        const incompleto = act.some(a => a.volumenIncompleto) ? ' Ojo: el volumen provisional está incompleto en algún módulo.' : '';
        t += bajos === act.length && act.length > 1
            ? ` En ${anio} el NDVI quedó por debajo de lo esperado en los ${act.length} módulos con dato, con volumen dentro del rango de los otros años.`
            : ` En ${anio}, ${bajos} de ${act.length} módulos con dato quedaron por debajo de lo esperado.`;
        t += incompleto;
    }
    return t;
}

// ── Carga del volumen del año actual ────────────────────────────────────────
// Reutiliza volumenAcumuladoPorModuloHm3 (hoja SRL provisional) con la misma ventana mar–sep del NDVI. Una sola consulta por
// sesión: los seis cuadros salen de la misma respuesta aunque el panel se monte varias veces. Un error no se guarda en caché.
type CargadorVolumen = typeof volumenAcumuladoPorModuloHm3;
let cache: Promise<VolumenActual> | null = null;

export function cargarVolumenActual(anio: number = ANIO_ACTUAL, cargador: CargadorVolumen = volumenAcumuladoPorModuloHm3, usarCache = true): Promise<VolumenActual> {
    if (usarCache && cache) return cache;
    const p = (async (): Promise<VolumenActual> => {
        try {
            const r = await cargador(`${anio}-09`, `${anio}-03`);
            return { porModulo: r.porModulo, mesesPorModulo: r.mesesPorModulo, mesesParciales: r.mesesParciales, error: r.error };
        } catch (e) {
            return { porModulo: new Map(), mesesPorModulo: new Map(), mesesParciales: [], error: e instanceof Error ? e.message : 'Error de red.' };
        }
    })();
    if (usarCache) {
        cache = p;
        void p.then(v => { if (v.error && cache === p) cache = null; });
    }
    return p;
}

/** Solo para pruebas: vacía la caché. */
export function reiniciarCacheVolumenActual(): void { cache = null; }

// ── Escalas de los cuadros ──────────────────────────────────────────────────
export interface EscalaEje { min: number; max: number; ticks: number[] }

/** Eje con 3–4 marcas «redondas» (paso 5, 10, 20, 25, 50…) que cubre [lo, hi] con un poco de holgura. Sin datos devuelve null. */
export function escalaEje(valores: number[], maxMarcas = 4): EscalaEje | null {
    const v = valores.filter(x => Number.isFinite(x));
    if (!v.length) return null;
    const lo = Math.min(...v), hi = Math.max(...v);
    const span = Math.max(hi - lo, Math.abs(hi) * 0.1, 1);
    for (const base of [1, 2, 2.5, 5, 10]) {
        for (let pot = 0.1; pot <= 1000; pot *= 10) {
            const paso = base * pot;
            const min = Math.floor((lo - span * 0.08) / paso) * paso;
            const max = Math.ceil((hi + span * 0.08) / paso) * paso;
            const n = Math.round((max - min) / paso) + 1;
            if (n <= maxMarcas && n >= 3) {
                return { min, max, ticks: Array.from({ length: n }, (_, i) => Number((min + i * paso).toFixed(6))) };
            }
        }
    }
    return { min: lo, max: hi, ticks: [lo, hi] };
}
