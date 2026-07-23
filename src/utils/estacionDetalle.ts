/**
 * ANALÍTICA POR ESTACIÓN — SICA-005
 *
 * Deriva, para UNA estación, los agregados que la tarjeta de la red no puede
 * mostrar: cierre del día anterior, acumulados, extremos y balance hídrico.
 *
 * Tres reglas de honestidad, verificadas contra los datos reales del corte
 * 2026-07-19 y que gobiernan todo este módulo:
 *
 *  1. ETo/lluvia del día son ACUMULADOS AL CORTE, no totales. `eto_mm` a las
 *     23:15 hora local vale 0 porque el día apenas empieza, no porque no haya
 *     demanda evaporativa. La cifra de referencia para decidir riego es el
 *     CIERRE DEL DÍA ANTERIOR (07-18 marcó 5.84-6.35 mm en las 4 estaciones);
 *     el acumulado de hoy es secundario y se rotula "al corte".
 *
 *  2. Una estación puede NO TENER PLUVIÓMETRO. Las Vírgenes reporta 0 en
 *     lluvia día/24h/mes/año simultáneamente, incluido el acumulado ANUAL,
 *     mientras Módulo 3 lleva 81.28 mm. Eso es sensor ausente, no sequía. Un
 *     balance hídrico ahí daría déficit falsamente extremo, así que se detecta
 *     y se rotula «sin pluviómetro» en vez de calcularse.
 *
 *  3. La ventana real manda sobre la ventana pedida. La integración es del
 *     2026-07-18: pedir "30 días" devuelve 3. Se declara SIEMPRE cuántos días
 *     cubre el dato, para que nadie lea 3 días como si fueran 30.
 */

import type { EstacionConLectura, LecturaClima } from '../hooks/useClimaEstaciones';

// ── Cierre diario: una fila por día, con el máximo de cada acumulado ────────

/** Resumen de un día natural (America/Chihuahua) para una estación. */
export interface DiaEstacion {
    fecha: string;
    /** Acumulados: se toma el MÁXIMO del día, que es el valor al cierre. */
    etoMm: number | null;
    lluviaMm: number | null;
    gdd: number | null;
    tempMaxC: number | null;
    tempMinC: number | null;
    /** Promedios del día. */
    tempMediaC: number | null;
    humMediaPct: number | null;
    vientoMediaMs: number | null;
    rafagaMaxMs: number | null;
    /** true si el día está cerrado (no es el día en curso). */
    completo: boolean;
    lecturas: number;
}

const TZ = 'America/Chihuahua';
export const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const maxOf = (vals: (number | null)[]): number | null => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
};
const minOf = (vals: (number | null)[]): number | null => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? Math.min(...v) : null;
};
const avgOf = (vals: (number | null)[]): number | null => {
    const v = vals.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Descarta el acumulado ARRASTRADO del día anterior.
 *
 * El contador `et_day`/`rainfall_day` de Davis se reinicia con unos minutos de
 * desfase respecto a la medianoche local, pero el sync ya fecha la lectura con
 * el día nuevo. Resultado observado en Boquilla el 2026-07-19:
 *
 *   00:00 local → et_dia = 6.38   ← cierre del 07-18, archivado como 07-19
 *   00:15 local → et_dia = 0      ← contador ya reiniciado
 *
 * Sin filtrar, el día nuevo arranca con un acumulado fantasma (aquí 6.38 mm) y
 * el cierre del día anterior queda subestimado. Como el resumen toma el MÁXIMO
 * del día, ese fantasma domina el valor y contamina el balance acumulado.
 *
 * Criterio: dentro de la madrugada, una lectura cuyo acumulado supere al de la
 * lectura siguiente DEL MISMO DÍA es un arrastre — un acumulado real solo puede
 * crecer dentro de su jornada.
 *
 * La ventana llega hasta las 03:00 y no solo a la hora 00 porque el cron corre
 * cada 2 h en horario fijo: si se retrasa o la estación tarda en reiniciar, el
 * arrastre puede capturarse a la 01:00 o 02:00. La comparación se restringe al
 * mismo día para no confundir el reinicio legítimo entre jornadas con un
 * arrastre: entre el cierre de un día y el inicio del siguiente el acumulado
 * SIEMPRE cae, y eso es correcto, no un defecto.
 */
const HORA_LIMITE_ARRASTRE = 3;

function descartaArrastre(entrada: LecturaClima[]): LecturaClima[] {
    if (entrada.length < 2) return entrada;
    // La comparación con la lectura siguiente exige orden cronológico; no se
    // asume el del origen para que el filtro no dependa del ORDER BY del query.
    const rows = [...entrada].sort((a, b) => a.ts.localeCompare(b.ts));
    const horaDe = (l: LecturaClima) =>
        Number(new Date(l.ts).toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }));

    return rows.filter((l, i) => {
        if (i === rows.length - 1 || horaDe(l) >= HORA_LIMITE_ARRASTRE) return true;
        const act = num(l.eto_mm) ?? num(l.et_dia_mm);
        if (act == null || act <= 0) return true;
        const sigue = rows[i + 1];
        // Solo compara dentro de la misma jornada: una caída al cambiar de día
        // es el reinicio normal del contador, no un arrastre.
        if (sigue.fecha !== l.fecha) return true;
        const sig = num(sigue.eto_mm) ?? num(sigue.et_dia_mm);
        // El acumulado bajó tras esta lectura ⇒ pertenecía al día anterior.
        return !(sig != null && sig < act);
    });
}

