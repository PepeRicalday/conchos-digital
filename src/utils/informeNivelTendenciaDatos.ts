/**
 * informeNivelTendenciaDatos — cálculo puro del informe-infografía "Nivel y Tendencia de Presas".
 *
 * Fuente única: el índice de v_presas_serie_diaria (CAMPO/CILA + histórico SRL). Regla rectora "S/D nunca cero":
 * un dato ausente es `null`; ninguna cifra derivada se calcula con un extremo faltante.
 */
import {
    NOMBRE_PRESA, MESES_CORTO, MESES_LARGO, aniosDisponibles, aperturaMes, calidadMes, cierreMes, cierresPorAnio, deltaMes, diasDelMes,
    mismaFecha, matrizMensual, posicionHistorica, serieMes, valorMetrica,
    type CeldaMatriz, type DeltaMes, type Fuente, type Indice, type PresaId, type ValorFechado,
} from './historicoPresas';
import { anomaliaVsPromedio, semaforo, type EstadoSemaforo } from './estadisticaHistorica';
import { cruzaAnio, etiquetaAnioPeriodo, mesesDelPeriodo, type ConfigNivelTendencia } from './informeNivelTendenciaConfig';
import type { Metrica, TipoSerie } from './historicoPresas';

const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const diasEntre = (a: string, b: string) => Math.round((dia(b) - dia(a)) / 86_400_000);

/** Cambio de nivel menor que esto en el mes se considera "estable" (tolerancia de lectura del limnímetro). */
export const UMBRAL_ESTABLE_M = 0.05;
export const UMBRAL_ESTABLE_MM3 = 0.5;

export interface PuntoCorte {
    fecha: string;
    escala: number | null;
    volumen: number | null;
    pct: number | null;
    fuente: Fuente;
    /** Días entre el corte y la fecha de emisión (frescura del dato). */
    diasDesdeCorte: number;
    /** true = es el dato más reciente de toda la serie (nivel "actual"); false = cierre de un periodo pasado. */
    esActual: boolean;
    /** true = el corte cae fuera del mes elegido (el mes no tiene ningún dato y se usó el último anterior). */
    fueraDelMes: boolean;
}

export type EstadoTendencia = 'sube' | 'baja' | 'estable' | 'sd';

export interface TendenciaMes {
    anio: number;
    mes: number;
    nombreMes: string;
    dias: number[];
    escala: (number | null)[];
    volumen: (number | null)[];
    deltaEscala: DeltaMes | null;
    deltaVolumen: DeltaMes | null;
    /** cm/día entre los dos extremos del delta de elevación; null si falta alguno. */
    ritmoCmDia: number | null;
    minEscala: ValorFechado | null;
    maxEscala: ValorFechado | null;
    minVolumen: ValorFechado | null;
    maxVolumen: ValorFechado | null;
    diasConDato: number;
    diasMes: number;
    atipicos: number;
    estado: EstadoTendencia;
}

export interface FilaMismoDia {
    anio: number;
    fecha: string;
    volumen: number | null;
    escala: number | null;
    desfaseDias: number;
    /** Hoy − ese año (positivo = hoy hay más). null si falta el dato de hoy o el del año. */
    deltaVolumen: number | null;
    deltaEscala: number | null;
}

export interface SerieAnioNT {
    anio: number;
    esBase: boolean;
    volumen: (number | null)[];
    escala: (number | null)[];
}

export interface BarraCierre { anio: number; valor: number | null; fecha: string | null; esBase: boolean }

export interface FilaCalor { anio: number; celdas: CeldaMatriz[] }

export interface MovimientoMesNT { anio: number; mes: number; deltaEscala: number | null; deltaVolumen: number | null }

export interface ExtremoPeriodo { fecha: string; valor: number }

export interface MovimientoAnioNT {
    anio: number;
    etiqueta: string;
    esBase: boolean;
    meses: MovimientoMesNT[];
    escalaIni: ExtremoPeriodo | null;
    escalaFin: ExtremoPeriodo | null;
    volumenIni: ExtremoPeriodo | null;
    volumenFin: ExtremoPeriodo | null;
    /** Δ = final − inicial; null si falta alguno de los dos extremos. */
    deltaEscala: number | null;
    deltaVolumen: number | null;
    ritmoCmDia: number | null;
    /** true = el último mes del periodo no tiene dato (periodo en curso): el final es el último dato disponible. */
    parcial: boolean;
}

