/**
 * VasoVisor3D.tsx — Manejo de Vaso: visor 3D del cuerpo de agua + terreno
 *
 * TERRENO (TerrenoMesh): relieve real medido — Copernicus DEM GLO-30
 * (dem-boquilla-sync → dem_terreno_presa), sobre el bbox del vaso completo.
 * La grilla nativa se subdivide x2 por interpolación bilineal (suaviza sin
 * inventar elevación) y se le suma ruido de baja amplitud (±4m, textura de
 * superficie, no topografía) para romper el aspecto "liso". El color por
 * vértice combina banda hipsométrica + pendiente local + hillshade analítico
 * (ángulo normal·luz cenital), y donde el polígono NDWI real dice que hay
 * agua, el terreno se fuerza por debajo de la lámina — evita que el DEM (a
 * ~300m/celda tras downsample) "asome" sobre el agua en los brazos angostos
 * de un embalse dendrítico y fragmente el polígono visualmente.
 *
 * AGUA (VasoMesh): lámina PLANA a la elevación real del día (nivelMsnm) —
 * sin geometría de fondo hundido. Una versión anterior usaba un perfil
 * cónico centrado en el centroide para dar sensación de volumen, pero en un
 * vaso tan alargado como La Boquilla (~30km) los brazos lejos del centro
 * recibían profundidad casi nula y quedaban al ras del terreno, causando la
 * misma fragmentación visual. Plana es menos "bonita" pero estable en TODA
 * la forma del polígono.
 *
 * Ambas mallas comparten el MISMO origen local: nivelMsnm como elevación de
 * referencia (Y=0), no el promedio del terreno — con sierra real hasta
 * ~1800 msnm junto al agua a ~1300 msnm, promediar todo el DEM desplazaba el
 * origen muy por encima del nivel real del agua.
 *
 * POST-PROCESADO: SSAO + tone mapping ACES + viñeta (@react-three/postprocessing)
 * dan contraste e impacto visual sin tocar los datos — es puramente
 * presentación, igual que el hillshade y el ruido de superficie.
 *
 * LO QUE ESTO NO ES: el fondo del vaso no es topografía medida (sin DEM
 * batimétrico real disponible) — se declara así en la UI (badge). La
 * cortina de la presa NO se modela aquí — requiere datos dimensionales
 * reales (planos oficiales) o fotogrametría real (56 fotos de dron
 * geolocalizadas ya disponibles en Presa Boquilla/Imagenes, procesamiento
 * pendiente vía Meshroom).
 */
import React, { useMemo, useEffect, useState, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { Maximize, Minimize } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface CurvaPunto { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

interface DemTerreno {
    bbox: [number, number, number, number]; // [west, south, east, north]
    ncols: number; nrows: number;
    grid: (number | null)[][];
}

interface TexturaSatelital {
    bbox: [number, number, number, number]; // [west, south, east, north] — mismo bbox que DemTerreno
    urlPublica: string;
    fechaEscena: string | null;
}

interface VasoVisor3DProps {
    contornoGeojson: { type: 'Polygon'; coordinates: [number, number][][] } | null;
    curva?: CurvaPunto[];
    nivelMsnm: number | null;
    nombrePresa: string;
    fechaEscena: string;
    presaId: string;
}

/** Proyección equirrectangular local (lon,lat) → (x,z) en metros, con
 *  corrección de aspecto por cos(latCentral) — mismo criterio que
 *  anilloASvgPath en PresaVasoMonitor.tsx, aquí en metros reales en vez de
 *  píxeles de pantalla, porque la escena 3D necesita unidades consistentes
 *  para que la profundidad (eje Y) tenga la escala correcta relativa al
 *  ancho/largo real del vaso. */
function proyectaAMetros(lon: number, lat: number, centro: { lon: number; lat: number; cosLat: number }) {
    const METROS_POR_GRADO_LAT = 111320;
    const x = (lon - centro.lon) * centro.cosLat * METROS_POR_GRADO_LAT;
    const z = (lat - centro.lat) * METROS_POR_GRADO_LAT;
    return [x, z] as const;
}

// Exageración vertical compartida entre terreno (DEM real) y la lámina de
// agua — deben usar el MISMO factor o el agua quedaría visualmente
// desalineada del relieve que la rodea. Es una convención de visualización
// (igual que un mapa de relieve sombreado exagera el eje Z para que se lea a
// simple vista), no altera ninguna elevación real almacenada — solo el
// desplazamiento Y de los vértices en pantalla. Subido de 1.6 a 2.2 tras
// ampliar el bbox del DEM al vaso completo (~55km): a esa escala horizontal
// tan grande, el relieve real (~580m de rango) se percibía casi plano con el
// factor anterior, pensado para el bbox acotado de ~3km de la Fase 2 inicial.
const EXAGERACION_VERTICAL = 2.2;

/** Lee dem_terreno_presa y devuelve la grilla + su bbox — cargado una sola
 *  vez por presa (el terreno no cambia mes a mes como el polígono NDWI, no
 *  hace falta refetch al cambiar de fecha_escena). */
function useDemTerreno(presaId: string) {
    const [dem, setDem] = useState<DemTerreno | null>(null);
    const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin_datos'>('cargando');
    useEffect(() => {
        let cancelado = false;
        setEstado('cargando');
        supabase
            .from('dem_terreno_presa')
            .select('bbox, ncols, nrows, grid_elevaciones_msnm')
            .eq('presa_id', presaId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (cancelado) return;
                if (error || !data) { setDem(null); setEstado('sin_datos'); return; }
                setDem({
                    bbox: data.bbox as [number, number, number, number],
                    ncols: data.ncols, nrows: data.nrows,
                    grid: data.grid_elevaciones_msnm as (number | null)[][],
                });
                setEstado('listo');
            });
        return () => { cancelado = true; };
    }, [presaId]);
    return { dem, estado };
}

/** Lee textura_satelital_terreno (Sentinel-2 TRUE_COLOR, sentinel-truecolor-
 *  terreno-sync) — igual que el DEM, cargada una vez por presa, no por mes. */
function useTexturaSatelital(presaId: string) {
    const [textura, setTextura] = useState<TexturaSatelital | null>(null);
    useEffect(() => {
        let cancelado = false;
        supabase
            .from('textura_satelital_terreno')
            .select('bbox, url_publica, fecha_escena')
            .eq('presa_id', presaId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (cancelado) return;
                if (error || !data) { setTextura(null); return; }
                setTextura({
                    bbox: data.bbox as [number, number, number, number],
                    urlPublica: data.url_publica, fechaEscena: data.fecha_escena,
                });
            });
        return () => { cancelado = true; };
    }, [presaId]);
    return textura;
}

/** Bbox [minLon, minLat, maxLon, maxLat] del anillo exterior — usado como
 *  descarte rápido antes del ray casting completo (ver dentroDelPoligonoGeo):
 *  el terreno tiene ~137k vértices tras la subdivisión x2, y la gran mayoría
 *  caen fuera del polígono de agua (mucho más terreno que vaso en un bbox de
 *  55km) — sin este filtro, cada uno de esos vértices recorría TODAS las
 *  aristas del polígono NDWI (que puede tener cientos/miles de puntos) solo
 *  para descubrir que está lejos. Era el costo dominante de la carga inicial. */
function bboxDePoligono(coordinates: [number, number][][]): [number, number, number, number] {
    const exterior = coordinates[0] ?? [];
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of exterior) {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    return [minLon, minLat, maxLon, maxLat];
}

/** Point-in-polygon por ray casting con soporte de islas (evenodd) — mismo
 *  principio que el visor de azolve en PresaVasoMonitor.tsx, aquí en
 *  coordenadas lon/lat directas (no proyectadas a píxeles de pantalla).
 *  `bbox` opcional: descarte O(1) antes del recorrido completo de aristas. */
function dentroDelPoligonoGeo(
    coordinates: [number, number][][], lon: number, lat: number,
    bbox?: [number, number, number, number],
): boolean {
    if (bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3])) return false;
    let dentro = false;
    for (const anillo of coordinates) {
        for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
            const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
            const cruza = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (cruza) dentro = !dentro;
        }
    }
    return dentro;
}