/**
 * Agrupa las lecturas crudas en días naturales.
 *
 * Acumulados (ETo, lluvia, GDD) usan MÁXIMO, no suma: la estación reporta el
 * acumulado corrido del día en cada lectura, así que sumarlas multiplicaría el
 * valor por el número de lecturas.
 */
export function resumeDias(lecturas: LecturaClima[]): DiaEstacion[] {
    const hoy = hoyLocal();
    const porDia = new Map<string, LecturaClima[]>();
    for (const l of descartaArrastre(lecturas)) {
        const arr = porDia.get(l.fecha);
        if (arr) arr.push(l); else porDia.set(l.fecha, [l]);
    }
    return [...porDia.entries()]
        .map(([fecha, rows]) => ({
            fecha,
            etoMm: maxOf(rows.map(r => num(r.eto_mm) ?? num(r.et_dia_mm))),
            lluviaMm: maxOf(rows.map(r => num(r.lluvia_dia_mm))),
            gdd: maxOf(rows.map(r => num(r.gdd))),
            tempMaxC: maxOf(rows.map(r => num(r.temp_max_c) ?? num(r.temp_c))),
            tempMinC: minOf(rows.map(r => num(r.temp_min_c) ?? num(r.temp_c))),
            tempMediaC: avgOf(rows.map(r => num(r.temp_c))),
            humMediaPct: avgOf(rows.map(r => num(r.hum_rel_pct))),
            vientoMediaMs: avgOf(rows.map(r => num(r.viento_ms))),
            rafagaMaxMs: maxOf(rows.map(r => num(r.viento_rafaga_ms))),
            completo: fecha !== hoy,
            lecturas: rows.length,
        }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ── Pluviómetro: presencia del sensor ───────────────────────────────────────

export type EstadoPluviometro = 'operativo' | 'ausente' | 'indeterminado';

/**
 * Decide si la estación mide lluvia.
 *
 * Firma de sensor ausente: TODOS los acumulados en cero a la vez, incluido el
 * ANUAL. Un periodo seco deja el día y las 24 h en cero, pero el acumulado
 * anual conserva la lluvia previa; que también valga cero indica que nunca ha
 * registrado nada. Con pocas lecturas se responde 'indeterminado' antes que
 * afirmar una avería.
 *
 * El mínimo es de un día completo de reporte (~12 lecturas a 2 h) y no de unas
 * pocas muestras: una estación recién instalada en periodo seco tiene todos sus
 * contadores en cero —incluido el anual, que arranca al instalarse— y con un
 * umbral bajo se la declararía averiada estando sana. Ante la duda, el panel
 * dice «no se puede confirmar», que es revisable, en vez de «sin pluviómetro»,
 * que manda a buscar una estación vecina sin motivo.
 */
const MIN_LECTURAS_PLUVIOMETRO = 12;

export function evaluaPluviometro(lecturas: LecturaClima[]): EstadoPluviometro {
    const conDato = lecturas.filter(l => num(l.lluvia_anio_mm) != null);
    if (conDato.length < MIN_LECTURAS_PLUVIOMETRO) return 'indeterminado';
    const algo = lecturas.some(l =>
        (num(l.lluvia_anio_mm) ?? 0) > 0 || (num(l.lluvia_mes_mm) ?? 0) > 0 ||
        (num(l.lluvia_dia_mm) ?? 0) > 0 || (num(l.lluvia_24h_mm) ?? 0) > 0);
    return algo ? 'operativo' : 'ausente';
}

// ── Balance hídrico sobre la ventana realmente disponible ───────────────────

export interface BalanceHidrico {
    /** Días con dato efectivamente usados (puede ser < al solicitado). */
    diasReales: number;
    diasSolicitados: number;
    /** true si la ventana real no alcanza a la pedida: hay que declararlo. */
    ventanaParcial: boolean;
    etoAcumMm: number | null;
    lluviaAcumMm: number | null;
    /** ETo − lluvia. Positivo = déficit (hay que reponer). null si no calculable. */
    deficitMm: number | null;
    /** Media diaria de ETo en la ventana: dimensiona la lámina de riego. */
    etoDiaMediaMm: number | null;
    pluviometro: EstadoPluviometro;
    /** Motivo por el que no hay balance, si aplica. */
    bloqueo: string | null;
}

/**
 * Balance ETo − lluvia sobre los últimos `dias` DÍAS CERRADOS.
 *
 * Excluye el día en curso a propósito: su acumulado parcial rebajaría la media
 * diaria y haría parecer que la demanda cayó.
 */
export function balanceHidrico(
    dias: DiaEstacion[], pluviometro: EstadoPluviometro, ventana: number,
): BalanceHidrico {
    const cerrados = dias.filter(d => d.completo).slice(-ventana);
    const conEto = cerrados.filter(d => d.etoMm != null && d.etoMm > 0);

    const base: BalanceHidrico = {
        diasReales: conEto.length,
        diasSolicitados: ventana,
        ventanaParcial: conEto.length < ventana,
        etoAcumMm: null, lluviaAcumMm: null, deficitMm: null, etoDiaMediaMm: null,
        pluviometro, bloqueo: null,
    };

    if (!conEto.length) {
        return { ...base, bloqueo: 'Sin días cerrados con ETₒ registrada todavía.' };
    }

    const etoAcum = conEto.reduce((a, d) => a + (d.etoMm ?? 0), 0);
    const etoMedia = etoAcum / conEto.length;

    // Sin pluviómetro NO se publica déficit: sería ETo íntegra presentada como
    // si el sensor hubiera confirmado que no llovió.
    if (pluviometro !== 'operativo') {
        return {
            ...base, etoAcumMm: etoAcum, etoDiaMediaMm: etoMedia,
            bloqueo: pluviometro === 'ausente'
                ? 'Sin pluviómetro: no se calcula déficit (la lluvia no se mide en esta estación).'
                : 'Registro de lluvia insuficiente para confirmar el pluviómetro.',
        };
    }

    const lluviaAcum = conEto.reduce((a, d) => a + (d.lluviaMm ?? 0), 0);
    return {
        ...base,
        etoAcumMm: etoAcum, lluviaAcumMm: lluviaAcum,
        deficitMm: etoAcum - lluviaAcum, etoDiaMediaMm: etoMedia,
    };
}

// ── Referencia diaria: cierre de ayer + acumulado de hoy ────────────────────

export interface ReferenciaEto {
    /** ETo del último día CERRADO: la cifra que dimensiona el riego. */
    cierreMm: number | null;
    cierreFecha: string | null;
    /** Acumulado del día en curso al momento del corte (parcial por definición). */
    hoyParcialMm: number | null;
    /** true de madrugada, cuando el parcial es ~0 y no significa "sin demanda". */
    hoyEsMadrugada: boolean;
}

/**
 * Separa el cierre de ayer del parcial de hoy.
 *
 * Este es el arreglo del "ETₒ 0.00" que mostraba la tarjeta: el 0.00 era el
 * acumulado real a las 23:15 locales, correcto pero inútil para decidir. Con
 * el cierre de ayer al frente, la tarjeta siempre lleva una cifra accionable.
 */
export function referenciaEto(dias: DiaEstacion[]): ReferenciaEto {
    const hoy = hoyLocal();
    const cerrados = dias.filter(d => d.completo && d.etoMm != null && d.etoMm > 0);
    const ultimo = cerrados[cerrados.length - 1] ?? null;
    const diaHoy = dias.find(d => d.fecha === hoy) ?? null;
    const parcial = diaHoy?.etoMm ?? null;
    return {
        cierreMm: ultimo?.etoMm ?? null,
        cierreFecha: ultimo?.fecha ?? null,
        hoyParcialMm: parcial,
        // Antes de las 09:00 locales el acumulado aún no es informativo.
        hoyEsMadrugada: Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false })) < 9,
    };
}

