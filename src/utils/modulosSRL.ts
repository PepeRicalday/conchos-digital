// ── Mapeo autoritativo polígono geojson → Módulo SRL Conchos ────────────────
// El archivo public/geo/modulos.geojson tiene los NOMBRES CAMBIADOS respecto a
// los módulos operativos reales de la SRL Conchos. El mapeo correcto se confirmó
// visualmente (informe de identificación, 2026-07-18):
//
//   polígono geojson  →  Módulo SRL real
//   MOD-1 (núm 1)     →  Módulo 1   (correcto)
//   MOD-4 (núm 4)     →  Módulo 2
//   MOD-2 (núm 2)     →  Módulo 3   (est. Módulo 3 cae aquí)
//   MOD-6 (núm 6)     →  Módulo 4
//   MOD-5 (núm 5)     →  Módulo 5   (correcto, est. Módulo 5 cae aquí)
//   MOD-9 (núm 9)     →  Módulo 12
//
// Los demás polígonos del geojson (MOD-3, 7, 8, 10) son de otros módulos del
// Distrito de Riego 005 y se OMITEN en las vistas de la SRL Conchos.

/** número_modulo del geojson → nº de Módulo SRL real. */
export const GEOJSON_A_MODULO_SRL: Record<number, number> = {
    1: 1,
    4: 2,
    2: 3,
    6: 4,
    5: 5,
    9: 12,
};

/** Color de identidad por Módulo SRL real (paleta categórica estable). */
export const COLOR_MODULO_SRL: Record<number, string> = {
    1: '#3b82f6',   // azul
    2: '#10b981',   // verde
    3: '#f59e0b',   // ámbar
    4: '#8b5cf6',   // violeta
    5: '#ef4444',   // rojo
    12: '#06b6d4',  // cian
};

/** ¿El polígono del geojson (por su numero_modulo) pertenece a la SRL Conchos? */
export function esModuloSRL(numeroGeojson: number): boolean {
    return numeroGeojson in GEOJSON_A_MODULO_SRL;
}

/** Módulo SRL real correspondiente a un polígono del geojson, o null si no es de la SRL. */
export function moduloSRLde(numeroGeojson: number): { numero: number; nombre: string; color: string } | null {
    const num = GEOJSON_A_MODULO_SRL[numeroGeojson];
    if (num == null) return null;
    return { numero: num, nombre: `Módulo ${num}`, color: COLOR_MODULO_SRL[num] ?? '#64748b' };
}