/** Malla de terreno a partir de la grilla de elevaciones del DEM — PlaneGeometry
 *  con tantos segmentos como celdas trae la grilla, desplazando cada vértice
 *  en Y según su elevación real (msnm, convertida a metros relativos al
 *  mismo origen local que usa el vaso). Celdas sin dato (null, NODATA del
 *  raster original) se interpolan del vecino más cercano válido — dejar un
 *  hueco real en la malla produciría un agujero visual sin sentido físico
 *  para una franja de terreno pequeña de por sí (bbox de ~3km). */
/** Ruido de valor simple (hash + interpolación suave) en 2 octavas — variación
 *  de superficie tipo roca/tierra sin inventar geografía: no desplaza ningún
 *  vértice ni cambia elevación real, solo modula el color base para romper el
 *  aspecto "plano/plástico" de un degradado puro por altura. Determinista
 *  (mismo x,z siempre da el mismo valor) para que no parpadee entre renders. */
function ruido2D(x: number, z: number): number {
    const hash = (n: number) => { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); };
    const octava = (freq: number) => {
        const xi = Math.floor(x * freq), zi = Math.floor(z * freq);
        const xf = x * freq - xi, zf = z * freq - zi;
        const suaviza = (t: number) => t * t * (3 - 2 * t);
        const a = hash(xi * 12.9898 + zi * 78.233);
        const b = hash((xi + 1) * 12.9898 + zi * 78.233);
        const c = hash(xi * 12.9898 + (zi + 1) * 78.233);
        const d = hash((xi + 1) * 12.9898 + (zi + 1) * 78.233);
        const sx = suaviza(xf), sz = suaviza(zf);
        return a + (b - a) * sx + (c - a) * sz * (1 - sx) + (d - b) * sx * sz;
    };
    return octava(0.008) * 0.65 + octava(0.03) * 0.35; // octava gruesa (manchas grandes) + fina (grano)
}

