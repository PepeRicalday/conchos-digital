import L from 'leaflet';

export const presaIcon = L.divIcon({
    className: 'geo-custom-marker',
    html: `<div style="
        width:28px;height:28px;border-radius:6px;
        background:linear-gradient(135deg,#3b82f6,#1d4ed8);
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 12px #3b82f6aa;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
    ">💧</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
});

export const aforoIcon = L.divIcon({
    className: 'geo-custom-marker',
    html: `<div style="
        width:22px;height:22px;border-radius:50%;
        background:linear-gradient(135deg,#f59e0b,#d97706);
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 12px #f59e0baa;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;
    ">🌊</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
});

// Tipos
export interface EscalaData {
    id: string; nombre: string; km: number;
    latitud: number; longitud: number;
    nivel_min_operativo: number; nivel_max_operativo: number;
    capacidad_max: number; seccion_id: string;
    ancho: number; alto: number; pzas_radiales: number;
    nivel_actual?: number; delta_12h?: number; estado?: string;
    apertura_radiales_m?: number | null;
    // Fuente única de gasto (mismo criterio que PublicMonitor.tsx): gasto_actual
    // viene de lecturas_escalas (curva nivel-gasto capturada en campo, o
    // calcRadialFlow con aperturas reales), NUNCA de una fórmula Cd·H^n
    // recalculada aquí con coeficientes genéricos. ultima_telemetria habilita
    // el mismo criterio de frescura (STALE_MIN) para no mostrar un número
    // viejo como si fuera dato en vivo.
    gasto_actual?: number | null;
    ultima_telemetria?: number | null;
}

export interface PresaData {
    presa_id: string; nombre: string; latitud: number; longitud: number;
    // null = sin dato (S/D). Nunca se sustituye por 0: un 0 % falso dispararía alertas de presa baja.
    almacenamiento_mm3: number | null; porcentaje_llenado: number | null;
    extraccion_total_m3s: number | null; extraccion_fuente?: 'MEDIDO' | 'SOLICITADO' | null; fecha: string;
    // Fase 1: nivel real del vaso (msnm) y metadatos de capacidad — antes
    // GeoMonitor los hardcodeaba por presa_id en vez de leerlos de la BD.
    escala_msnm: number | null;
    /** lecturas_presas.notas: procedencia del nivel (CILA / campo / estimada). */
    notas?: string | null;
    capacidad_max: number | null;
    elevacion_corona_msnm: number | null;
    curvas_capacidad: { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }[];
}

export interface AforoData {
    id: string; nombre_punto: string; latitud: number; longitud: number;
}

export interface TomaData {
    id: string;
    nombre: string;
    latitud: number;
    longitud: number;
    estado: string;
    caudal?: number;
    km?: number;
    modulo?: string;
    volumen_acumulado?: number;
}

export interface SeccionData {
    id: string; nombre: string; km_inicio: number; km_fin: number; color: string;
}

export interface OperStats {
    tomas_abiertas: number; tomas_cerradas: number; gasto_distribuido_m3s: number;
}

// Distancia en KM entre dos puntos (Haversine)
export function haversineDist(lon1: number, lat1: number, lon2: number, lat2: number) {
    const R = 6371; // Radio de la tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
