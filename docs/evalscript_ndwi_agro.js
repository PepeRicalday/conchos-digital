//VERSION=3
// NDWI de alto contraste (visual) para GEO-MONITOR — capa custom "9_NDWI_AGRO"
// en la instancia de Sentinel Hub / CDSE configurada en VITE_SENTINEL_INSTANCE_ID.
//
// Por qué existe: la capa "7_NDWI" nativa de Sentinel Hub usa la paleta de
// color por defecto del proveedor, que pinta valores bajos (tierra, cultivo
// seco — la mayor parte del área de un canal angosto rodeado de campos) en
// tonos casi negros/transparentes. El mapa se ve "vacío" aunque las tiles
// carguen correctamente (confirmado con Playwright: 12/12 tiles completas,
// naturalWidth 256px, opacity 1 — no es un fallo de carga ni de z-index).
//
// Fórmula: NDWI = (B03 - B08) / (B03 + B08), banda verde y NIR — misma
// combinación ya validada en este proyecto para el contorno NDWI de vasos de
// presa (ver supabase/functions/sentinel-ndwi-vaso-sync/index.ts).
// Umbral de agua > ~0.1-0.15 (McFeeters original usa 0), pero en canales
// angostos con mezcla de píxel agua/orilla conviene un umbral algo más bajo
// para no perder el trazo fino del canal por sub-resolución del sensor (10m).
//
// Instalación: Sentinel Hub Dashboard → Configuration Utility → la instancia
// de VITE_SENTINEL_INSTANCE_ID → Custom scripts → New custom script →
// pegar este archivo completo → guardar con el nombre de layer "9_NDWI_AGRO".
// No requiere cambios de código: GeoMonitor.tsx y NdviModulosPanel.tsx ya
// referencian capas por nombre string, solo hay que agregar "9_NDWI_AGRO" a
// las listas de capas seleccionables una vez la capa exista en el dashboard.

function setup() {
  return {
    input: ["B03", "B08", "dataMask"],
    output: { bands: 4 },
  };
}

// Rampa de color de alto contraste: tierra/vegetación en tonos oscuros
// discretos (para no competir visualmente con el agua), agua en azules
// vivos que se intensifican con el NDWI — igual criterio de "alto contraste
// por bandas" que ya usa 9_NDVI_AGRO para vigor vegetal.
const RAMPA = [
  [-1.0, [0.05, 0.05, 0.05]],   // sombra / sin dato útil
  [-0.3, [0.12, 0.10, 0.08]],   // suelo desnudo
  [-0.05, [0.15, 0.20, 0.10]],  // vegetación / cultivo
  [0.05, [0.25, 0.55, 0.85]],   // borde húmedo / mezcla agua-orilla
  [0.30, [0.05, 0.35, 0.95]],   // agua
  [1.0, [0.00, 0.10, 0.60]],    // agua profunda / máxima señal NDWI
];

function interpolar(ndwi) {
  for (let i = 0; i < RAMPA.length - 1; i++) {
    const [v0, c0] = RAMPA[i];
    const [v1, c1] = RAMPA[i + 1];
    if (ndwi >= v0 && ndwi <= v1) {
      const t = (ndwi - v0) / (v1 - v0);
      return [
        c0[0] + t * (c1[0] - c0[0]),
        c0[1] + t * (c1[1] - c0[1]),
        c0[2] + t * (c1[2] - c0[2]),
      ];
    }
  }
  return RAMPA[RAMPA.length - 1][1];
}

function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  const ndwi = (s.B03 - s.B08) / (s.B03 + s.B08 + 0.0001);
  const [r, g, b] = interpolar(Math.max(-1, Math.min(1, ndwi)));
  return [r, g, b, s.dataMask];
}
