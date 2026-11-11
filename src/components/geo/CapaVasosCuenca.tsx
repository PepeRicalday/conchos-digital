import { useEffect, useMemo, useRef } from 'react';
import { GeoJSON as CapaGeoJSON, useMap } from 'react-leaflet';
import { useCuerposAgua } from '../../hooks/useCuerposAgua';
import { etiquetaMes, ultimoCierreConDato, type CuerpoAgua } from '../../utils/cuerposAgua';
import type { HuellaVaso, EscenaSatelital } from '../../hooks/useCuerposAgua';
import './CapaVasosCuenca.css';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });

const poligono = (anillos: [number, number][][], props: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: anillos },
});

/**
 * Vasos de TODA la cuenca del Conchos en GEO-MONITOR: huella máxima de cada vaso (polígono KMZ del inventario de presas, nivel de
 * diseño) en punteado y, encima, el espejo de agua observado por Sentinel-2 donde ya hay medición. Capa aparte de «Vasos de presa»
 * (la del distrito, que sigue igual). La huella NO es el nivel de hoy y el popup lo dice; sin medición satelital no se inventa un área.
 * Al activarse encuadra el mapa a la cuenca una sola vez.
 */
export default function CapaVasosCuenca() {
  const map = useMap();
  const { datos } = useCuerposAgua();
  const encuadrado = useRef(false);

  const { huellas, espejos } = useMemo(() => {
    const hu: GeoJSON.Feature[] = [], es: GeoJSON.Feature[] = [];
    if (!datos) return { huellas: null, espejos: null };
    for (const c of datos.cuerpos) {
      const h = datos.huellas.get(c.id);
      const serie = datos.escenas.get(c.idSerie) ?? [];
      const ult = serie.length ? serie[serie.length - 1] : undefined;
      const cierre = ultimoCierreConDato(datos.cierres.filter((x) => x.cuerpoId === c.id));
      const html = popup(c, h, ult, cierre ? { mes: cierre.mes, alm: cierre.almMm3, pct: cierre.pctNamo } : null);
      if (h?.anillos.length) hu.push(poligono(h.anillos, { nombre: c.etiqueta, html }));
      if (ult?.contorno.length) es.push(poligono(ult.contorno, { nombre: c.etiqueta, html }));
    }
    return { huellas: { type: 'FeatureCollection', features: hu } as GeoJSON.FeatureCollection, espejos: { type: 'FeatureCollection', features: es } as GeoJSON.FeatureCollection };
  }, [datos]);

  useEffect(() => {
    if (encuadrado.current || !huellas?.features.length) return;
    encuadrado.current = true;
    const pts = huellas.features.flatMap((f) => (f.geometry as GeoJSON.Polygon).coordinates.flat());
    if (!pts.length) return;
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [40, 40], maxZoom: 9 });
  }, [huellas, map]);

  if (!huellas) return null;
  const enCada = (f: GeoJSON.Feature, layer: L.Layer) => {
    layer.bindPopup(String(f.properties?.html ?? ''), { maxWidth: 280 });
    layer.bindTooltip(String(f.properties?.nombre ?? ''), { sticky: true });
  };
  return (
    <>
      <CapaGeoJSON key={`vh-${huellas.features.length}`} data={huellas}
        style={() => ({ className: "geo-vc-huella" })} onEachFeature={enCada} />
      {espejos && espejos.features.length > 0 && (
        <CapaGeoJSON key={`ve-${espejos.features.length}`} data={espejos}
          style={() => ({ className: "geo-vc-espejo" })} onEachFeature={enCada} />
      )}
    </>
  );
}

function popup(c: CuerpoAgua, h: HuellaVaso | undefined, e: EscenaSatelital | undefined, cierre: { mes: string; alm: number | null; pct: number | null } | null): string {
  const fila = (k: string, v: string) => `<div class="geo-vc-fila">${k}: <b>${v}</b></div>`;
  return `<div class="geo-vc-pop">
    <strong>${esc(c.etiqueta)}</strong>
    ${c.rol !== 'almacenamiento' ? `<span class="geo-vc-rol"> · ${c.rol === 'reguladora' ? 'reguladora' : 'derivadora'}</span>` : ''}
    ${fila('Huella máxima (KMZ)', h ? `${n(h.areaKm2)} km²` : 'S/D')}
    ${e?.areaKm2 != null ? fila('Espejo observado', `${n(e.areaKm2)}${e.incertidumbreKm2 != null ? ` ± ${n(e.incertidumbreKm2, 2)}` : ''} km² · ${esc(fecha(e.fecha))}`) : fila('Espejo observado', 'aún sin medición satelital')}
    ${cierre && cierre.alm != null ? fila(`Último cierre (${esc(etiquetaMes(cierre.mes, true))})`, `${n(cierre.alm)} Mm³${cierre.pct != null ? ` · ${n(cierre.pct)} %` : ''}`) : fila('Almacenamiento', 'S/D')}
    <div class="geo-vc-aviso">La huella es el nivel de diseño, no el de hoy</div>
    <a class="geo-vc-enlace" href="/presas?tab=analitica&amp;vista=cuenca">Ver cierres y balance →</a>
  </div>`;
}
