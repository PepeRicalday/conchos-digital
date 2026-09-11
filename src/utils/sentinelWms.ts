// URL base del WMS de Sentinel Hub para el mapa base y los mini-mapas NDVI del
// navegador. Dos proveedores posibles, elegidos con VITE_SENTINEL_PROVIDER:
// - "classic" (sinergise, services.sentinel-hub.com): el de siempre. La
//   cuenta Trial gratuita expiró y no se renueva sola.
// - "cdse" (Copernicus Data Space Ecosystem, sh.dataspace.copernicus.eu):
//   plan gratuito sin vencimiento, mismo WMS/Instance ID conceptualmente.
// Sin la variable configurada, se mantiene "classic" — sin cambio de
// comportamiento hasta que haya un Instance ID de CDSE listo.
const WMS_BASE_URL: Record<'classic' | 'cdse', string> = {
    classic: 'https://services.sentinel-hub.com/ogc/wms',
    cdse: 'https://sh.dataspace.copernicus.eu/ogc/wms',
};

export function sentinelWmsUrl(instanceId: string): string {
    const provider = (import.meta.env.VITE_SENTINEL_PROVIDER || 'classic').trim().toLowerCase();
    const base = provider === 'cdse' ? WMS_BASE_URL.cdse : WMS_BASE_URL.classic;
    return `${base}/${instanceId}`;
}
