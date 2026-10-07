/**
 * contornosModulos — descarga UNA sola vez public/geo/modulos.geojson por sesión (antes: el plano, la ficha y el informe
 * lo pedían cada uno por su cuenta). Si falla, no se queda cacheado el error: el siguiente intento vuelve a pedirlo.
 */
let promesa: Promise<GeoJSON.FeatureCollection | null> | null = null;

export function cargarContornosModulos(): Promise<GeoJSON.FeatureCollection | null> {
    if (!promesa) {
        promesa = fetch('/geo/modulos.geojson')
            .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.FeatureCollection>) : null))
            .catch(() => null)
            .then((fc) => { if (!fc) promesa = null; return fc; });
    }
    return promesa;
}