// ── Viento: rosa por sectores, para ventana de aplicación ──────────────────

export const SECTORES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

export interface RosaViento {
    sector: string;
    /** Porcentaje de lecturas con el viento en ese sector. */
    pct: number;
    /** Velocidad media registrada mientras soplaba de ahí (m/s). */
    velMediaMs: number | null;
}

export function rosaDeVientos(lecturas: LecturaClima[]): RosaViento[] {
    const conDir = lecturas.filter(l => num(l.viento_dir_deg) != null);
    if (!conDir.length) return [];
    const acc = SECTORES.map(() => ({ n: 0, suma: 0, nVel: 0 }));
    for (const l of conDir) {
        const dir = ((num(l.viento_dir_deg) as number) % 360 + 360) % 360;
        const i = Math.round(dir / 45) % 8;
        acc[i].n++;
        const v = num(l.viento_ms);
        if (v != null) { acc[i].suma += v; acc[i].nVel++; }
    }
    return SECTORES.map((sector, i) => ({
        sector,
        pct: (100 * acc[i].n) / conDir.length,
        velMediaMs: acc[i].nVel ? acc[i].suma / acc[i].nVel : null,
    }));
}

// ── Riesgo de rocío/helada a partir del punto de rocío ─────────────────────

export interface RiesgoTermico {
    /** Menor diferencia temp − punto de rocío en la ventana (°C). */
    spreadMinC: number | null;
    /** Temperatura mínima registrada (°C). */
    tempMinC: number | null;
    etiqueta: string;
    color: string;
}

