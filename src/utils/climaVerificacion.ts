// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DEL MÓDULO CLIMA — skill del pronóstico + calibración de sensores
// ---------------------------------------------------------------------------
// Envuelve las RPC fn_clima_skill_resumen y fn_clima_calibracion_resumen
// (migraciones 20260808100000 / 20260808110000) para que los informes
// exportables (exportClimaReport.ts, exportClimaInfografia.ts) puedan citar
// qué tan bien acertó Open-Meteo y qué tan calibradas están las estaciones,
// sin que cada generador repita la consulta ni el manejo de "sin datos".
//
// Mismo espíritu que climatologia.ts: nunca falla el informe si el RPC no
// existe todavía (migración no aplicada) o no hay suficientes muestras —
// devuelve el resultado "sin datos" y quien lo consume decide si oculta la
// sección o la muestra con la salvedad correspondiente.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase';

export interface SkillPronosticoResumen {
    disponible: boolean;
    totalMuestras: number;
    /** MAE de nubosidad promediado entre estaciones/horizontes, para un solo número citable. */
    maeNubosidadPct: number | null;
    sesgoNubosidadPct: number | null;
    diasVentana: number;
}

const SKILL_MIN_MUESTRAS = 5;

/** Verificación de skill del pronóstico (fn_clima_skill_resumen), agregada a
 *  un solo número para citar en el informe — el detalle por estación/horizonte
 *  vive en el panel en vivo de Clima.tsx, no en el documento exportado. */
export async function skillPronosticoResumen(diasVentana = 7): Promise<SkillPronosticoResumen> {
    const vacio: SkillPronosticoResumen = {
        disponible: false, totalMuestras: 0, maeNubosidadPct: null, sesgoNubosidadPct: null, diasVentana,
    };
    try {
        const { data, error } = await supabase.rpc('fn_clima_skill_resumen', { p_dias: diasVentana });
        if (error || !data?.length) return vacio;

        const filas = data as { n_muestras: number; mae_nubosidad_pct: number | null; sesgo_nubosidad_pct: number | null }[];
        const totalMuestras = filas.reduce((a, f) => a + (f.n_muestras ?? 0), 0);
        if (totalMuestras < SKILL_MIN_MUESTRAS) return { ...vacio, totalMuestras };

        // Promedio ponderado por número de muestras de cada bucket estación×horizonte.
        const ponderado = (sel: (f: typeof filas[number]) => number | null) => {
            let sumaPond = 0, pesoTotal = 0;
            for (const f of filas) {
                const v = sel(f);
                if (v == null) continue;
                sumaPond += v * f.n_muestras;
                pesoTotal += f.n_muestras;
            }
            return pesoTotal ? sumaPond / pesoTotal : null;
        };

        return {
            disponible: true,
            totalMuestras,
            maeNubosidadPct: ponderado((f) => f.mae_nubosidad_pct),
            sesgoNubosidadPct: ponderado((f) => f.sesgo_nubosidad_pct),
            diasVentana,
        };
    } catch {
        return vacio;
    }
}

export interface CalibracionResumenEstacion {
    estacionNombre: string;
    nDias: number;
    errorRadMedioPct: number | null;
    alerta: boolean;
}

export interface CalibracionResumenGlobal {
    disponible: boolean;
    porEstacion: CalibracionResumenEstacion[];
    /** Cuántas estaciones tienen sesgo de radiación >15% vs. NASA POWER. */
    nAlertas: number;
    diasVentana: number;
}

/** Calibración cruzada de sensores (fn_clima_calibracion_resumen): radiación
 *  observada vs. NASA POWER por estación, para señalar sensores que necesitan
 *  revisión de campo. */
export async function calibracionResumen(diasVentana = 30): Promise<CalibracionResumenGlobal> {
    const vacio: CalibracionResumenGlobal = { disponible: false, porEstacion: [], nAlertas: 0, diasVentana };
    try {
        const { data, error } = await supabase.rpc('fn_clima_calibracion_resumen', { p_dias: diasVentana });
        if (error || !data?.length) return vacio;

        const filas = data as {
            estacion_nombre: string; n_dias: number;
            error_rad_medio_pct: number | null; alerta: boolean;
        }[];
        const porEstacion = filas.map((f) => ({
            estacionNombre: f.estacion_nombre,
            nDias: f.n_dias,
            errorRadMedioPct: f.error_rad_medio_pct,
            alerta: f.alerta,
        }));

        return {
            disponible: true,
            porEstacion,
            nAlertas: porEstacion.filter((e) => e.alerta).length,
            diasVentana,
        };
    } catch {
        return vacio;
    }
}
