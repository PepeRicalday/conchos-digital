/**
 * registroDiaClima — extremos del día por estación (Tmáx/Tmín, ráfaga, lluvia, ETo) para el panel
 * "Registro del día" de Clima. Función pura: sin consultas, sale de las lecturas que la página ya carga.
 *
 * Reglas de veracidad:
 *  - Un valor solo cuenta si la lectura es DEL DÍA (lectura.fecha === hoy) y la estación no está SIN_SEÑAL;
 *    si no, la fila queda en S/D (null), nunca 0.
 *  - Una estación marcada "sospechosa" por la salud de la red se muestra pero NO entra a los extremos de la red.
 *  - La lectura no trae la hora del máximo/mínimo: no se inventa.
 */
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import type { EstacionSalud, EstadoRed } from './saludRed';

export interface FilaRegistroDia {
    id: string;
    nombre: string;
    rol: string;
    estado: EstadoRed;
    edadMin: number | null;
    sospechosa: boolean;
    /** true si la fila tiene datos del día utilizables. */
    conDato: boolean;
    tempC: number | null;
    tmaxC: number | null;
    tminC: number | null;
    rafagaMs: number | null;
    lluviaMm: number | null;
    etoMm: number | null;
}

export interface ExtremoRed { valor: number; estacion: string }

export interface RegistroDia {
    filas: FilaRegistroDia[];
    conDato: number;
    /** Escala común de temperatura para las barras de rango (null si nadie tiene dato). */
    escala: { min: number; max: number } | null;
    extremos: {
        tmax: ExtremoRed | null;
        tmin: ExtremoRed | null;
        rafaga: ExtremoRed | null;
        lluvia: ExtremoRed | null;
        /** Promedio de ETo de las estaciones con dato (no es un extremo). */
        etoMedia: number | null;
    };
}

const fin = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

function extremo(filas: FilaRegistroDia[], campo: 'tmaxC' | 'tminC' | 'rafagaMs' | 'lluviaMm', mayor: boolean): ExtremoRed | null {
    let r: ExtremoRed | null = null;
    for (const f of filas) {
        const v = f[campo];
        if (!f.conDato || f.sospechosa || v == null) continue;
        if (!r || (mayor ? v > r.valor : v < r.valor)) r = { valor: v, estacion: f.nombre };
    }
    return r;
}

export function construirRegistroDia(estaciones: EstacionConLectura[], salud: EstacionSalud[], hoy: string): RegistroDia {
    const porId = new Map(salud.map((s) => [s.id, s]));
    const filas: FilaRegistroDia[] = estaciones.map((e) => {
        const s = porId.get(e.id);
        const estado: EstadoRed = s?.estado ?? (e.enLinea ? 'VIGENTE' : 'SIN_SEÑAL');
        const l = e.lectura;
        const conDato = !!l && l.fecha === hoy && estado !== 'SIN_SEÑAL';
        const v = (x: number | null | undefined) => (conDato ? fin(x) : null);
        return {
            id: e.id, nombre: e.nombre, rol: e.rol, estado,
            edadMin: s?.edadMin ?? (e.edadHoras != null ? e.edadHoras * 60 : null),
            sospechosa: !!s?.sospechosa,
            conDato,
            tempC: v(l?.temp_c), tmaxC: v(l?.temp_max_c), tminC: v(l?.temp_min_c),
            rafagaMs: v(l?.viento_rafaga_ms), lluviaMm: v(l?.lluvia_dia_mm), etoMm: v(l?.eto_mm),
        };
    });
    const temps = filas.flatMap((f) => [f.tminC, f.tmaxC, f.tempC]).filter((x): x is number => x != null);
    const escala = temps.length ? { min: Math.floor(Math.min(...temps) - 1), max: Math.ceil(Math.max(...temps) + 1) } : null;
    const etos = filas.filter((f) => f.conDato && !f.sospechosa && f.etoMm != null).map((f) => f.etoMm as number);
    return {
        filas,
        conDato: filas.filter((f) => f.conDato).length,
        escala,
        extremos: {
            tmax: extremo(filas, 'tmaxC', true),
            tmin: extremo(filas, 'tminC', false),
            rafaga: extremo(filas, 'rafagaMs', true),
            lluvia: extremo(filas, 'lluviaMm', true),
            etoMedia: etos.length ? etos.reduce((a, b) => a + b, 0) / etos.length : null,
        },
    };
}

/** Posición (0-100 %) de un valor dentro de la escala común. */
export function posPct(v: number, escala: { min: number; max: number }): number {
    const span = escala.max - escala.min || 1;
    return Math.min(100, Math.max(0, ((v - escala.min) / span) * 100));
}