/**
 * Diagnóstico térmico nocturno.
 *
 * Spread (T − Td) pequeño ⇒ aire saturado ⇒ rocío/niebla, que retrasa labores
 * y favorece hongos. Mínima bajo 3 °C ⇒ riesgo de helada.
 */
export function riesgoTermico(dias: DiaEstacion[], lecturas: LecturaClima[]): RiesgoTermico {
    const spreads = lecturas
        .map(l => { const t = num(l.temp_c), d = num(l.punto_rocio_c); return t != null && d != null ? t - d : null; })
        .filter((v): v is number => v != null);
    const spreadMin = spreads.length ? Math.min(...spreads) : null;
    const tMin = minOf(dias.map(d => d.tempMinC));

    if (tMin != null && tMin <= 3) return { spreadMinC: spreadMin, tempMinC: tMin, etiqueta: 'Riesgo de helada', color: '#60a5fa' };
    if (spreadMin != null && spreadMin <= 2) return { spreadMinC: spreadMin, tempMinC: tMin, etiqueta: 'Rocío / niebla probable', color: '#38bdf8' };
    if (spreadMin != null && spreadMin <= 5) return { spreadMinC: spreadMin, tempMinC: tMin, etiqueta: 'Humedad nocturna alta', color: '#22c55e' };
    if (spreadMin == null) return { spreadMinC: null, tempMinC: tMin, etiqueta: 'Sin dato', color: '#64748b' };
    return { spreadMinC: spreadMin, tempMinC: tMin, etiqueta: 'Sin riesgo térmico', color: '#22c55e' };
}

// ── Paquete completo del detalle de una estación ───────────────────────────

export interface DetalleEstacion {
    dias: DiaEstacion[];
    pluviometro: EstadoPluviometro;
    referencia: ReferenciaEto;
    /** Referencia corta, siempre fija en 7 días. */
    balance7: BalanceHidrico;
    /** Balance de la ventana/rango de análisis activo (puede no ser 30 días). */
    balanceVentana: BalanceHidrico;
    rosa: RosaViento[];
    riesgo: RiesgoTermico;
    /** Acumulados nativos de la estación en la última lectura. */
    lluviaMesMm: number | null;
    lluviaAnioMm: number | null;
    etMesMm: number | null;
    /** Días consecutivos sin lluvia (null si no hay pluviómetro). */
    rachaSecaDias: number | null;
    /** Cobertura real del histórico consultado. */
    diasConDato: number;
    totalLecturas: number;
}

/**
 * @param diasVentana Días que abarca la ventana/rango activo, para el segundo
 * bloque de balance («Últimos N días»). Por defecto 30, igual que antes de
 * que el balance siguiera al selector de periodo.
 */
export function construyeDetalle(
    est: EstacionConLectura, lecturas: LecturaClima[], diasVentana = 30,
): DetalleEstacion {
    const dias = resumeDias(lecturas);
    const pluviometro = evaluaPluviometro(lecturas);
    const l = est.lectura;

    // Racha seca: solo tiene sentido si el sensor mide.
    let racha: number | null = null;
    if (pluviometro === 'operativo') {
        racha = 0;
        for (let i = dias.length - 1; i >= 0; i--) {
            if ((dias[i].lluviaMm ?? 0) > 0) break;
            racha++;
        }
    }

    return {
        dias,
        pluviometro,
        referencia: referenciaEto(dias),
        balance7: balanceHidrico(dias, pluviometro, 7),
        balanceVentana: balanceHidrico(dias, pluviometro, diasVentana),
        rosa: rosaDeVientos(lecturas),
        riesgo: riesgoTermico(dias, lecturas),
        lluviaMesMm: num(l?.lluvia_mes_mm),
        lluviaAnioMm: num(l?.lluvia_anio_mm),
        etMesMm: num(l?.et_mes_mm),
        rachaSecaDias: racha,
        diasConDato: dias.length,
        totalLecturas: lecturas.length,
    };
}
