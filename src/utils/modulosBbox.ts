// ═══════════════════════════════════════════════════════════════════════════
// BBOX DE MÓDULOS DE RIEGO — SICA-005
// ---------------------------------------------------------------------------
// Bbox real de cada archivo lotes_modulo_N.geojson (calculado de la geometría
// convertida). Fuente única de verdad: originalmente vivía solo en
// GeoMonitor.tsx (carga bajo demanda de capas de lotes por viewport); se usa
// también para pedir NDVI por módulo a Sentinel Hub (Statistical API), que
// cobra por área consultada — el bbox real es más barato que un rectángulo
// que cubra todo el distrito.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModuloBbox {
    modulo: number;
    minLon: number; minLat: number; maxLon: number; maxLat: number;
}

export const MODULOS_BBOX: ModuloBbox[] = [
    { modulo: 1,  minLon: -105.323, minLat: 27.714, maxLon: -105.167, maxLat: 28.027 },
    { modulo: 2,  minLon: -105.400, minLat: 28.012, maxLon: -105.295, maxLat: 28.150 },
    { modulo: 3,  minLon: -105.410, minLat: 28.146, maxLon: -105.335, maxLat: 28.286 },
    { modulo: 4,  minLon: -105.499, minLat: 28.130, maxLon: -105.392, maxLat: 28.316 },
    { modulo: 5,  minLon: -105.619, minLat: 28.075, maxLon: -105.438, maxLat: 28.239 },
    { modulo: 12, minLon: -105.341, minLat: 27.977, maxLon: -105.215, maxLat: 28.197 },
];

export function bboxDeModulo(modulo: number): ModuloBbox | null {
    return MODULOS_BBOX.find((m) => m.modulo === modulo) ?? null;
}
