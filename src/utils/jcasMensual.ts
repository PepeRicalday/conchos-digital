// ═══════════════════════════════════════════════════════════════════════════
// Resumen MES A MES de la cuenca del Conchos con los totales mensuales de JCAS (jcas_lecturas_mensuales) — modelo puro
// ---------------------------------------------------------------------------
// Es la única historia de varios meses que existe (el diario guardado es corto). Mismas reglas que lo diario: S/D = null (nunca 0), una estación por
// ciudad (mediana), sin pluviómetro o excluida (Parral) no cuenta a la lluvia, promedio areal por IDW con mínimo de estaciones y de cobertura.
// Contexto provisional de fuente TERCERA: sin «normal», anomalía ni percentiles (la serie es de un solo año).
// ═══════════════════════════════════════════════════════════════════════════
import { colapsarGrupos, lluviaAreal, PLUVIOMETROS_EXCLUIDOS, type LluviaAreal, type PuntoLluvia } from './jcasCuenca';
import type { PoligonoGeo } from './geoCuenca';

export interface FilaMensualJcas { estacion_id: number; mes: string; lluvia_mm: number | null; temp_c: number | null; hum_pct: number | null; viento_kmh: number | null }
/** Lo mínimo que se necesita de cada estación (sale de ModeloRedJcas.puntos). */
export interface EstacionMensual { id: number; nombre: string; lat: number; lon: number; grupo: string | null; sinPluviometro: boolean }

export interface MesCuenca {
    /** 'YYYY-MM'. */
    mes: string;
    etiqueta: string;
    /** Lluvia areal del mes (mm); `mm` null = S/D con `motivoSD`. */
    lluvia: LluviaAreal;
    temp: number | null; hum: number | null; viento: number | null;
    /** Estaciones (una por ciudad) con dato de temperatura ese mes. */
    nTemp: number;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const etiquetaMes = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`;

const redondea = (x: number) => Math.round(x * 10) / 10;

/** Promedio entre ciudades (cada grupo pesa una vez) de un campo mensual; null si hay menos de 3 con dato. */
function mediaEntreCiudades(est: EstacionMensual[], porId: Map<number, number | null>): { v: number | null; n: number } {
    const pts = colapsarGrupos(est.map((e): PuntoLluvia & { grupo: string | null } => ({ id: String(e.id), fuente: 'jcas', nombre: e.nombre, lat: e.lat, lon: e.lon, mm: porId.get(e.id) ?? null, grupo: e.grupo })))
        .filter((p) => p.mm != null);
    if (pts.length < 3) return { v: null, n: pts.length };
    return { v: redondea(pts.reduce((a, p) => a + (p.mm as number), 0) / pts.length), n: pts.length };
}

/** Un registro por mes presente en `filas`, de más antiguo a más reciente. */
export function construirMensual(est: EstacionMensual[], filas: FilaMensualJcas[], poligonos: PoligonoGeo[]): MesCuenca[] {
    const meses = [...new Set(filas.map((f) => f.mes.slice(0, 7)))].sort();
    return meses.map((mes) => {
        const delMes = new Map<number, FilaMensualJcas>();
        for (const f of filas) if (f.mes.slice(0, 7) === mes) delMes.set(f.estacion_id, f);
        const pts = colapsarGrupos(est.map((e): PuntoLluvia & { grupo: string | null } => ({
            id: String(e.id), fuente: 'jcas', nombre: e.nombre, lat: e.lat, lon: e.lon, grupo: e.grupo,
            mm: e.sinPluviometro || PLUVIOMETROS_EXCLUIDOS[e.id] != null ? null : (delMes.get(e.id)?.lluvia_mm ?? null),
        })));
        const lluvia = lluviaAreal(poligonos, pts, 30);
        const campo = (k: 'temp_c' | 'hum_pct' | 'viento_kmh') => mediaEntreCiudades(est, new Map(est.map((e) => [e.id, delMes.get(e.id)?.[k] ?? null])));
        const t = campo('temp_c'), h = campo('hum_pct'), v = campo('viento_kmh');
        return { mes, etiqueta: etiquetaMes(mes), lluvia, temp: t.v, hum: h.v, viento: v.v, nTemp: t.n };
    });
}