function TerrenoMesh({ dem, centro, elevacionReferencia, contornoAgua, texturaUrl, onEstadoTextura }: {
    dem: DemTerreno;
    centro: { lon: number; lat: number; cosLat: number };
    elevacionReferencia: number;
    contornoAgua: VasoVisor3DProps['contornoGeojson'];
    /** URL pública de textura_satelital_terreno (Sentinel-2 TRUE_COLOR),
     *  MISMO bbox que dem. undefined mientras carga; null si no hay textura
     *  sincronizada todavía — en ambos casos se usa el color hipsométrico
     *  calculado como respaldo, nunca se deja el terreno sin pintar. */
    texturaUrl: string | null | undefined;
    /** Reporta el estado REAL de la carga de textura al padre, para que el
     *  badge del overlay no diga "IMAGEN SATELITAL" solo porque el REGISTRO
     *  de metadatos existe (textura_satelital_terreno) mientras la imagen en
     *  sí (11+ MB) sigue descargando o falló — desalineación reportada como
     *  "el badge dice satelital pero se ve el color plano del DEM". */
    onEstadoTextura?: (estado: 'sin_url' | 'cargando' | 'lista' | 'error') => void;
}) {
    const geometria = useMemo(() => {
        const { bbox, ncols, nrows, grid } = dem;
        const [west, south, east, north] = bbox;

        // Rellena NODATA con el promedio de la grilla completa — simple y
        // suficiente para una franja de 3km donde NODATA es la excepción
        // (agua/sombra puntual), no la regla.
        const validos = grid.flat().filter((v): v is number => v != null);
        const promedio = validos.length ? validos.reduce((s, v) => s + v, 0) / validos.length : elevacionReferencia;
        const grillaLimpia = grid.map(fila => fila.map(v => v ?? promedio));

        // Subdivisión bajada de x2 a x1 (grilla nativa del DEM, sin
        // interpolar puntos intermedios): con GPU integrada de memoria
        // compartida limitada, ~137k vértices del terreno + la malla de la
        // cortina (99k) + sus texturas agotaban la VRAM disponible y
        // provocaban pérdida de contexto WebGL (Canvas congelado en blanco
        // sin aviso). x1 usa los ~189x183 = 34,587 vértices reales del DEM
        // tal cual — 4x menos que antes. La textura satelital real ya cubre
        // el detalle visual que antes aportaba la subdivisión; el relieve
        // geométrico en sí se ve un poco más poligonal de cerca, pero es
        // aceptable frente al riesgo de que la escena no cargue en absoluto.
        const SUBDIV = 1;
        const ncolsF = (ncols - 1) * SUBDIV + 1;
        const nrowsF = (nrows - 1) * SUBDIV + 1;
        const muestraElev = (filaF: number, colF: number): number => {
            const fFila = filaF / SUBDIV, fCol = colF / SUBDIV;
            const f0 = Math.floor(fFila), c0 = Math.floor(fCol);
            const f1 = Math.min(f0 + 1, nrows - 1), c1 = Math.min(c0 + 1, ncols - 1);
            const tf = fFila - f0, tc = fCol - c0;
            const v00 = grillaLimpia[f0][c0], v01 = grillaLimpia[f0][c1];
            const v10 = grillaLimpia[f1][c0], v11 = grillaLimpia[f1][c1];
            return v00 * (1 - tf) * (1 - tc) + v01 * (1 - tf) * tc + v10 * tf * (1 - tc) + v11 * tf * tc;
        };

        const elevMin = Math.min(...grillaLimpia.flat());
        const elevMax = Math.max(...grillaLimpia.flat());
        const rangoElev = Math.max(1, elevMax - elevMin);

        // Profundidad de "corte" bajo el nivel del agua para las celdas de
        // terreno que caen dentro del polígono NDWI — subida de 10m a 120m:
        // con solo 10m (×2.2 de EXAGERACION_VERTICAL ≈ 22m en pantalla)
        // sobre una escena de ~55km de ancho, el terreno y la lámina de agua
        // quedaban demasiado cerca en profundidad de buffer — WebGL no podía
        // decidir con precisión cuál dibujar "al frente" en ciertos ángulos
        // de cámara, y la textura satelital real del terreno (verde/tierra
        // en esas celdas, solo se bajó su altura, no se cambió su color)
        // se "colaba" a través del agua semitransparente como vetas verdes
        // parpadeantes (z-fighting, reportado al mover la cámara). El valor
        // en sí sigue siendo arbitrario — lo único que importa es que quede
        // claramente por debajo del agua, con margen suficiente.
        const CORTE_BAJO_AGUA_M = 120;

        const geo = new THREE.PlaneGeometry(1, 1, ncolsF - 1, nrowsF - 1);
        const pos = geo.attributes.position;

        // Las UV por defecto de PlaneGeometry YA coinciden con la
        // orientación de la grilla sin necesitar flip: su primer vértice
        // (índice 0 = mi fila=0 = borde NORTE) cae en Y=+0.5 (arriba del
        // plano local antes de rotar) con uv.v=1.0 — que es exactamente
        // "arriba de la imagen" en la convención estándar de texturas
        // (v=1 arriba, v=0 abajo), la misma orientación que trae
        // textura_satelital_terreno (fila 0 del PNG = norte = arriba). Un
        // flip aquí (versión anterior) invertía norte-sur y desalineaba la
        // textura respecto al polígono de agua real, que se proyecta con
        // el mismo criterio lon/lat→XZ sin ningún flip.

        const coordsAgua = contornoAgua?.coordinates;
        const bboxAgua = coordsAgua ? bboxDePoligono(coordsAgua) : undefined;
        // Elevación (sin exagerar/recortar) por vértice de la malla fina,
        // guardada aparte porque el bucle de color de abajo la necesita ya
        // resuelta (muestraElev + ruido) para no recalcular dos veces.
        const elevPorVertice = new Float32Array(ncolsF * nrowsF);
        for (let fila = 0; fila < nrowsF; fila++) {
            for (let col = 0; col < ncolsF; col++) {
                const lon = west + (col / (ncolsF - 1)) * (east - west);
                // Fila 0 del grid = borde NORTE (ver comentario de la migración
                // dem_terreno_presa) — PlaneGeometry construye sus vértices de
                // -Y a +Y (fila 0 = abajo en plano local), por eso se invierte
                // el recorrido de fila al mapear a latitud.
                const lat = north - (fila / (nrowsF - 1)) * (north - south);
                const [x, z] = proyectaAMetros(lon, lat, centro);
                const idx = fila * ncolsF + col;
                pos.setXY(idx, x, z);

                // Detalle de superficie: ruido determinista de baja amplitud
                // (±4m) sobre la elevación interpolada — rompe el aspecto
                // "liso de plástico" de la interpolación bilineal pura, sin
                // inventar relieve geológico real (la amplitud es pequeña
                // frente al rango total de 580m, es textura, no topografía).
                const elevBase = muestraElev(fila, col);
                const elevConRuido = elevBase + ruido2D(x, z) * 4;
                elevPorVertice[idx] = elevConRuido;

                // Recorte terreno-vs-agua: donde el polígono NDWI (medición
                // satelital reciente, más confiable para "dónde hay agua HOY"
                // que un DEM de radar de otra fecha) dice que hay agua, el
                // terreno se fuerza por debajo de la lámina — sin esto, el
                // DEM podía "asomar" por encima del agua en los brazos
                // angostos del embalse dendrítico, fragmentando el polígono
                // visualmente donde en realidad el agua es continua.
                const esAgua = coordsAgua ? dentroDelPoligonoGeo(coordsAgua, lon, lat, bboxAgua) : false;
                const elevacionVertice = esAgua ? elevacionReferencia - CORTE_BAJO_AGUA_M : elevConRuido;
                pos.setZ(idx, (elevacionVertice - elevacionReferencia) * EXAGERACION_VERTICAL);
            }
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        // Color por vértice: elevación (5 bandas hipsométricas) + pendiente
        // local (taludes/cañadas empujan hacia roca expuesta) + un tercer
        // factor nuevo, ILUMINACIÓN ANALÍTICA (hillshade): el mismo cálculo
        // que usan los mapas topográficos profesionales — ángulo entre la
        // normal de cada vértice y una luz cenital fija, independiente de
        // las luces de la escena — para que las crestas/cañadas se LEAN por
        // contraste de sombra, no solo por color. Sin esto el relieve se
        // percibía "plano" en zonas de elevación uniforme aunque tuvieran
        // pendiente real. + variación de ruido para textura de superficie.
        const normales = geo.attributes.normal;
        // Componente dominante en Z (no Y): en este punto del cálculo la
        // elevación todavía vive en el eje Z (pos.setZ más arriba, línea
        // ~331) — el rotateX(-Math.PI/2) que lleva Z→Y ocurre recién al
        // final de esta función (ver más abajo). Un vector con 0.85 en Y
        // (como tenía antes) apunta "de canto" al terreno en vez de
        // cenital, y el dot con la normal (mayormente +Z en superficie
        // plana) sale sistemáticamente bajo — todo el relieve se ve como
        // silueta oscura en vez de tener contraste de luz/sombra real
        // (reportado: "la imagen de la cortina está al revés").
        const luzCenital = new THREE.Vector3(0.4, 0.35, 0.85).normalize();
        const colores = new Float32Array(pos.count * 3);
        // Segundo atributo, SOLO hillshade en gris (sin ningún tinte de
        // color hipsométrico) — el atributo 'color' de arriba tiñe todo de
        // verde/tierra/roca, útil cuando NO hay textura satelital; pero
        // multiplicar la textura REAL contra ese tinte completo la
        // "lavaba" hacia un verde/blanco plano y se perdía casi todo su
        // detalle (causa del reporte: el terreno con textura se veía igual
        // de plano que sin ella). El shader usa 'hillshade' cuando hay
        // textura, y 'color' cuando no.
        const hillshadeAttr = new Float32Array(pos.count * 3);
        const colorBajo = new THREE.Color('#4f6234');    // verde oliva oscuro — vegetación de valle/ladera baja
        const colorMedioB = new THREE.Color('#7c8354');  // verde-tierra — ladera media
        const colorMedioA = new THREE.Color('#a08f68');  // tierra/roca expuesta
        const colorAlto = new THREE.Color('#d8cdb8');    // roca clara de cresta
        const colorCumbre = new THREE.Color('#efe9dd');  // casi blanco — puntos más altos del relieve
        const tmp = new THREE.Color();
        const normalVertice = new THREE.Vector3();
        for (let fila = 0; fila < nrowsF; fila++) {
            for (let col = 0; col < ncolsF; col++) {
                const idx = fila * ncolsF + col;
                const elevNorm = Math.max(0, Math.min(1, (elevPorVertice[idx] - elevMin) / rangoElev));

                // Pendiente local aproximada sobre la malla fina (vecino a
                // 1 celda, ya subdividida) — más pendiente empuja el tono
                // hacia roca expuesta aunque la elevación sea media, como
                // ocurre en cañadas y taludes empinados reales.
                const vecinoCol = elevPorVertice[fila * ncolsF + Math.min(col + 1, ncolsF - 1)];
                const vecinoFila = elevPorVertice[Math.min(fila + 1, nrowsF - 1) * ncolsF + col];
                const pendiente = (Math.abs(elevPorVertice[idx] - vecinoCol) + Math.abs(elevPorVertice[idx] - vecinoFila)) / 2;
                const pendienteNorm = Math.min(1, pendiente / 4); // paso de celda más chico tras subdividir → umbral más sensible

                // Interpolación por tramos sobre 5 bandas hipsométricas.
                if (elevNorm < 0.35) tmp.copy(colorBajo).lerp(colorMedioB, elevNorm / 0.35);
                else if (elevNorm < 0.65) tmp.copy(colorMedioB).lerp(colorMedioA, (elevNorm - 0.35) / 0.30);
                else if (elevNorm < 0.88) tmp.copy(colorMedioA).lerp(colorAlto, (elevNorm - 0.65) / 0.23);
                else tmp.copy(colorAlto).lerp(colorCumbre, (elevNorm - 0.88) / 0.12);
                tmp.lerp(colorAlto, pendienteNorm * 0.5); // pendiente fuerte aclara hacia roca

                // Hillshade: producto punto normal·luz remapeado a un rango
                // que oscurece caras "de espaldas" a la luz cenital sin
                // llevarlas a negro puro (0.55) y realza levemente las de
                // frente (hasta 1.15).
                normalVertice.set(normales.getX(idx), normales.getY(idx), normales.getZ(idx));
                const dot = Math.max(0, normalVertice.dot(luzCenital));
                const sombra = 0.55 + dot * 0.6;

                // 'color' (con tinte hipsométrico) para el caso sin textura.
                tmp.multiplyScalar(sombra);
                colores[idx * 3] = tmp.r; colores[idx * 3 + 1] = tmp.g; colores[idx * 3 + 2] = tmp.b;
                // 'hillshade' (gris puro) para multiplicar sobre la textura real.
                hillshadeAttr[idx * 3] = sombra; hillshadeAttr[idx * 3 + 1] = sombra; hillshadeAttr[idx * 3 + 2] = sombra;
            }
        }
        // Arranca con el atributo 'color' hipsométrico (caso sin textura,
        // el más común al montar mientras la imagen satelital carga) —
        // cuando la textura queda lista, un efecto aparte (ver más abajo)
        // SUSTITUYE este mismo atributo 'color' por el buffer de hillshade
        // puro guardado en userData. Two atributos GLSL custom distintos
        // (intento anterior con onBeforeCompile + 'attribute vec3
        // hillshade') resultó frágil: WebGL no garantiza el binding de un
        // atributo no estándar solo por string-replace del shader, y ese
        // era el motivo real por el que la textura cargaba sin error pero
        // el render seguía mostrando el color plano. meshStandardMaterial
        // YA combina 'map' y 'vertexColors' (atributo 'color' estándar) de
        // forma nativa en su pipeline — no hace falta ningún shader custom.
        geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
        geo.userData.colorHipsometrico = colores;
        geo.userData.colorHillshade = hillshadeAttr;
        geo.rotateX(-Math.PI / 2);

        return geo;
    }, [dem, centro, elevacionReferencia, contornoAgua]);

    // Carga manual (no useLoader/Suspense de drei): así se puede caer de
    // vuelta al color hipsométrico (vertexColors, ya calculado arriba) si la
    // textura aún no existe para esta presa o falla la carga, en vez de que
    // todo el visor 3D quede en estado de suspenso esperando una imagen que
    // puede no estar disponible.
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    useEffect(() => {
        if (!texturaUrl) { setTexture(null); onEstadoTextura?.('sin_url'); return; }
        let cancelado = false;
        onEstadoTextura?.('cargando');
        const loader = new THREE.TextureLoader();
        // crossOrigin explícito: sin esto, algunos navegadores bloquean
        // silenciosamente una textura WebGL cargada de otro origen
        // (localhost:5173 → *.supabase.co) por política de "tainted
        // canvas" — el onError de abajo ni siquiera se dispara en ese caso,
        // simplemente la textura no aparece. Coincide con el síntoma
        // reportado ("a veces no aparece", sin patrón claro de timing).
        loader.setCrossOrigin('anonymous');
        loader.load(
            texturaUrl,
            (tex) => {
                if (cancelado) return;
                tex.colorSpace = THREE.SRGBColorSpace;
                // minFilter/mipmaps explícitos: sin esto, muestrear la
                // textura de 2500x1742px a la distancia de cámara típica
                // (viendo el vaso completo, terreno lejano ocupando pocos
                // píxeles en pantalla) es más costoso de lo necesario —
                // mipmaps dejan que la GPU use una versión ya reducida en
                // vez de resamplear la imagen completa en cada frame.
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.generateMipmaps = true;
                setTexture(tex);
                onEstadoTextura?.('lista');
            },
            undefined,
            (err) => {
                // Antes descartaba el error en silencio (setTexture(null) sin
                // registrar nada) — reportado como carga "inconsistente" de
                // la textura sin poder saber si fallaba por CORS, timeout o
                // tamaño de archivo. console.warn deja ver la causa real en
                // devtools la próxima vez que ocurra.
                if (!cancelado) {
                    console.warn('VasoVisor3D: fallo al cargar textura satelital', texturaUrl, err);
                    setTexture(null);
                    onEstadoTextura?.('error');
                }
            },
        );
        return () => { cancelado = true; };
    }, [texturaUrl]);

    // Sustituye el atributo 'color' de la geometría: hipsométrico (tinte
    // verde/tierra/roca) mientras no hay textura, hillshade puro (gris, sin
    // tinte) en cuanto la textura satelital carga — así meshStandardMaterial
    // combina 'map' * 'color' de forma NATIVA (color_fragment corre antes
    // que map_fragment en su pipeline estándar, sin necesitar shader
    // custom). El intento anterior con un atributo GLSL propio inyectado
    // vía onBeforeCompile cargaba la textura sin error pero no la
    // renderizaba — WebGL no garantiza el binding de un atributo no
    // estándar solo por reemplazo de texto en el shader.
    useEffect(() => {
        const buffer = texture ? geometria.userData.colorHillshade : geometria.userData.colorHipsometrico;
        if (!buffer) return;
        const attr = geometria.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (attr) { attr.array.set(buffer); attr.needsUpdate = true; }
        else geometria.setAttribute('color', new THREE.BufferAttribute(buffer, 3));
    }, [texture, geometria]);

    // Libera geometría/textura de GPU al desmontar — mismo motivo que el
    // dispose() explícito de CortinaMesh (ver su comentario): React Three
    // Fiber libera automáticamente un <mesh> retirado del árbol, pero NO
    // hay garantía de que ocurra a tiempo. Al activar "Ver cortina real",
    // este componente se desmonta (terreno+agua ocultos) en el MISMO ciclo
    // en que CortinaMesh empieza a cargar su propia geometría (99k
    // vértices) + textura — sin liberar la malla del terreno (~35k
    // vértices, posición+normal+uv+color+hillshade) y su textura satelital
    // (hasta 11+ MB) de inmediato, hay una ventana donde ambas escenas
    // coexisten en VRAM, agotándola ("WebGL Context Lost" reportado
    // consistentemente al activar el toggle, incluso con dpr=1).
    useEffect(() => {
        return () => {
            geometria.dispose();
            texture?.dispose();
        };
    }, [geometria, texture]);

    return (
        <mesh geometry={geometria} receiveShadow castShadow>
            <meshStandardMaterial vertexColors map={texture ?? undefined} roughness={texture ? 0.9 : 0.85} metalness={0} />
        </mesh>
    );
}

// Elevación de referencia (Y=0) usada al georreferenciar cortina.obj —
// promedio de altitud GPS de las 34 cámaras de dron ubicadas por Meshroom
// (ver scratchpad/calcular_transformacion.py, corrido una sola vez fuera
// del proyecto). NO es la misma referencia que usa el resto de la escena
// (nivelMsnm del día) — el offset entre ambas se aplica en <CortinaMesh>.
const CORTINA_ELEVACION_REFERENCIA_MSNM = 1286.16;
// Rotación que alinea el sistema de coordenadas LOCAL de cortina.obj
// (arbitrario — Meshroom/AliceVision no tiene ninguna noción de Norte real,
// solo reconstruye desde Structure-from-Motion) con el sistema geográfico
// real (Este/Norte/Arriba) que usa el resto de la escena vía
// proyectaAMetros. Sin esto, el .obj se dibujaba con la orientación cruda
// que le tocó a Meshroom — reportado como "la imagen de la cortina está al
// revés" (espejada/rotada respecto al terreno real que la rodea).
//
// Calculado en dos pasos encadenados (ver scratchpad/calcular_transformacion.py):
// 1) Kabsch entre las 34 poses de cámara reconstruidas por Meshroom
//    (StructureFromMotion/cameras.sfm, pose.transform.center) y las mismas
//    34 posiciones GPS reales del EXIF de las fotos (a ENU metros locales)
//    — residual 0.29m sobre un vuelo de ~40m de radio, escala 0.9999.
// 2) Kabsch adicional, imprescindible: cortina.obj (el archivo que USA la
//    app) NO está en el mismo sistema de coordenadas que cameras.sfm — el
//    paso de conversión EXR→PNG con Assimp (ver cortina.mtl) también
//    re-centró/rotó la malla completa (mismo orden de vértices que
//    Texturing/.../texturedMesh.obj, el output crudo de Meshroom, pero
//    rangos de coordenadas totalmente distintos: cientos de metros en uno,
//    miles en el otro) — residual de esta segunda alineación: ~5×10⁻⁶ m
//    (isometría exacta, sin deformación). Ignorar este paso fue el primer
//    intento fallido: producía un quaternion "matemáticamente válido" pero
//    para el sistema de coordenadas equivocado, y la cortina desaparecía
//    de cámara por completo.
const CORTINA_QUATERNION = new THREE.Quaternion(0.00037985, -0.39766407, 0.00000108, 0.91753100);
// Traslación XZ complementaria: el origen local (0,0,0) de cortina.obj NO
// coincide con el centro real de la cortina (el archivo tiene mucho terreno
// circundante capturado además del muro) — el centroide de las 34 cámaras
// en el espacio de cortina.obj cae en (~5642, 0, ~-523) local, muy lejos de
// (0,0,0). CORTINA_GPS/offsetY posicionan ESE centroide en el target real
// de la escena; sin esta traslación (versión anterior, solo con
// `position={[0, offsetY, 0]}`) el objeto rotado quedaba a ~4-5km del
// target de cámara, fuera de campo por completo ("ahora no aparece nada").
const CORTINA_OFFSET_XZ: [number, number] = [-4239.11841, -3759.66240];
// Coordenadas GPS reales de la cortina (centro aproximado de las 56 fotos
// de dron, ver EXIF verificado en Presa Boquilla/Imagenes). Usadas para
// apuntar la cámara hacia la cortina cuando está activa — sin esto, target
// quedaba en [0,0,0] (centro del bbox del DEM completo), a ~5.6km de
// distancia real de la cortina, dejándola fuera de campo de visión con el
// radio de cámara acotado que usa este modo.
const CORTINA_GPS = { lat: 27.5477, lon: -105.4139 };
// DIAGNÓSTICO TEMPORAL: aislar si "Context Lost" viene de TerrenoMesh
// (35k vértices, atributos position+normal+uv+color+hillshade) o de otra
// parte de la escena — ya descartadas GPU integrada (es RTX 2060 real),
// proceso GPU corrupto de Edge (persiste tras reinicio completo) y la
// textura satelital del terreno (persiste con texturaUrl=null).
// Exageración vertical NO se aplica a la cortina: a diferencia del
// terreno/DEM (aproximado, downsampled), este modelo es fotogrametría real
// medida en metros verdaderos — exagerarlo la desalinearía físicamente de
// su propia posición real en el espacio, y una estructura de concreto no
// necesita "ayuda" para leerse en 3D como sí la necesita un relieve de
// terreno visto desde muy lejos.

function CortinaMesh({ elevacionReferencia }: { elevacionReferencia: number }) {
    const objRef = useRef<THREE.Group | null>(null);
    const [modelo, setModelo] = useState<THREE.Group | null>(null);
    const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando');

    useEffect(() => {
        let cancelado = false;
        setEstado('cargando');
        import('three-stdlib').then(({ OBJLoader, MTLLoader }) => {
            if (cancelado) return;
            const mtlLoader = new MTLLoader();
            mtlLoader.setPath('/modelos3d/cortina-boquilla/');
            mtlLoader.load(
                'cortina.mtl',
                (materiales) => {
                    if (cancelado) return;
                    materiales.preload();
                    const objLoader = new OBJLoader();
                    objLoader.setMaterials(materiales);
                    objLoader.setPath('/modelos3d/cortina-boquilla/');
                    objLoader.load(
                        'cortina.obj',
                        (obj) => {
                            if (cancelado) return;
                            console.warn('VasoVisor3D: cortina.obj cargado OK (con textura)', obj);
                            setModelo(obj);
                            setEstado('lista');
                        },
                        undefined,
                        (err) => {
                            console.warn('VasoVisor3D: fallo al cargar modelo de cortina', err);
                            if (!cancelado) setEstado('error');
                        },
                    );
                },
                undefined,
                (err) => {
                    console.warn('VasoVisor3D: fallo al cargar materiales de cortina', err);
                    if (!cancelado) setEstado('error');
                },
            );
        });
        return () => { cancelado = true; };
    }, []);

    // Libera geometría/textura de GPU al desmontar (toggle "Ocultar
    // cortina" o cambio de mes/presa) — React desmonta el componente, pero
    // Three.js NO libera memoria de VRAM automáticamente sin un dispose()
    // explícito. Con GPU integrada de memoria compartida limitada, dejar
    // esto sin liberar significa que activar/desactivar el toggle varias
    // veces acumula VRAM sin devolverla, acercando cada vez más a otra
    // pérdida de contexto.
    useEffect(() => {
        return () => {
            if (!modelo) return;
            modelo.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    for (const mat of mats) {
                        mat.map?.dispose();
                        mat.dispose();
                    }
                }
            });
        };
    }, [modelo]);

    if (estado !== 'lista' || !modelo) return null;

    // Offset entre la referencia usada al georreferenciar el .obj
    // (CORTINA_ELEVACION_REFERENCIA_MSNM) y la referencia real de la
    // escena (elevacionReferencia = nivelMsnm del día) — sin esto la
    // cortina quedaría flotando o hundida respecto al agua/terreno reales.
    // Multiplicado por EXAGERACION_VERTICAL: el resto de la escena (agua,
    // terreno) SÍ tiene esa exageración aplicada a sus posiciones Y — sin
    // aplicarla también aquí, el offset (unos pocos metros reales) quedaba
    // desproporcionadamente pequeño frente a un terreno exagerado 2.2x a
    // su alrededor, dejando la cortina visualmente enterrada o
    // desalineada del resto de la escena.
    const offsetY = (CORTINA_ELEVACION_REFERENCIA_MSNM - elevacionReferencia) * EXAGERACION_VERTICAL;

    return (
        <primitive
            ref={objRef}
            object={modelo}
            quaternion={CORTINA_QUATERNION}
            position={[CORTINA_OFFSET_XZ[0], offsetY, CORTINA_OFFSET_XZ[1]]}
        />
    );
}

