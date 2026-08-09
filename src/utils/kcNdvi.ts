// ═══════════════════════════════════════════════════════════════════════════
// Kc DINÁMICO POR NDVI — SICA-005
// ---------------------------------------------------------------------------
// Clima.tsx calculaba la lámina de riego (ETc = ETₒ × Kc) con un Kc de EJEMPLO
// fijo ("Nogal en brotación, Kc 0.85"), sin relación con el vigor vegetativo
// real de ningún módulo. sentinel-ndvi-modulo (Edge Function, ya activa desde
// 2026-08-03) calcula NDVI medio real por módulo vía Sentinel Hub Statistical
// API — esta función cierra el círculo: NDVI real → Kc estimado → ETc real.
//
// Relación NDVI→Kc: no existe una fórmula universal publicada por FAO-56 (esa
// tabla es por etapa fenológica, no por NDVI), así que se usa la aproximación
// lineal más citada en literatura de teledetección agrícola (Kc ≈ a + b·NDVI,
// acotada al rango fisiológicamente plausible de cultivos leñosos de la zona:
// 0.15 en suelo desnudo/dormancia hasta 1.05 en cobertura plena) — ES UNA
// ESTIMACIÓN, no un reemplazo de un coeficiente de cultivo calibrado en campo.
// Se muestra siempre junto al Kc tabular de referencia, nunca lo sustituye
// silenciosamente: el operador ve ambos y decide.
//
// Caché: Sentinel Hub cobra "processing units" por estadística calculada: NO
// se debe invocar en cada carga de la página. Se cachea en localStorage con
// vigencia de 24 h (el NDVI de un módulo no cambia de forma útil en menos de
// eso) y se comparte entre pestañas del navegador.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';
import { bboxDeModulo } from './modulosBbox';

const CACHE_KEY_PREFIX = 'sica_ndvi_modulo_';
const CACHE_VIGENCIA_MS = 24 * 3600_000;

export interface NdviModulo {
    modulo: number;
    ndviMedio: number;
    ndviMin: number | null;
    ndviMax: number | null;
    muestrasValidas: number | null;
    desde: string;
    hasta: string;
    /** Kc estimado por la aproximación lineal NDVI→Kc, acotado a [0.15, 1.05]. */
    kcEstimado: number;
    obtenidoEn: string;
}

interface CacheEntry { valor: NdviModulo; obtenidoEnMs: number; }

/** Kc ≈ 0.15 + 1.10·NDVI, acotado — ver nota metodológica arriba. */
function ndviAKc(ndvi: number): number {
    const kc = 0.15 + 1.10 * ndvi;
    return Math.max(0.15, Math.min(1.05, +kc.toFixed(2)));
}

function leeCache(modulo: number): NdviModulo | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY_PREFIX + modulo);
        if (!raw) return null;
        const entry = JSON.parse(raw) as CacheEntry;
        if (Date.now() - entry.obtenidoEnMs > CACHE_VIGENCIA_MS) return null;
        return entry.valor;
    } catch {
        return null;
    }
}

function escribeCache(modulo: number, valor: NdviModulo): void {
    try {
        const entry: CacheEntry = { valor, obtenidoEnMs: Date.now() };
        localStorage.setItem(CACHE_KEY_PREFIX + modulo, JSON.stringify(entry));
    } catch {
        // localStorage lleno o bloqueado (modo privado): la próxima carga
        // simplemente vuelve a pedirlo. No es un error que deba propagarse.
    }
}

/**
 * Obtiene el NDVI medio del módulo (con caché de 24 h) y su Kc estimado.
 * Devuelve null si no hay escenas Sentinel-2 recientes, la función no está
 * configurada, o el módulo no tiene bbox conocido — nunca inventa un valor.
 */
export async function obtenNdviModulo(modulo: number, diasVentana = 30): Promise<NdviModulo | null> {
    const cacheado = leeCache(modulo);
    if (cacheado) return cacheado;

    const bbox = bboxDeModulo(modulo);
    if (!bbox) return null;

    try {
        const { data, error } = await supabase.functions.invoke('sentinel-ndvi-modulo', {
            body: {
                minLon: bbox.minLon, minLat: bbox.minLat,
                maxLon: bbox.maxLon, maxLat: bbox.maxLat,
                diasVentana,
            },
        });
        if (error || !data?.ok || !data?.encontrada || typeof data.ndvi_medio !== 'number') return null;

        const valor: NdviModulo = {
            modulo,
            ndviMedio: data.ndvi_medio,
            ndviMin: data.ndvi_min ?? null,
            ndviMax: data.ndvi_max ?? null,
            muestrasValidas: data.muestras_validas ?? null,
            desde: data.desde,
            hasta: data.hasta,
            kcEstimado: ndviAKc(data.ndvi_medio),
            obtenidoEn: new Date().toISOString(),
        };
        escribeCache(modulo, valor);
        return valor;
    } catch {
        return null; // sin red, función no desplegada, o cuota agotada
    }
}
