/**
 * perfilCanal — modelo PURO de la tarjeta "Canal" del Dashboard: las 14 escalas del canal (K-0 … K-104) con su
 * medición de campo más reciente, estado y posición dentro de su rango operativo.
 *
 * Reglas (heredadas de Control de Niveles y corregidas respecto a la tarjeta anterior):
 *  · Una fila autogenerada de continuidad (confirmada = false, "SICA Chronos") es un ARRASTRE, no una medición.
 *  · La edad se mide con fecha + hora_lectura (UTC−6), NO con `creado_en` (que para el arrastre es siempre 00:00 local).
 *  · K-64 y K-94+200 son escalas de REFERENCIA: solo aportan nivel, nunca gasto.
 *  · S/D (null) nunca es 0. "N de 14 con medición vigente" sí es un conteo y 0 es un valor legítimo.
 *  · En VACIADO el rango operativo de riego no aplica: no hay "fuera de rango".
 */
import { estadoNivel, aNumeroONull, type EstadoNivel } from './controlEscalas';
import { esEscalaReferencia } from './escalasReferencia';
import { esFrescaEscala, gastoDeLectura, minutosDesde } from './geoKpis';
import { conduccionTramo, type ConduccionTramo } from './conduccion';
import type { EscalaMeta, LecturaEscala } from './controlEscalasZonas';

export interface EscalaCanalKpi {
    id: string;
    nombre: string;
    km: number;
    referencia: boolean;
    /** Nivel de la última MEDICIÓN DE CAMPO (puede ser vieja); null = nunca hubo medición de campo en la ventana. */
    nivelM: number | null;
    /** Nivel del arrastre (solo para dibujar el punto hueco cuando no hay medición de campo). */
    nivelArrastreM: number | null;
    rangoMin: number | null;
    rangoMax: number | null;
    /** Posición del nivel dentro de su rango (0 = mínimo, 1 = máximo); null sin nivel o sin rango. Puede salirse de [0, 1]. */
    u: number | null;
    estado: EstadoNivel;
    origen: 'campo' | 'arrastre' | 'sin_dato';
    /** Instante (ms) de la última medición de campo; null = S/D. */
    medicionMs: number | null;
    edadMin: number | null;
    vigente: boolean;
    /** Gasto de la última medición de campo (puede ser viejo); null en referencias o sin dato. */
    gastoM3s: number | null;
}

export interface ExtremoCanalKpi {
    /** Gasto solo si la medición es vigente (≤ 240 min). */
    gasto: number | null;
    vigente: boolean;
    medicionMs: number | null;
    /** Último aforo conocido (aunque sea viejo) para rotularlo como "último aforo", nunca como gasto actual. */
    ultimoAforoM3s: number | null;
    ultimoAforoMs: number | null;
}

export interface CanalKpiModelo {
    vaciado: boolean;
    escalas: EscalaCanalKpi[];
    conMedicion: number;
    total: number;
    ultimaMedicionMs: number | null;
    /** null cuando no aplica (vaciado) o no hay mediciones vigentes. */
    fueraDeRango: number | null;
    k0: ExtremoCanalKpi;
    k104: ExtremoCanalKpi;
    conduccion: ConduccionTramo;
}

/** Chihuahua es UTC−6 fijo (sin horario de verano desde 2022). */
export function instanteDeLectura(fecha: string | null | undefined, hora: string | null | undefined): number | null {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null;
    const t = new Date(`${fecha.slice(0, 10)}T${(hora || '00:00:00').slice(0, 8)}-06:00`).getTime();
    return Number.isFinite(t) ? t : null;
}

const num = aNumeroONull;

function extremo(e: EscalaCanalKpi | undefined, l: LecturaEscala | undefined, meta: EscalaMeta | undefined): ExtremoCanalKpi {
    const vacio: ExtremoCanalKpi = { gasto: null, vigente: false, medicionMs: null, ultimoAforoM3s: null, ultimoAforoMs: null };
    if (!e || !l || !meta || e.referencia) return vacio;
    const q = gastoDeLectura(l, { pzas_radiales: num(meta.pzas_radiales), ancho: num(meta.ancho), nombre: meta.nombre, km: Number(meta.km) });
    return { gasto: e.vigente ? q : null, vigente: e.vigente, medicionMs: e.medicionMs, ultimoAforoM3s: q, ultimoAforoMs: e.medicionMs };
}