export interface MovimientoNT {
    etiquetaPeriodo: string;
    /** Meses del periodo en orden (etiqueta de fila de las tablas). */
    meses: number[];
    anios: MovimientoAnioNT[];
    promedioComp: { deltaEscala: number | null; deltaVolumen: number | null; n: number } | null;
    lectura: string[];
}

export interface DatosPresaNT {
    id: PresaId;
    nombre: string;
    sinHistorico: boolean;
    movimiento: MovimientoNT;
    corte: PuntoCorte | null;
    tendencia: TendenciaMes;
    mismoDia: FilaMismoDia[];
    /** Posición de hoy entre los mismos días de los años comparados (1 = el más bajo). */
    posicion: { posicion: number; de: number } | null;
    semaforo: EstadoSemaforo;
    promedioMismoDia: { promedio: number; n: number; abs: number; pct: number | null } | null;
    series: SerieAnioNT[];
    cierres: BarraCierre[];
    calor: FilaCalor[];
    calidad: { conDato: number; diasMes: number; atipicos: number };
    lectura: string[];
}

export interface DatosNivelTendencia {
    config: ConfigNivelTendencia;
    aniosComparacion: number[];
    presas: DatosPresaNT[];
    emitido: Date;
    anioMin: number | null;
    anioMax: number | null;
}

