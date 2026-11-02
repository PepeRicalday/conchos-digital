// GENERADO por scripts/logo/generar-logo-sica.mjs — no editar a mano (npm run logo:generar).
/** Versiones del logo SICA 005: ruta pública y proporción ancho/alto del viewBox. */
export const MARCA_SICA = {
    'emblema': { ruta: '/logos/sica/sica005-emblema.svg', proporcion: 1 },
    'simbolo': { ruta: '/logos/sica/sica005-simbolo.svg', proporcion: 1 },
    'vertical': { ruta: '/logos/sica/sica005-vertical.svg', proporcion: 1.08 },
    'horizontal': { ruta: '/logos/sica/sica005-horizontal.svg', proporcion: 3.5 },
    'banda': { ruta: '/logos/sica/sica005-banda.svg', proporcion: 8.51 },
    'sello': { ruta: '/logos/sica/sica005-sello.svg', proporcion: 1 },
    'escudo': { ruta: '/logos/sica/sica005-escudo.svg', proporcion: 0.91 },
    'mono-blanco': { ruta: '/logos/sica/sica005-mono-blanco.svg', proporcion: 0.81 },
} as const;

export type VarianteMarcaSica = keyof typeof MARCA_SICA;

/** Trazos de los íconos de sección SICA 005 (retícula 24, trazo 2, mismo estilo que lucide). */
export const GLIFOS_SICA = {
    'medicion': ["M9 2h6v13H9z","M9 5h3","M9 8h2","M9 11h3","M2 18.5c1.6 0 2.4-1.4 4-1.4s2.4 1.4 4 1.4 2.4-1.4 4-1.4 2.4 1.4 4 1.4 2.4-1.4 4-1.4","M2 22c1.6 0 2.4-1.4 4-1.4s2.4 1.4 4 1.4 2.4-1.4 4-1.4 2.4 1.4 4 1.4 2.4-1.4 4-1.4"],
    'telemetria': ["M2 8.8a15 15 0 0 1 20 0","M5 12.6a10 10 0 0 1 14 0","M8.5 16.4a5 5 0 0 1 7 0","M12 20h.01"],
    'compuertas': ["M3 3h18v11H3z","M12 3v11","M3 7h18","M6.5 10.5h2M15.5 10.5h2","M2 18.5c1.6 0 2.4-1.4 4-1.4s2.4 1.4 4 1.4 2.4-1.4 4-1.4 2.4 1.4 4 1.4 2.4-1.4 4-1.4","M2 22c1.6 0 2.4-1.4 4-1.4s2.4 1.4 4 1.4 2.4-1.4 4-1.4 2.4 1.4 4 1.4 2.4-1.4 4-1.4"],
    'monitoreo': ["M4 20v-4","M9.3 20v-7","M14.7 20v-10","M20 20V4"],
    'distribucion': ["M12 2.7 6.3 9.4a7.5 7.5 0 1 0 11.4 0z","M8.6 15.4a3.6 3.6 0 0 0 4.6 3"],
    'uso-agricola': ["M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z","M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12"],
} as const;

export type ClaveIconoSica = keyof typeof GLIFOS_SICA;