export function modeloPerfilCanal(metas: EscalaMeta[], lecturas: LecturaEscala[], ahoraMs: number, vaciado: boolean): CanalKpiModelo {
    const escalasMeta = metas
        .filter((m) => Number.isFinite(Number(m.km)) && Number(m.km) >= 0 && Number(m.km) <= 104.5)
        .sort((a, b) => Number(a.km) - Number(b.km));

    // Última medición de campo y último arrastre por escala (la más reciente por fecha + hora).
    const campo = new Map<string, { l: LecturaEscala; ms: number }>();
    const arrastre = new Map<string, { l: LecturaEscala; ms: number }>();
    for (const l of lecturas) {
        const ms = instanteDeLectura(l.fecha, l.hora_lectura);
        if (ms == null || ms > ahoraMs + 3_600_000) continue;
        const destino = l.confirmada === false ? arrastre : campo;
        const previo = destino.get(l.escala_id);
        if (!previo || ms > previo.ms) destino.set(l.escala_id, { l, ms });
    }

    const escalas: EscalaCanalKpi[] = escalasMeta.map((m) => {
        const c = campo.get(m.id);
        const a = arrastre.get(m.id);
        const km = Number(m.km);
        const referencia = esEscalaReferencia({ nombre: m.nombre, km });
        const rangoMin = num(m.nivel_min_operativo), rangoMax = num(m.nivel_max_operativo);
        const nivelCampo = c ? num(c.l.nivel_m) : null;
        const nivelArr = a ? num(a.l.nivel_m) : null;
        const medicionMs = nivelCampo != null && c ? c.ms : null;
        const vigente = medicionMs != null && esFrescaEscala(medicionMs, ahoraMs);
        const nivelEstado = nivelCampo ?? nivelArr;
        const { estado } = estadoNivel({
            nombre: m.nombre, km, nivelM: nivelEstado, minOperativo: rangoMin, maxOperativo: rangoMax,
            telemetriaMs: medicionMs, confirmada: nivelCampo != null ? true : nivelArr != null ? false : null, vaciado, ahoraMs,
        });
        const u = nivelCampo != null && rangoMin != null && rangoMax != null && rangoMax > rangoMin ? (nivelCampo - rangoMin) / (rangoMax - rangoMin) : null;
        const gasto = !referencia && c && nivelCampo != null
            ? gastoDeLectura(c.l, { pzas_radiales: num(m.pzas_radiales), ancho: num(m.ancho), nombre: m.nombre, km })
            : null;
        return {
            id: m.id, nombre: m.nombre, km, referencia, nivelM: nivelCampo, nivelArrastreM: nivelCampo == null ? nivelArr : null,
            rangoMin, rangoMax, u, estado, origen: nivelCampo != null ? 'campo' : nivelArr != null ? 'arrastre' : 'sin_dato',
            medicionMs, edadMin: minutosDesde(medicionMs, ahoraMs), vigente, gastoM3s: gasto,
        };
    });

    const vigentes = escalas.filter((e) => e.vigente);
    const mediciones = escalas.map((e) => e.medicionMs).filter((v): v is number => v != null);
    const idx0 = escalas.find((e) => Math.abs(e.km - 0) < 0.01);
    const idx104 = escalas.find((e) => Math.abs(e.km - 104) < 0.5);
    const k0 = extremo(idx0, idx0 ? campo.get(idx0.id)?.l : undefined, idx0 ? escalasMeta.find((m) => m.id === idx0.id) : undefined);
    const k104 = extremo(idx104, idx104 ? campo.get(idx104.id)?.l : undefined, idx104 ? escalasMeta.find((m) => m.id === idx104.id) : undefined);
    const fuera = vigentes.filter((e) => e.estado === 'bajo' || e.estado === 'alto').length;

    return {
        vaciado, escalas, conMedicion: vigentes.length, total: escalas.length,
        ultimaMedicionMs: mediciones.length ? Math.max(...mediciones) : null,
        fueraDeRango: vaciado || vigentes.length === 0 ? null : fuera,
        k0, k104,
        conduccion: conduccionTramo({ gasto: k0.gasto, fresca: k0.vigente }, { gasto: k104.gasto, fresca: k104.vigente }),
    };
}