const fmt = (v: number | null, d: number) => (v == null ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const conSigno = (v: number, d: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Último día con dato (volumen o elevación) hasta el fin del mes elegido. */
function buscarCorte(mapa: Indice[string] | undefined, anio: number, mes: number, config: ConfigNivelTendencia, hoy: Date): PuntoCorte | null {
    if (!mapa) return null;
    const finMes = `${anio}-${String(mes).padStart(2, '0')}-${String(diasDelMes(anio, mes)).padStart(2, '0')}`;
    let mejor: string | null = null;
    let ultimoGlobal: string | null = null;
    for (const [fecha, p] of mapa) {
        const hay = valorMetrica(p, 'volumen', config.serie) != null || valorMetrica(p, 'elevacion', config.serie) != null;
        if (!hay) continue;
        if (!ultimoGlobal || fecha > ultimoGlobal) ultimoGlobal = fecha;
        if (fecha <= finMes && (!mejor || fecha > mejor)) mejor = fecha;
    }
    if (!mejor) return null;
    const p = mapa.get(mejor)!;
    const iniMes = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    return {
        fecha: mejor,
        escala: valorMetrica(p, 'elevacion', config.serie),
        volumen: valorMetrica(p, 'volumen', config.serie),
        pct: valorMetrica(p, 'llenado', config.serie),
        fuente: p.fuente,
        diasDesdeCorte: Math.max(0, diasEntre(mejor, hoyIso)),
        esActual: mejor === ultimoGlobal,
        fueraDelMes: mejor < iniMes,
    };
}

function extremosDe(valores: (number | null)[], anio: number, mes: number): { min: ValorFechado | null; max: ValorFechado | null } {
    let min: ValorFechado | null = null, max: ValorFechado | null = null;
    valores.forEach((v, i) => {
        if (v == null) return;
        const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        if (!min || v < min.valor) min = { fecha, valor: v };
        if (!max || v > max.valor) max = { fecha, valor: v };
    });
    return { min, max };
}

function estadoDe(dE: DeltaMes | null, dV: DeltaMes | null): EstadoTendencia {
    if (dE) return Math.abs(dE.delta) < UMBRAL_ESTABLE_M ? 'estable' : dE.delta > 0 ? 'sube' : 'baja';
    if (dV) return Math.abs(dV.delta) < UMBRAL_ESTABLE_MM3 ? 'estable' : dV.delta > 0 ? 'sube' : 'baja';
    return 'sd';
}

/**
 * Extremos de un periodo para una métrica. Inicial = último dato del mes anterior al periodo (convención de los
 * reportes SRL, igual que deltaMes); si no existe, el primer dato del periodo. Final = último dato del último mes
 * con dato dentro del periodo (periodo en curso → `parcial`). Sin dos puntos distintos en el tiempo → Δ null.
 */
function extremosPeriodo(
    mapa: Indice[string] | undefined, meses: { anio: number; mes: number }[], metrica: Metrica, serie: TipoSerie,
): { ini: ExtremoPeriodo | null; fin: ExtremoPeriodo | null; parcial: boolean } {
    let fin: ExtremoPeriodo | null = null;
    let parcial = false;
    for (let i = meses.length - 1; i >= 0; i--) {
        const c = cierreMes(mapa, meses[i].anio, meses[i].mes, metrica, serie);
        if (c) { fin = { fecha: c.fecha, valor: c.valor }; parcial = i < meses.length - 1; break; }
    }
    const { anio: a0, mes: m0 } = meses[0];
    const previo = cierreMes(mapa, m0 === 1 ? a0 - 1 : a0, m0 === 1 ? 12 : m0 - 1, metrica, serie);
    let ini: ExtremoPeriodo | null = previo ? { fecha: previo.fecha, valor: previo.valor } : null;
    if (!ini) {
        for (const { anio, mes } of meses) {
            const a = aperturaMes(mapa, anio, mes, metrica, serie);
            if (a) { ini = { fecha: a.fecha, valor: a.valor }; break; }
        }
    }
    return { ini, fin, parcial };
}

function movimientoAnio(mapa: Indice[string] | undefined, config: ConfigNivelTendencia, anio: number): MovimientoAnioNT {
    const { periodo, serie } = config;
    const lista = mesesDelPeriodo(periodo, anio);
    const meses: MovimientoMesNT[] = lista.map(({ anio: a, mes }) => ({
        anio: a, mes,
        deltaEscala: deltaMes(mapa, a, mes, 'elevacion', serie)?.delta ?? null,
        deltaVolumen: deltaMes(mapa, a, mes, 'volumen', serie)?.delta ?? null,
    }));
    const e = extremosPeriodo(mapa, lista, 'elevacion', serie);
    const v = extremosPeriodo(mapa, lista, 'volumen', serie);
    const delta = (x: { ini: ExtremoPeriodo | null; fin: ExtremoPeriodo | null }) =>
        x.ini && x.fin && x.ini.fecha < x.fin.fecha ? x.fin.valor - x.ini.valor : null;
    const dE = delta(e);
    const dias = e.ini && e.fin ? diasEntre(e.ini.fecha, e.fin.fecha) : 0;
    return {
        anio, etiqueta: etiquetaAnioPeriodo(periodo, anio), esBase: anio === config.anioBase, meses,
        escalaIni: e.ini, escalaFin: e.fin, volumenIni: v.ini, volumenFin: v.fin,
        deltaEscala: dE, deltaVolumen: delta(v),
        ritmoCmDia: dE != null && dias > 0 ? (dE * 100) / dias : null,
        parcial: e.parcial || v.parcial,
    };
}

function promedio(xs: (number | null)[]): number | null {
    const ok = xs.filter((x): x is number => x != null);
    return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
}

export function calcularMovimiento(
    mapa: Indice[string] | undefined, config: ConfigNivelTendencia, aniosComparacion: number[], nombre: string,
): MovimientoNT {
    const { periodo } = config;
    const anios = [...aniosComparacion, config.anioBase].map(a => movimientoAnio(mapa, config, a));
    const comp = anios.filter(a => !a.esBase && (a.deltaEscala != null || a.deltaVolumen != null));
    const m0 = periodo.mesIni, m1 = periodo.mesFin;
    const etiquetaPeriodo = (m0 === 1 && m1 === 12) ? 'Año calendario (ene–dic)'
        : (m0 === 10 && m1 === 9) ? 'Ciclo completo (oct–sep)'
        : m0 === m1 ? MESES_LARGO[m0 - 1] : `${MESES_LARGO[m0 - 1]} a ${MESES_LARGO[m1 - 1].toLowerCase()}${cruzaAnio(periodo) ? ' (cruza el año)' : ''}`;
    const mov: MovimientoNT = {
        etiquetaPeriodo,
        meses: mesesDelPeriodo(periodo, config.anioBase).map(m => m.mes),
        anios,
        promedioComp: comp.length ? { deltaEscala: promedio(comp.map(a => a.deltaEscala)), deltaVolumen: promedio(comp.map(a => a.deltaVolumen)), n: comp.length } : null,
        lectura: [],
    };
    mov.lectura = redactarLecturaMovimiento(nombre, mov);
    return mov;
}

/** Frases de lectura del periodo: solo hechos del dato; un dato faltante omite la frase (nunca se inventa un cero). */
export function redactarLecturaMovimiento(nombre: string, mov: MovimientoNT): string[] {
    const base = mov.anios.find(a => a.esBase);
    const sinDato = [`Sin datos suficientes de ${nombre} para medir el movimiento de ${mov.etiquetaPeriodo.toLowerCase()} (S/D).`];
    if (!base || (base.deltaEscala == null && base.deltaVolumen == null)) return sinDato;
    const out: string[] = [];
    const verbo = (d: number | null, umbral: number) => (d == null ? null : Math.abs(d) < umbral ? 'se mantuvo estable' : d > 0 ? 'subió' : 'bajó');
    const accion = verbo(base.deltaEscala, UMBRAL_ESTABLE_M) ?? verbo(base.deltaVolumen, UMBRAL_ESTABLE_MM3) ?? 'cambió';
    const cifras = [
        base.deltaEscala != null ? `${conSigno(base.deltaEscala, 2)} m` : null,
        base.deltaVolumen != null ? `${conSigno(base.deltaVolumen, 1)} Mm³` : null,
    ].filter(Boolean).join(' / ');
    const f0 = base.escalaIni?.fecha ?? base.volumenIni?.fecha, f1 = base.escalaFin?.fecha ?? base.volumenFin?.fecha;
    const fechaTxt = (iso?: string) => (iso ? `${+iso.slice(8, 10)} ${MESES_CORTO[+iso.slice(5, 7) - 1].toLowerCase()} ${iso.slice(0, 4)}` : 'S/D');
    out.push(`En ${mov.etiquetaPeriodo.toLowerCase()} (${base.etiqueta}) ${nombre} ${accion}: ${cifras} entre el ${fechaTxt(f0)} y el ${fechaTxt(f1)}.`);
    if (base.parcial) out.push(`Periodo en curso: el cálculo llega al último dato disponible (${fechaTxt(f1)}), no al fin del periodo.`);

    const pc = mov.promedioComp;
    if (pc && base.deltaVolumen != null && pc.deltaVolumen != null) {
        const dif = base.deltaVolumen - pc.deltaVolumen;
        out.push(Math.abs(dif) < UMBRAL_ESTABLE_MM3
            ? `Su movimiento de volumen es similar al promedio de ${pc.n} ${pc.n === 1 ? 'periodo comparado' : 'periodos comparados'} (${conSigno(pc.deltaVolumen, 1)} Mm³).`
            : `Su movimiento de volumen queda ${Math.abs(dif).toLocaleString('es-MX', { maximumFractionDigits: 1 })} Mm³ ${dif > 0 ? 'por encima' : 'por debajo'} del promedio de ${pc.n} ${pc.n === 1 ? 'periodo comparado' : 'periodos comparados'} (${conSigno(pc.deltaVolumen, 1)} Mm³).`);
    }
    const conVol = base.meses.filter(m => m.deltaVolumen != null);
    if (conVol.length > 1) {
        const mayor = conVol.reduce((a, b) => (Math.abs(b.deltaVolumen as number) > Math.abs(a.deltaVolumen as number) ? b : a));
        out.push(`El mes de mayor cambio fue ${MESES_LARGO[mayor.mes - 1].toLowerCase()} ${mayor.anio} (${conSigno(mayor.deltaVolumen as number, 1)} Mm³).`);
    }
    return out;
}

export function prepararNivelTendencia(config: ConfigNivelTendencia, idx: Indice, hoy: Date = new Date()): DatosNivelTendencia {
    const todos = aniosDisponibles(idx);
    const aniosComparacion = [...new Set(config.aniosComparacion)].filter(a => a !== config.anioBase && todos.includes(a)).sort((a, b) => a - b);
    const { anioBase: A, mes: M, serie } = config;
    const nDias = diasDelMes(A, M);
    const nombreMes = MESES_LARGO[M - 1];

    const presas: DatosPresaNT[] = config.presas.map((id) => {
        const mapa = idx[id];
        const nombre = NOMBRE_PRESA[id] ?? id;
        const corte = buscarCorte(mapa, A, M, config, hoy);

        const escala = serieMes(mapa, A, M, 'elevacion', serie);
        const volumen = serieMes(mapa, A, M, 'volumen', serie);
        const dE = deltaMes(mapa, A, M, 'elevacion', serie);
        const dV = deltaMes(mapa, A, M, 'volumen', serie);
        const dias = dE ? diasEntre(dE.desde.fecha, dE.hasta.fecha) : 0;
        const ex = extremosDe(escala, A, M);
        const exV = extremosDe(volumen, A, M);
        const cal = calidadMes(mapa, A, M);
        const tendencia: TendenciaMes = {
            anio: A, mes: M, nombreMes, dias: Array.from({ length: nDias }, (_, i) => i + 1), escala, volumen,
            deltaEscala: dE, deltaVolumen: dV,
            ritmoCmDia: dE && dias > 0 ? (dE.delta * 100) / dias : null,
            minEscala: ex.min, maxEscala: ex.max, minVolumen: exV.min, maxVolumen: exV.max,
            diasConDato: cal.conDato, diasMes: cal.diasMes, atipicos: cal.atipicos,
            estado: estadoDe(dE, dV),
        };

        // Mismo día: el día/mes del corte (si el mes no tuvo datos, el fin de mes).
        const mesRef = corte && !corte.fueraDelMes ? +corte.fecha.slice(5, 7) : M;
        const diaRef = corte && !corte.fueraDelMes ? +corte.fecha.slice(8, 10) : nDias;
        const vols = new Map(mismaFecha(mapa, mesRef, diaRef, aniosComparacion, 'volumen', serie).map(r => [r.anio, r]));
        const escs = new Map(mismaFecha(mapa, mesRef, diaRef, aniosComparacion, 'elevacion', serie).map(r => [r.anio, r]));
        const mismoDia: FilaMismoDia[] = aniosComparacion.flatMap((anio) => {
            const v = vols.get(anio), e = escs.get(anio);
            if (!v && !e) return [];
            const volumenA = v?.valor ?? null, escalaA = e?.valor ?? null;
            return [{
                anio, fecha: (v ?? e)!.fecha, volumen: volumenA, escala: escalaA, desfaseDias: (v ?? e)!.desfaseDias,
                deltaVolumen: corte?.volumen != null && volumenA != null ? corte.volumen - volumenA : null,
                deltaEscala: corte?.escala != null && escalaA != null ? corte.escala - escalaA : null,
            }];
        }).reverse(); // más reciente primero

        // Posición de hoy entre los mismos días de los años comparados.
        const grupo = [...mismoDia.filter(r => r.volumen != null).map(r => ({ anio: r.anio, valor: r.volumen as number, fecha: r.fecha }))];
        if (corte?.volumen != null) grupo.push({ anio: A, valor: corte.volumen, fecha: corte.fecha });
        const posicion = posicionHistorica(grupo.sort((x, y) => x.valor - y.valor), A);
        const hist = mismoDia.map(r => r.volumen);
        const an = anomaliaVsPromedio(corte?.volumen, hist);

        const series: SerieAnioNT[] = [...aniosComparacion, A].map((anio) => {
            const aj = (arr: (number | null)[]) => Array.from({ length: nDias }, (_, i) => arr[i] ?? null);
            return { anio, esBase: anio === A, volumen: aj(serieMes(mapa, anio, M, 'volumen', serie)), escala: aj(serieMes(mapa, anio, M, 'elevacion', serie)) };
        });

        const porAnio = new Map(cierresPorAnio(mapa, [...aniosComparacion, A], M, 'volumen', serie).map(c => [c.anio, c]));
        const cierres: BarraCierre[] = [...aniosComparacion, A].map(anio => ({
            anio, valor: porAnio.get(anio)?.valor ?? null, fecha: porAnio.get(anio)?.fecha ?? null, esBase: anio === A,
        }));

        const aniosCalor = [...aniosComparacion, A];
        const matriz = matrizMensual(mapa, aniosCalor, 'volumen', serie);
        const calor: FilaCalor[] = aniosCalor.map(anio => ({ anio, celdas: matriz.get(anio) ?? [] }))
            .filter(f => f.celdas.some(c => c.valor != null));

        const sem = semaforo(posicion);
        const lectura = redactarLectura({ nombre, corte, tendencia, an, posicion, nComp: mismoDia.length, nombreMes: nombreMes.toLowerCase(), A });

        return {
            id, nombre, sinHistorico: !mapa || mapa.size === 0, movimiento: calcularMovimiento(mapa, config, aniosComparacion, nombre), corte, tendencia, mismoDia, posicion, semaforo: sem,
            promedioMismoDia: an ? { promedio: an.promedio, n: an.n, abs: an.abs, pct: an.pct } : null,
            series, cierres, calor, calidad: { conDato: cal.conDato, diasMes: cal.diasMes, atipicos: cal.atipicos }, lectura,
        };
    });

    return { config, aniosComparacion, presas, emitido: hoy, anioMin: todos.length ? Math.min(...todos) : null, anioMax: todos.length ? Math.max(...todos) : null };
}

interface EntradaLectura {
    nombre: string;
    corte: PuntoCorte | null;
    tendencia: TendenciaMes;
    an: { abs: number; pct: number | null; promedio: number; n: number } | null;
    posicion: { posicion: number; de: number } | null;
    nComp: number;
    nombreMes: string;
    A: number;
}

/** Frases de lectura ejecutiva por reglas: solo hechos del dato, sin causas ni pronóstico. Un dato faltante omite la frase. */
export function redactarLectura(e: EntradaLectura): string[] {
    const out: string[] = [];
    const { corte, tendencia: t } = e;
    if (!corte || (corte.volumen == null && corte.escala == null)) return ['Sin datos de nivel ni volumen para el periodo elegido (S/D).'];
    const partes = [
        corte.volumen != null ? `${fmt(corte.volumen, 1)} Mm³` : null,
        corte.pct != null ? `${fmt(corte.pct, 1)} % de llenado` : null,
        corte.escala != null ? `${fmt(corte.escala, 2)} msnm` : null,
    ].filter(Boolean).join(' · ');
    out.push(`${e.nombre} ${corte.esActual ? 'registra' : 'registró al corte'}: ${partes}.`);

    const dE = t.deltaEscala, dV = t.deltaVolumen;
    if (t.estado === 'estable') out.push(`En ${e.nombreMes} el nivel se mantiene estable (cambio menor a ${UMBRAL_ESTABLE_M * 100} cm).`);
    else if (dE) out.push(`En ${e.nombreMes} el nivel ${dE.delta > 0 ? 'sube' : 'baja'} ${conSigno(Math.abs(dE.delta), 2).replace(/^[+−]/, '')} m${dV ? ` (${conSigno(dV.delta, 1)} Mm³)` : ''} respecto al ${dE.base === 'mes-anterior' ? 'cierre del mes anterior' : 'primer dato del mes'}.`);
    else if (dV) out.push(`En ${e.nombreMes} el volumen ${dV.delta > 0 ? 'aumenta' : 'disminuye'} ${Math.abs(dV.delta).toLocaleString('es-MX', { maximumFractionDigits: 1 })} Mm³.`);

    if (e.an && e.an.n >= 1) {
        const lado = e.an.abs > 0 ? 'por encima' : e.an.abs < 0 ? 'por debajo' : 'igual';
        out.push(lado === 'igual'
            ? `Coincide con el promedio de ${e.an.n} ${e.an.n === 1 ? 'año' : 'años'} para este día.`
            : `Está ${Math.abs(e.an.abs).toLocaleString('es-MX', { maximumFractionDigits: 1 })} Mm³ ${lado} del promedio de ${e.an.n} ${e.an.n === 1 ? 'año' : 'años'} para este día${e.posicion ? ` (lugar ${e.posicion.posicion} de ${e.posicion.de}, de menor a mayor)` : ''}.`);
    }
    return out;
}
