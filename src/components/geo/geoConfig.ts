import type React from 'react';
import { Layers, Crosshair, Droplets, Activity, Map as MapIcon, CloudRain, ShieldCheck, TrendingUp, Gauge } from 'lucide-react';
import { MODULOS_BBOX } from '../../utils/modulosBbox';

// Removed unused createIcon function

// CARTO exige api key en sus mosaicos (sin ella pinta "API KEY REQUIRED" encima del mapa). Mismo patrón y misma clave
// pública que NdviModulosPanel y PlanoGeneralModulos; sin clave se cae al mosaico legado (con marca de agua).
const CARTO_ACCESS_TOKEN = import.meta.env.VITE_CARTO_ACCESS_TOKEN as string | undefined;

export const CARTO_TILE_URL = CARTO_ACCESS_TOKEN
    ? `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_ACCESS_TOKEN}`
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export const BASE_LAYER_LABEL: Record<'standard' | 'satellite' | 'eos' | 'sentinel', string> = {
    standard: 'Mapa Oscuro',
    satellite: 'Satélite ArcGIS',
    eos: 'EOS LandViewer',
    sentinel: 'Sentinel Hub',
};

// Tiles fallidos consecutivos (dentro de la misma carga, ver
// sentinelTileErrorCount) antes de asumir que el WMS de Sentinel Hub está
// caído y caer a satélite ArcGIS. Un mosaico real con zoom/pan pide varias
// decenas de tiles por carga, y es normal que unos pocos fallen por timeout
// de red o por caer en el borde de la escena disponible sin que la cuenta
// esté realmente caída — con el umbral en 4 eso bastaba para expulsar al
// usuario de Sentinel Hub segundos después de activarlo (reportado ago-2026:
// "aparece unos segundos y se cierra"). 14 tolera ese ruido y sigue
// detectando una cuenta vencida/instance ID inválido, que falla TODOS los
// tiles casi de inmediato.
export const SENTINEL_TILEERROR_UMBRAL = 14;

type LayerKey = 'canal' | 'escalas' | 'tomas' | 'estaciones' | 'modulos' | 'presasShape'
    | 'rioShape' | 'alertas' | 'mostrarAforosQ' | 'mostrarAperturas' | 'lotes' | 'vasosCuenca';

interface SidebarButtonConfig {
    key: LayerKey;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    iconClassName?: string;
    indicatorClass?: string;
    /** 'alertas' usa una clase de estado propia ('shield') en vez de 'active'. */
    activeClass?: string;
}

interface SidebarGroupConfig {
    id: string;
    label: string;
    buttons: SidebarButtonConfig[];
}

// Los 10 toggles de contenido, agrupados por función real (no por orden de
// aparición histórico): topología de red activa, overlays geoespaciales
// estáticos, monitoreo de clima/riesgo, e indicadores de operación puntual.
export const SIDEBAR_GROUPS: SidebarGroupConfig[] = [
    {
        id: 'red-hidraulica',
        label: 'Red hidráulica',
        buttons: [
            { key: 'canal', icon: Layers, title: 'Trazado del Canal por Secciones' },
            { key: 'escalas', icon: Crosshair, title: 'Escalas y Puntos de Aforo' },
            { key: 'tomas', icon: Droplets, title: 'Presas y Tomas Activas' },
            { key: 'rioShape', icon: Activity, title: 'Trazado del Río Conchos', iconClassName: 'geo-icon-blue', indicatorClass: 'geo-indicator-blue' },
        ],
    },
    {
        id: 'capas-geoespaciales',
        label: 'Polígonos',
        buttons: [
            { key: 'modulos', icon: MapIcon, title: 'Polígonos de Módulos de Riego', indicatorClass: 'geo-indicator-purple' },
            { key: 'presasShape', icon: Droplets, title: 'Polígonos de Vasos de Presas', indicatorClass: 'geo-indicator-blue' },
            { key: 'vasosCuenca', icon: Layers, title: 'Vasos de toda la cuenca del Conchos (huella KMZ y espejo satelital)', indicatorClass: 'geo-indicator-blue' },
            { key: 'lotes', icon: Crosshair, title: 'Lotes de Productores (catastro) — visible desde zoom 13', indicatorClass: 'geo-indicator-amber' },
        ],
    },
    {
        id: 'clima-alertas',
        label: 'Monitoreo',
        buttons: [
            { key: 'estaciones', icon: CloudRain, title: 'Estaciones climáticas (WeatherLink)' },
            { key: 'alertas', icon: ShieldCheck, title: 'Alertas y Anomalías', activeClass: 'shield' },
        ],
    },
    {
        id: 'indicadores',
        label: 'Indicadores',
        buttons: [
            { key: 'mostrarAforosQ', icon: TrendingUp, title: 'Ver Gastos de Aforos de Control', iconClassName: 'geo-icon-amber', indicatorClass: 'geo-indicator-amber' },
            { key: 'mostrarAperturas', icon: Gauge, title: 'Ver Apertura de Compuertas', iconClassName: 'geo-icon-teal', indicatorClass: 'geo-indicator-teal' },
        ],
    },
];

export const SIDEBAR_ICON_SIZE = 19;

// Zoom mínimo para cargar/mostrar la capa de lotes: a niveles más alejados
// ~5,200 polígonos no se distinguen unos de otros y solo saturan el mapa.
export const LOTES_MIN_ZOOM = 13;

// Bbox real de cada archivo lotes_modulo_N.geojson (calculado de la geometría
// convertida) — permite cargar solo los módulos que intersectan el viewport
// visible en vez de los 6 archivos (3.3 MB) de golpe al activar la capa.
// Fuente única de verdad: src/utils/modulosBbox.ts (también usada por el NDVI
// de Clima.tsx, que cobra por área consultada a Sentinel Hub).
export const LOTES_MODULO_BBOX = MODULOS_BBOX;

export interface ViewportBounds { minLon: number; minLat: number; maxLon: number; maxLat: number }

export function bboxIntersecta(a: ViewportBounds, b: { minLon: number; minLat: number; maxLon: number; maxLat: number }): boolean {
    return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}