function VasoMesh({ contornoGeojson, nivelMsnm, centro, elevacionReferencia }: {
    contornoGeojson: VasoVisor3DProps['contornoGeojson'];
    nivelMsnm: number | null;
    centro: { lon: number; lat: number; cosLat: number };
    elevacionReferencia: number;
}) {
    const geometria = useMemo(() => {
        if (!contornoGeojson) return null;
        const [exterior, ...islas] = contornoGeojson.coordinates;
        if (!exterior || exterior.length < 3) return null;

        // THREE.Shape acepta huecos nativamente (shape.holes) — las islas del
        // GeoJSON son exactamente eso, sin necesitar triangulación manual ni
        // una librería de geometría aparte.
        const shape = new THREE.Shape();
        exterior.forEach(([lon, lat], i) => {
            const [x, z] = proyectaAMetros(lon, lat, centro);
            if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
        });
        shape.closePath();

        for (const isla of islas) {
            if (isla.length < 3) continue;
            const path = new THREE.Path();
            isla.forEach(([lon, lat], i) => {
                const [x, z] = proyectaAMetros(lon, lat, centro);
                if (i === 0) path.moveTo(x, z); else path.lineTo(x, z);
            });
            path.closePath();
            shape.holes.push(path);
        }

        // SIN fondo hundido: la versión anterior calculaba un perfil cónico
        // (profundidad máxima en el centroide, decreciendo a 0 hacia el
        // perímetro) para dar sensación de volumen. Con un embalse muy
        // alargado y dendrítico como La Boquilla (~30km de extremo a
        // extremo), los brazos lejos del centroide recibían profundidad casi
        // nula — ahí el polígono de agua quedaba prácticamente al ras del
        // terreno real (DEM), y cualquier variación de éste hacía que el
        // agua se viera cortada en fragmentos dispersos en vez de un cuerpo
        // continuo (reportado visualmente). Una lámina plana a la elevación
        // real del agua es menos "bonita" que un tazón 3D, pero es estable
        // en TODA la forma del polígono sin importar qué tan irregular sea,
        // y no es menos honesta — la Fase 1 original ya declaraba el fondo
        // como aproximado, nunca topografía medida.
        const shapeGeom = new THREE.ShapeGeometry(shape);
        shapeGeom.rotateX(-Math.PI / 2);

        return { superficie: shapeGeom };
    }, [contornoGeojson, centro]);

    if (!geometria) return null;

    // Altura de la lámina de agua relativa al mismo origen que el terreno:
    // sin nivel real del día, se asume la elevación de referencia misma
    // (lámina "al ras" del dato usado para anclar el DEM) en vez de 0
    // absoluto, que colocaría el agua muy por debajo/encima del terreno real.
    // Mismo factor EXAGERACION_VERTICAL que el terreno y el fondo.
    const alturaAgua = (nivelMsnm != null ? nivelMsnm - elevacionReferencia : 0) * EXAGERACION_VERTICAL;

    return (
        <group position={[0, alturaAgua, 0]}>
            <mesh geometry={geometria.superficie} position={[0, 0, 0]}>
                {/* Tono ajustado de celeste brillante (#0ea5e9, se veía como
                    una capa "pegada" encima de la textura satelital
                    fotorrealista — demasiado saturado/artificial junto a
                    ella) a un verde-azulado profundo, más cercano al agua
                    real de un embalse visto desde altura (ver referencia
                    Google Earth). transmission bajado (menos "gel
                    translúcido") y clearcoat agregado para el brillo
                    especular sutil que sí tiene agua real bajo luz. */}
                <meshPhysicalMaterial
                    color="#12313a" transparent opacity={0.88}
                    roughness={0.18} metalness={0} transmission={0.12} thickness={1.5}
                    clearcoat={0.6} clearcoatRoughness={0.25}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
}

/** Vive DENTRO de <Canvas> — detecta pérdida/recuperación de contexto WebGL
 *  usando useThree() para acceder a `gl` ya inicializado por R3F, en vez de
 *  un prop `onCreated` en <Canvas> que manipulaba gl.domElement directo
 *  ANTES de que R3F terminara su propia inicialización — esa era la causa
 *  real de la pérdida de contexto (confirmado por aislamiento: la escena
 *  más mínima posible seguía fallando con onCreated, y funcionó al
 *  quitarlo). onEstado se dispara en el padre para mostrar el aviso de
 *  recuperación en el overlay. */
function VigilanteContexto({ onEstado }: { onEstado: (perdido: boolean) => void }) {
    const { gl } = useThree();
    useEffect(() => {
        const canvas = gl.domElement;
        const onLost = (e: Event) => {
            e.preventDefault();
            console.warn('VasoVisor3D: WebGL context lost');
            onEstado(true);
        };
        const onRestored = () => {
            console.warn('VasoVisor3D: WebGL context restored');
            onEstado(false);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);
        return () => {
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
        };
    }, [gl, onEstado]);
    return null;
}

/** Vive DENTRO de <Canvas> — mueve cámara + target de OrbitControls a la
 *  posición de encuadre inicial sin desmontar nada. Reemplaza el enfoque
 *  anterior (remount de <Canvas> vía key) que, al recrear TerrenoMesh desde
 *  cero, disparaba una recarga de la textura satelital desde el servidor:
 *  mientras esa carga async estaba en curso el terreno volvía brevemente al
 *  color hipsométrico plano sin la textura/contorno visibles — el "bug" de
 *  Encuadrar reportado. Con solo mover cámara/target, las mallas y su
 *  textura ya cargada nunca se tocan. */
function ControladorCamara({ posicionInicial, targetInicial, resetTrigger }: {
    posicionInicial: [number, number, number];
    targetInicial: [number, number, number];
    resetTrigger: number;
}) {
    const { camera } = useThree();
    const controlsRef = useRef<OrbitControlsImpl | null>(null);
    useEffect(() => {
        if (resetTrigger === 0) return; // no correr en el montaje inicial — camera.position ya arranca ahí por la prop `camera` del Canvas
        camera.position.set(...posicionInicial);
        controlsRef.current?.target.set(...targetInicial);
        controlsRef.current?.update();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetTrigger]);
    // Distancia cámara↔target, NO Math.hypot(posicionInicial) al origen
    // absoluto — con el modo cortina, target se desplaza lejos del origen
    // (la cortina está a ~5.6km del centro del bbox del vaso completo), así
    // que medir contra el origen daba límites de zoom completamente
    // incorrectos (miles de metros de más).
    const distanciaCamaraTarget = Math.hypot(
        posicionInicial[0] - targetInicial[0],
        posicionInicial[1] - targetInicial[1],
        posicionInicial[2] - targetInicial[2],
    );
    return (
        <OrbitControls
            ref={controlsRef}
            makeDefault enableDamping dampingFactor={0.08}
            minDistance={Math.max(20, distanciaCamaraTarget * 0.03)}
            maxDistance={distanciaCamaraTarget * 6}
            maxPolarAngle={Math.PI / 2 * 0.98}
            target={targetInicial}
        />
    );
}

const VasoVisor3D: React.FC<VasoVisor3DProps> = ({ contornoGeojson: contornoGeojsonProp, nivelMsnm, nombrePresa, fechaEscena, presaId }) => {
    // Estabiliza la referencia de contornoGeojson por CONTENIDO, no por
    // identidad de objeto: el padre (PresaVasoMonitor.tsx) puede re-renderizar
    // sin memoizar filaComparada.contorno_geojson, entregando un objeto con
    // el mismo contenido pero nueva referencia en cada render (tiene un
    // timer de reloj que fuerza renders cada segundo). Sin esto, cualquier
    // useMemo aguas abajo que dependa de contornoGeojson (geometría del
    // terreno, del agua) se recalculaba en loop — causa real de los miles de
    // warnings de WebGLShadowMap vistos en consola (cada recálculo tocaba
    // castShadow) y de que el material nunca se "asentara" en un estado
    // visual estable (se veía blanco/plano sin variación).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const contornoGeojson = useMemo(() => contornoGeojsonProp, [JSON.stringify(contornoGeojsonProp)]);

    const { dem, estado: estadoDem } = useDemTerreno(presaId);
    const texturaSatelital = useTexturaSatelital(presaId);
    // Estado REAL de la carga de la imagen (no solo si el registro de
    // metadatos existe) — reportado por TerrenoMesh vía onEstadoTextura.
    const [estadoTextura, setEstadoTextura] = useState<'sin_url' | 'cargando' | 'lista' | 'error'>('sin_url');
    // Contador simple: cada incremento dispara el efecto de reencuadre en
    // ControladorCamara (ver su comentario) — ya NO fuerza remount de
    // <Canvas>, que antes recargaba texturas/geometría innecesariamente.
    const [resetTick, setResetTick] = useState(0);

    // Cortina de La Boquilla — modelo real de fotogrametría (Meshroom,
    // 56 fotos de dron georreferenciadas por GPS/gimbal, ver
    // Presa Boquilla/Imagenes). Apagado por defecto: ~22MB entre .obj y
    // textura, solo se descarga si el usuario lo activa explícitamente.
    // Solo disponible para PRE-001 (La Boquilla) — es donde se hizo el vuelo.
    const [mostrarCortina, setMostrarCortina] = useState(false);

    // Recuperación de "WebGL Context Lost": la causa real resultó ser la
    // forma en que se registraban estos listeners — un prop `onCreated`
    // en <Canvas> que llamaba gl.domElement.addEventListener() directo
    // interfería con la inicialización interna de @react-three/fiber y
    // PROVOCABA la pérdida de contexto por sí solo (confirmado por
    // aislamiento: la escena más mínima posible —solo agua, sin terreno/
    // sombras/Environment/StrictMode— seguía fallando CON onCreated, y
    // funcionó en cuanto se quitó). Ahora se hace correctamente: un
    // componente HIJO dentro del Canvas (VigilanteContexto, más abajo) que
    // usa useThree() para leer `gl` ya inicializado por R3F, y useEffect
    // con cleanup — nunca manipulando el DOM del canvas antes de que R3F
    // termine de montarlo.
    const [contextoWebglPerdido, setContextoWebglPerdido] = useState(false);
    const [forceRemountTick, setForceRemountTick] = useState(0);

    // Pantalla completa del visor 3D — CSS-only (position:fixed cubriendo
    // el viewport), NO la Fullscreen API nativa del navegador.
    //
    // Intento anterior (Element.requestFullscreen + fallback webkit-prefixed)
    // seguía sin funcionar en iPad incluso en iPadOS 16.4+: confirmado en
    // campo que ni el prefijo webkit resolvía nada — Safari en iOS/iPadOS
    // restringe la Fullscreen API casi exclusivamente a <video>, un <div>
    // arbitrario nunca entra en pantalla completa real ahí sin importar el
    // prefijo (limitación de WebKit, no arreglable llamando distinto a la
    // misma API). La alternativa universal (funciona igual en iPad, iPhone,
    // desktop, cualquier navegador) es simular el efecto con CSS: el
    // contenedor pasa a position:fixed cubriendo todo el viewport en vez de
    // pedirle al navegador que entre en su propio modo fullscreen nativo.
    const [esPantallaCompleta, setEsPantallaCompleta] = useState(false);
    const alternarPantallaCompleta = () => setEsPantallaCompleta(v => !v);

    // Origen local común: centro del bbox del DEM (la única referencia
    // geolocalizada real que tenemos, tomada de las coordenadas GPS de las
    // fotos de dron) cuando hay DEM cargado; si no, cae de vuelta al
    // centroide del propio polígono NDWI (comportamiento de Fase 1, sin
    // terreno) para no romper el visor mientras el DEM no esté disponible.
    const centro = useMemo(() => {
        if (dem) {
            const [west, south, east, north] = dem.bbox;
            return {
                lon: (west + east) / 2, lat: (south + north) / 2,
                cosLat: Math.cos(((south + north) / 2) * Math.PI / 180),
            };
        }
        if (!contornoGeojson) return { lon: 0, lat: 0, cosLat: 1 };
        const exterior = contornoGeojson.coordinates[0];
        const lons = exterior.map(([lon]) => lon);
        const lats = exterior.map(([, lat]) => lat);
        return {
            lon: (Math.min(...lons) + Math.max(...lons)) / 2,
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            cosLat: Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI / 180),
        };
    }, [dem, contornoGeojson]);

    // Elevación de referencia del origen local (Y=0 en la escena 3D): SIEMPRE
    // el nivel real del agua (nivelMsnm) cuando existe, nunca el promedio del
    // terreno. Con el bbox ampliado a los ~55km del vaso completo (antes
    // acotado a ~3km alrededor de la cortina), el DEM pasó a incluir sierra
    // de hasta 1801 msnm junto al agua a ~1300 msnm — promediar todo el
    // terreno arrastraba la referencia muy por encima del nivel real del
    // agua, empujando alturaAgua (VasoMesh) muy por debajo de cero y
    // haciendo que el fondo aproximado del vaso "asomara" sobre el propio
    // polígono de agua en varios puntos: el síntoma visual reportado era el
    // polígono de julio viéndose fragmentado en salpicaduras en vez de un
    // cuerpo continuo. Anclar a nivelMsnm deja el agua siempre en Y=0 (su
    // posición natural, sin desplazamiento) y el terreno se acomoda arriba/
    // abajo de esa referencia real — que es lo físicamente correcto.
    const elevacionReferencia = useMemo(() => {
        if (nivelMsnm != null) return nivelMsnm;
        if (dem) {
            const validos = dem.grid.flat().filter((v): v is number => v != null);
            if (validos.length) return validos.reduce((s, v) => s + v, 0) / validos.length;
        }
        return 1300;
    }, [dem, nivelMsnm]);

    // Radio real de la escena: el mayor entre el polígono del vaso (puede
    // ser un embalse enorme y dendrítico como La Boquilla, muchos km de
    // extremo a extremo) y el bbox del DEM (~3km, acotado a la cortina) —
    // antes la cámara usaba una posición fija (900,900) pensada para el
    // tamaño del DEM, así que un vaso mucho más grande que ese bbox quedaba
    // recortado casi de perfil, con muy poco ángulo de observación (el caso
    // reportado). Con el radio real, la posición/zoom inicial y los límites
    // de OrbitControls se escalan al tamaño real de CADA presa/mes, no a un
    // número fijo que solo funciona para un caso.
    // Radio del VASO (nunca cambia por mostrarCortina) — usado solo para
    // canvasKey, para que activar/desactivar el toggle de cortina NO fuerce
    // un remount del <Canvas>. Antes, radioEscena (que sí cambiaba a un
    // valor fijo de 300 en modo cortina) formaba parte de canvasKey vía
    // Math.round(radioEscena), así que el toggle SIEMPRE recreaba el
    // contexto WebGL desde cero — confirmado como la causa real del loop de
    // "Context Lost" (persistía incluso con un cubo procedural simple en
    // vez de la cortina real, aislando el problema al remount en sí).
    const radioEscenaVaso = useMemo(() => {
        let radio = 500;
        if (contornoGeojson) {
            const exterior = contornoGeojson.coordinates[0];
            for (const [lon, lat] of exterior) {
                const [x, z] = proyectaAMetros(lon, lat, centro);
                radio = Math.max(radio, Math.sqrt(x * x + z * z));
            }
        }
        if (dem) {
            const [west, south, east, north] = dem.bbox;
            for (const [lon, lat] of [[west, south], [west, north], [east, south], [east, north]] as [number, number][]) {
                const [x, z] = proyectaAMetros(lon, lat, centro);
                radio = Math.max(radio, Math.sqrt(x * x + z * z));
            }
        }
        return radio;
    }, [contornoGeojson, dem, centro]);

    const radioEscena = useMemo(() => {
        if (mostrarCortina) return 300;
        return radioEscenaVaso;
    }, [mostrarCortina, radioEscenaVaso]);

    // Clave de remount de <Canvas>: usa radioEscenaVaso (NUNCA cambia por
    // mostrarCortina), no radioEscena — así activar/desactivar el toggle de
    // cortina ya no fuerza un remount del Canvas (contexto WebGL nuevo desde
    // cero), confirmado como la causa real del loop de "Context Lost"
    // (persistía incluso con un cubo procedural simple en el modo cortina,
    // aislando el problema al remount en sí, no a lo que se dibuja después).
    // ControladorCamara.resetTrigger sigue encargándose de mover la cámara
    // al nuevo target/radio del modo cortina sin necesitar un contexto
    // nuevo. Cambiar de mes/presa sigue forzando remount real (si acaso).
    const canvasKey = `${presaId}-${fechaEscena}-${Math.round(radioEscenaVaso)}-${forceRemountTick}`;

    // Punto hacia el que apunta la cámara: el origen del bbox (centro del
    // vaso completo) normalmente, o la posición real de la cortina cuando
    // ese modo está activo — la cortina está a ~5.6km del centro del bbox,
    // muy fuera de campo con el radio de cámara acotado (300m) que usa este
    // modo si el target se quedara en el origen.
    const targetCamara: [number, number, number] = (() => {
        if (!mostrarCortina) return [0, 0, 0];
        const [x, z] = proyectaAMetros(CORTINA_GPS.lon, CORTINA_GPS.lat, centro);
        return [x, 0, z];
    })();

    if (!contornoGeojson) {
        return (
            <div className="vaso3d-empty">Sin polígono disponible para esta fecha — selecciona un mes con escena NDWI.</div>
        );
    }

    // Encuadre proporcional: altura ~0.55x el radio, retroceso ~0.65x —
    // mismo ángulo relativo ("vista de dron alta") sin importar si el vaso
    // mide 500m o 30km de lado a lado.
    const alturaCam = radioEscena * 0.55;
    const retrocesoCam = radioEscena * 0.65;

    return (
        <div className={esPantallaCompleta ? 'vaso3d-canvas-wrap vaso3d-pantalla-completa' : 'vaso3d-canvas-wrap'}>
            <Canvas
                key={canvasKey}
                // dpr fijo en 1 (no el [1,2] por defecto de R3F, que sigue
                // devicePixelRatio del sistema): en una pantalla de alto DPI
                // eso duplica (o más) los píxeles reales del framebuffer sin
                // aviso, justo cuando la escena ya está cerca del límite de
                // VRAM (DEM + textura satelital + malla de cortina
                // fotogramétrica) — visto en consola como un salto de
                // tamaño real de canvas (ej. 1649×457 CSS → 3300×916 buffer)
                // coincidiendo con "WebGL Context Lost". dpr=1 es memoria
                // predecible y bastaba de sobra para la nitidez ya vista.
                dpr={1}
                // near subido de 1→10: la precisión del depth buffer se
                // degrada con el ratio far/near, no con far en sí — con
                // near=1 sobre un far de cientos de miles de metros ese
                // ratio era enorme y contribuía al z-fighting (vetas verdes
                // parpadeantes entre agua y terreno reportadas al mover la
                // cámara). minDistance de OrbitControls ya no deja acercar
                // la cámara a menos de 20m, así que near=10 no corta nada.
                camera={{ position: [radioEscena * 0.12, alturaCam, retrocesoCam], fov: 42, near: 10, far: Math.max(20000, radioEscena * 8) }}
                shadows
                // Exposición bajada de 1.15→0.85: la combinación de
                // ambientLight + 2 directionalLight + Environment (que TAMBIÉN
                // aporta iluminación IBL, no solo el fondo) + ToneMapping ACES
                // de postprocessing + esta exposición apilada por encima
                // sobreexponía la escena a blanco casi puro — reportado como
                // "el terreno se ve completamente blanco/plano, sin textura
                // ni variación visible" incluso con la textura satelital ya
                // cargando correctamente. 0.85 es un punto de partida
                // conservador para volver a ver contraste real.
                gl={{ toneMappingExposure: 0.85 }}
            >
                {/* Fondo visible del canvas: <Environment> por sí solo SOLO
                    aporta iluminación IBL a los materiales, no pinta el
                    fondo del canvas (background por defecto es transparente/
                    negro) — sin esto detrás del relieve se veía un vacío
                    negro plano en vez de cielo. Un color sólido tipo
                    atardecer, coherente con el preset "sunset" de abajo, es
                    más liviano que activar el HDRI completo como fondo
                    (Environment background) y se funde bien con la niebla. */}
                <color attach="background" args={['#2b2438']} />
                {/* Niebla atmosférica: da sensación real de distancia/profundidad
                    en una escena tan extensa (~55km) — sin ella el terreno
                    lejano se veía tan nítido y saturado como el cercano,
                    aplanando la lectura de "qué tan lejos" está cada
                    montículo. Mismo tono que el fondo para que la transición
                    del relieve hacia el horizonte sea suave, no un corte. */}
                <fog attach="fog" args={['#2b2438', radioEscena * 1.2, radioEscena * 5.5]} />
                {/* Intensidades bajadas (0.6→0.35, 1.4→0.9, 0.4→0.25):
                    combinadas con Environment (que TAMBIÉN ilumina, no solo
                    pinta fondo) + exposición + ToneMapping ACES de
                    postprocessing, la suma anterior sobreexponía la escena
                    a blanco casi puro — la textura satelital cargaba bien
                    pero el resultado final se veía plano/blanco de todas
                    formas por exceso de luz acumulada en el pipeline. */}
                <ambientLight intensity={0.35} />
                {/* shadow-mapSize bajado de 2048→1024: con el hillshade
                    analítico + SSAO ya dando la mayor parte de la
                    sensación de relieve, la sombra proyectada (castShadow)
                    aporta poco detalle adicional a esta escala — 1024 sigue
                    siendo nítido y reduce bastante el costo de render. */}
                <directionalLight position={[radioEscena * 0.5, radioEscena * 0.7, radioEscena * 0.35]} intensity={0.9} castShadow
                    shadow-mapSize={[1024, 1024]} />
                {/* Luz de relleno tenue desde el lado opuesto — sin esto las
                    laderas en sombra del terreno se veían casi negras y el
                    color por pendiente/elevación de TerrenoMesh no se
                    distinguía ahí. */}
                <directionalLight position={[-radioEscena * 0.43, radioEscena * 0.36, -radioEscena * 0.29]} intensity={0.25} />
                <Environment preset="sunset" environmentIntensity={0.4} />
                {/* Terreno/agua y cortina NUNCA coexisten en pantalla —
                    decisión de diseño (no de límite de VRAM, esa hipótesis
                    resultó incorrecta): al activar "Ver cortina real" se
                    oculta el terreno para mantener el encuadre y la cámara
                    enfocados en un solo tema a la vez. */}
                {!mostrarCortina && dem && <TerrenoMesh dem={dem} centro={centro} elevacionReferencia={elevacionReferencia} contornoAgua={contornoGeojson} texturaUrl={texturaSatelital?.urlPublica} onEstadoTextura={setEstadoTextura} />}
                {!mostrarCortina && <VasoMesh contornoGeojson={contornoGeojson} nivelMsnm={nivelMsnm} centro={centro} elevacionReferencia={elevacionReferencia} />}
                {mostrarCortina && presaId === 'PRE-001' && <CortinaMesh elevacionReferencia={elevacionReferencia} />}
                {/* Movilidad y altura adaptativa: minDistance/maxDistance
                    escalan con el tamaño real de la escena — antes
                    (80..4000 fijo) un vaso grande topaba con maxDistance
                    mucho antes de poder verlo completo. maxPolarAngle algo
                    menor a 90° (Math.PI/2 * 0.98) evita que la cámara cruce
                    bajo el plano del agua/terreno y quede mirando "desde
                    abajo" sin ninguna referencia visual. Vive dentro de
                    ControladorCamara junto con el reset del botón
                    "Encuadrar" (ver definición del componente arriba). */}
                <ControladorCamara
                    posicionInicial={[targetCamara[0] + radioEscena * 0.12, alturaCam, targetCamara[2] + retrocesoCam]}
                    targetInicial={targetCamara}
                    resetTrigger={resetTick}
                />
                <VigilanteContexto onEstado={setContextoWebglPerdido} />
                {/* Post-procesado (SSAO + ToneMapping ACES + viñeta) RETIRADO:
                    combinado con las luces de la escena + toneMappingExposure
                    del renderer, dejaba el terreno en blanco puro sin ninguna
                    variación de sombra — sobreexposición acumulada del
                    pipeline. La textura satelital real + el hillshade
                    analítico por vértice ya dan suficiente contraste sin él;
                    si se quiere retomar el look cinematográfico más adelante,
                    hacerlo con exposición/intensidades mucho más bajas desde
                    el inicio y verificar cada capa por separado antes de
                    apilarlas todas. */}
            </Canvas>
            {/* Aviso de recuperación: sin esto, una pérdida de contexto
                WebGL (agotamiento de memoria de GPU — puede pasar al sumar
                DEM + textura satelital + malla de cortina fotogramétrica)
                dejaba el Canvas congelado en negro/blanco SIN NINGÚN aviso,
                reportado como "presiono el botón y no pasa nada". */}
            {contextoWebglPerdido && (
                <div className="vaso3d-contexto-perdido">
                    <span>Se perdió el contexto 3D (memoria de GPU agotada) — probablemente al cargar la cortina junto al resto de la escena.</span>
                    <button
                        type="button"
                        onClick={() => { setContextoWebglPerdido(false); setForceRemountTick(t => t + 1); }}
                    >
                        Reintentar
                    </button>
                </div>
            )}
            <div className="vaso3d-overlay">
                {/* Antes decía "IMAGEN SATELITAL" solo porque el REGISTRO
                    (textura_satelital_terreno) existía, sin importar si la
                    imagen en sí (11+ MB) ya había terminado de cargar en el
                    navegador — reportado como desalineación entre el badge y
                    lo que realmente se veía en pantalla (color plano). Ahora
                    usa estadoTextura, que refleja el resultado real de
                    THREE.TextureLoader. */}
                <span className="vaso3d-badge">
                    {!dem
                        ? 'APROXIMADO — sin DEM real'
                        : estadoTextura === 'lista'
                            ? 'TERRENO REAL + IMAGEN SATELITAL (Sentinel-2) — FONDO DE VASO APROXIMADO'
                            : estadoTextura === 'cargando'
                                ? 'TERRENO REAL (Copernicus DEM) — cargando imagen satelital…'
                                : estadoTextura === 'error'
                                    ? 'TERRENO REAL (Copernicus DEM) — imagen satelital no disponible'
                                    : 'TERRENO REAL (Copernicus DEM) — FONDO DE VASO APROXIMADO'}
                </span>
                <span className="vaso3d-caption">
                    {nombrePresa} · {new Date(fechaEscena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' })}
                    {estadoDem === 'cargando' && ' · cargando terreno…'}
                </span>
            </div>
            <div className="vaso3d-controles-flotantes">
                {/* Cortina real (fotogrametría, 56 fotos de dron
                    georreferenciadas) — solo para La Boquilla, apagada por
                    defecto (~22MB entre malla y textura). */}
                {presaId === 'PRE-001' && (
                    <button
                        type="button"
                        className="vaso3d-toggle-btn"
                        onClick={() => { setMostrarCortina(v => !v); setResetTick(t => t + 1); }}
                        title={mostrarCortina ? 'Ocultar cortina (fotogrametría real)' : 'Mostrar cortina (fotogrametría real, ~22MB)'}
                    >
                        {mostrarCortina ? 'Ocultar cortina' : 'Ver cortina real'}
                    </button>
                )}
                {/* Pantalla completa: al ser un contenedor propio (no todo
                    GeoMonitor), requestFullscreen() se pide sobre
                    contenedorRef — el navegador expande SOLO este div, el
                    Canvas de R3F se redimensiona automáticamente al cambiar
                    su tamaño en el DOM. */}
                <button
                    type="button"
                    className="vaso3d-toggle-btn"
                    onClick={alternarPantallaCompleta}
                    title={esPantallaCompleta ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
                >
                    {esPantallaCompleta ? <Minimize size={13} /> : <Maximize size={13} />}
                    {esPantallaCompleta ? 'Salir' : 'Pantalla completa'}
                </button>
                {/* Botón de re-encuadre: en un vaso grande es fácil perderse
                    orbitando/haciendo zoom — mueve la cámara a la posición
                    inicial proporcional sin recargar datos (ver
                    ControladorCamara). */}
                <button
                    type="button"
                    className="vaso3d-encuadrar-btn"
                    onClick={() => setResetTick(t => t + 1)}
                    title="Volver a la vista inicial"
                >
                    Encuadrar
                </button>
            </div>
        </div>
    );
};

export default VasoVisor3D;
