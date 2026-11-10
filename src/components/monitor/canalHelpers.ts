import { CAPACIDAD_CONDUCCION_M3S } from '../../utils/dashboardKpis';
import L from 'leaflet';
import { STALE_MIN_ESCALA } from '../../utils/geoKpis';

// Escalas de referencia: tienen nivel pero no controlan Q (sin compuerta propia).
export const ESC_SIN_CONTROL = new Set(['K-64', 'K-94+200']);

// Basemap CARTO: sin key, el tile legacy sigue sirviendo el PNG (curl
// confirma 200 OK), pero el navegador dibuja encima una marca de agua
// "API KEY REQUIRED" — CARTO retiró el uso anónimo de basemaps.cartocdn.com.
// VITE_CARTO_ACCESS_TOKEN es el "CARTO Basemaps API key" gratuito de
// carto.com/basemaps/apikey (sin cuenta CARTO) — DISTINTO del "API Access
// Token" de Maps API v3 que se genera en el dashboard de una organización:
// ese es para datos/workflows propios y no autentica este endpoint de
// basemaps aunque tenga formato similar (confirmado: no quitaba el
// watermark). Sin la env var, cae al tile legacy con marca de agua en vez
// de romper el mapa por completo.
// Ruta y parámetro exactos según docs.carto.com/faqs/carto-basemaps:
// /rastertiles/{style}/{z}/{x}/{y}.png?key=TOKEN — no /dark_all/ suelto ni
// ?accessToken=.
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;

export const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

// λ de referencia (calibración histórica v3.6b, skill_hidraulica_v37.md).
// Se usa SOLO como fallback del predictor "what-if" cuando el balance en vivo
// no es confiable (telemetría vencida) y por tanto la λ dinámica es null.
// Nunca se presenta como medición en vivo: el panel muestra "S/D" en ese caso.
export const LAMBDA_REF = 0.00703;

// Capacidad de conducción en K-0+000 (umbral de violación hidráulica): 80 m³/s,
// confirmada por Gerencia el 2026-11-01. Misma constante que el Dashboard
// (antes el Monitor usaba 70.42 y el Dashboard 80).
export const CAPACIDAD_DISENO_K0 = CAPACIDAD_CONDUCCION_M3S;

// Custom Marker for Water Front
export const waterFrontIcon = L.divIcon({
    className: 'water-front-marker',
    html: `
        <div class="pulse-waves">
            <div class="wave"></div>
            <div class="wave wave-delay-1"></div>
            <div class="wave wave-delay-2"></div>
            <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:12px; height:12px; background:#22d3ee; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px #22d3ee; z-index:10;"></div>
        </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

export interface EscalaData {
    id: string;
    nombre: string;
    km: number;
    latitud?: number;
    longitud?: number;
    nivel_actual?: number;
    estado?: 'OPERANDO' | 'LLENADO' | 'ESPERANDO';
    ultima_telemetria?: number | null;
    // Campos extendidos para ESTABILIZACIÓN
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    puertas_abiertas?: number;
    pzas_radiales?: number;
    ancho?: number;
    nivel_max_operativo?: number | null;
    capacidad_max?: number | null;
    delta_12h?: number | null;          // tendencia en 12h (m) — positivo=sube, negativo=baja
    nivel_abajo?: number | null;        // H↓ aguas abajo (m) — diferencial para Q radial
}

// ── ESTADO DE TELEMETRÍA (5 niveles) ────────────────────────────────────
export type TelemetriaEstado = 'VIVO' | 'RETRASADO' | 'ALERTA' | 'CRITICO' | 'FUERA_DE_LINEA';

export function telemetriaEstado(ultimaTelemetria?: number | null): TelemetriaEstado {
    if (!ultimaTelemetria) return 'FUERA_DE_LINEA';
    const minutos = (Date.now() - ultimaTelemetria) / 60_000;
    if (minutos <  30)   return 'VIVO';
    if (minutos < 120)   return 'RETRASADO';
    if (minutos < 480)   return 'ALERTA';
    if (minutos < 1440)  return 'CRITICO';
    return 'FUERA_DE_LINEA';
}

// Edad legible (min → "45 min" / "10.4 h"). null → "s/d".
export function fmtAge(min: number | null): string {
    if (min === null) return 's/d';
    return min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`;
}

export function telemetriaLabel(estado: TelemetriaEstado): string {
    switch (estado) {
        case 'VIVO':          return 'Vivo';
        case 'RETRASADO':     return 'Retrasado';
        case 'ALERTA':        return 'Sin señal +2h';
        case 'CRITICO':       return 'Sin señal +8h';
        case 'FUERA_DE_LINEA':return 'Fuera de línea';
    }
}

// ── UMBRALES ÚNICOS de nivel (fracción del máximo operativo) ─────────────
// Una sola fuente para mapa, tarjetas, popup, perfil y leyenda (antes 92/95/80
// según el lugar, y un "≥ 2.8 m = normal" absoluto sin relación con la escala).
export const UMBRAL_ALERTA = 0.80;

export const UMBRAL_CRITICO = 0.92;

export const UMBRAL_NORMAL = 0.50;

export const COLOR_VENCIDO = '#64748b';

/** Lectura con más de STALE_MIN_ESCALA (4 h) o sin telemetría. */
export function escalaVencida(e: { ultima_telemetria?: number | null }): boolean {
    return e.ultima_telemetria == null || (Date.now() - e.ultima_telemetria) / 60000 > STALE_MIN_ESCALA;
}

// ── COLOR DE ALERTA POR ESCALA (reutilizado en mapa y perfil) ───────────
export function escalaAlertColor(e: EscalaData, coherencia?: any): string {
    const nivel = e.nivel_actual ?? 0;
    if (e.nivel_actual == null || nivel <= 0) return '#475569'; // sin datos
    // Dato vencido: gris. Un tramo rojo/ámbar sobre una lectura de hace 10 h
    // insinuaba un riesgo EN VIVO que nadie está midiendo.
    if (escalaVencida(e)) return COLOR_VENCIDO;
    // Sin bordo operativo registrado no se inventa uno (antes 3.5 m): no hay base para clasificar el riesgo.
    if (e.nivel_max_operativo == null || e.nivel_max_operativo <= 0) return '#475569';
    const nivelMax = e.nivel_max_operativo;
    const pct = nivel / nivelMax;
    const coh = coherencia?.puntos?.find((p: any) => p.id === e.id);
    if (coh && !coh.coherente) return '#ef4444';
    if (pct >= UMBRAL_CRITICO) return '#ef4444';
    if (pct >= UMBRAL_ALERTA) return '#f59e0b';
    if (pct >= UMBRAL_NORMAL) return '#22c55e';
    return '#3FB2F3';
}

// ── PERFIL LONGITUDINAL DEL CANAL (ESTABILIZACIÓN) ──────────────────────
export interface FGVStep { km: number; y: number; q: number; remanso: string; pct_bordo: number; alerta: boolean; critico: boolean; }

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

// "29-sep 12:00" en hora del canal (America/Chihuahua)
export function formatFechaCorta(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const f = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' }).replace('.', '').replace(' ', '-');
    const h = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chihuahua' });
    return `${f} ${h}`;
}
