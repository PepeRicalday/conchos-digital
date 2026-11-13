// ═══════════════════════════════════════════════════════════════════════════
// Capa de CAMPO (isoyetas e isolíneas de temperatura, viento…) para el mapa interactivo de pantalla completa. Puro.
// ---------------------------------------------------------------------------
// NO calcula nada nuevo: parte del MISMO PlanoModelo que construye `construirPlano` (mismos números, niveles fijos, reglas S/D, 90 km, ajuste por
// altitud) y solo lo dibuja con el proyector del mapa interactivo (1 unidad = 1 px reales) para que se mueva con el zoom y el arrastre.
// Reglas de diseño (revisión 2026-11-13):
//  · las rampas de las variables terminan en tonos MUY oscuros que desaparecen sobre el fondo del mapa (#061532): en pantalla se aclaran
//    los extremos oscuros (colorPantalla); en los informes de papel la rampa no cambia;
//  · el relleno es semitransparente para que las capas de referencia y el contorno de la cuenca se vean debajo;
//  · los contornos llevan CASING oscuro (trazo oscuro más ancho debajo, trazo claro encima): su contraste no depende del color del relleno;
//  · S/D nunca es 0: sin cobertura (a más de 90 km de una estación) se vela y se rotula con trama.
// ═══════════════════════════════════════════════════════════════════════════
import type { CampoCuenca } from './camposCuenca';
import type { ProyectorMapa } from './geoCuenca';
import type { Anillo } from './isolineas';
import { colorBanda, mezclaHex } from './paletasClima';
import type { VariablePlano } from './paletasClima';
import type { PlanoModelo } from './planosCuenca';

/** Azul casi negro del fondo del mapa: casing de líneas y halo de textos y marcadores. */
export const CASING = '#04122b';
export const FONDO_MAPA = '#061532';

/** Luminancia relativa WCAG de un color #rrggbb (0 = negro, 1 = blanco). */
export function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Luminancia mínima de un color de relleno sobre el fondo oscuro del mapa (por debajo se «agujerea» el campo). */
export const LUM_MIN_PANTALLA = 0.09;

/** Aclara (mezcla con blanco) los tonos demasiado oscuros para el fondo del mapa; los medios y claros no se tocan. Solo pantalla. */
export function colorPantalla(hex: string): string {
  let c = hex;
  for (let i = 0; i < 4 && luminancia(c) < LUM_MIN_PANTALLA; i++) c = mezclaHex(c, '#ffffff', 0.2);
  return c;
}

/** Color de cada una de las n+1 clases de una variable (de la más baja a la más alta), ya ajustado a pantalla. */
export function paletaPantalla(v: VariablePlano, nNiveles: number): string[] {
  return Array.from({ length: nNiveles + 1 }, (_, k) => colorPantalla(colorBanda(v, k, nNiveles)));
}

export interface EntradaCampoSvg { opacidad: number; idTrama: string }
export interface CampoSvg {
  /** Relleno (fondo + bandas) y velo de «sin cobertura»; va recortado a la cuenca y con la opacidad pedida. */
  relleno: string;
  /** Contornos de cada nivel (casing oscuro + trazo claro); van recortados a la cuenca, ENCIMA de ríos y municipios. */
  contornos: string;
}

const n2 = (x: number) => x.toFixed(2);
const ruta = (anillos: Anillo[], p: ProyectorMapa) => anillos.map((r) => r.map(([lo, la], i) => `${i ? 'L' : 'M'}${n2(p.x(lo))},${n2(p.y(la))}`).join('') + 'Z').join('');

/**
 * SVG del campo en el proyector `p` del mapa. Los trazos son de pantalla (`vector-effect: non-scaling-stroke` en el CSS del mapa): al acercar no engordan ni adelgazan.
 * Con `motivoSD` el modelo no trae bandas y el resultado es vacío (el componente rotula el S/D).
 */
export function campoSvg(m: PlanoModelo, p: ProyectorMapa, op: EntradaCampoSvg): CampoSvg {
  if (m.motivoSD || m.bandas.length === 0) return { relleno: '', contornos: '' };
  const partes: string[] = [`<rect width="${p.ancho}" height="${p.alto}" fill="${colorPantalla(m.colorBase)}"/>`];
  for (const b of m.bandas) partes.push(`<path d="${ruta(b.anillos, p)}" fill="${colorPantalla(b.color)}" fill-rule="evenodd"/>`);
  if (m.sinCobertura.length) {
    const d = m.sinCobertura.map(([x0, y0, x1, y1]) => `M${n2(p.x(x0))},${n2(p.y(y1))}H${n2(p.x(x1))}V${n2(p.y(y0))}H${n2(p.x(x0))}Z`).join('');
    partes.push(`<path d="${d}" fill="${FONDO_MAPA}" fill-opacity="0.78"/><path d="${d}" fill="url(#${op.idTrama})"/>`);
  }
  const relleno = `<g opacity="${op.opacidad}">${partes.join('')}</g>`;
  // Casing + trazo: el contorno se lee sobre cualquier color de relleno. Una sola ruta por nivel.
  const contornos = m.bandas.map((b) => {
    const d = ruta(b.anillos, p);
    return `<path d="${d}" fill="none" stroke="${CASING}" stroke-opacity="0.55" stroke-width="2.8" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="1" stroke-linejoin="round"/>`;
  }).join('');
  return { relleno, contornos };
}

export interface ClaseLeyenda { color: string; desde: number | null; hasta: number | null }
/** Clases de la leyenda con la MISMA rampa y niveles que el relleno: «< n0», «n0–n1», …, «≥ nk». */
export function leyendaCampo(m: PlanoModelo): ClaseLeyenda[] {
  const cols = paletaPantalla(m.variable, m.niveles.length);
  return cols.map((color, k) => ({ color, desde: k === 0 ? null : m.niveles[k - 1], hasta: k === m.niveles.length ? null : m.niveles[k] }));
}

export interface ValorEnPunto { valor: number | null; dentro: boolean; cubierta: boolean }

/**
 * Valor INTERPOLADO del campo en (lon, lat): bilineal entre los 4 nodos de la malla. S/D (null, nunca 0) fuera de la cuenca, a más de 90 km de una estación
 * (celda sin cobertura) o fuera de la malla. Es una estimación (IDW), no una medición: la incertidumbre crece lejos de las estaciones.
 */
export function valorEnCampo(c: CampoCuenca, lon: number, lat: number): ValorEnPunto {
  const m = c.malla;
  const fi = (lon - m.lon0) / m.paso, fj = (m.lat1 - lat) / m.paso;
  if (!(fi >= 0 && fj >= 0 && fi <= m.nx - 1 && fj <= m.ny - 1)) return { valor: null, dentro: false, cubierta: false };
  const ni = Math.min(m.nx - 1, Math.round(fi)), nj = Math.min(m.ny - 1, Math.round(fj));
  const k = nj * m.nx + ni;
  const dentro = c.dentro[k] === 1, cubierta = c.cubierta[k] === 1;
  if (!dentro || !cubierta) return { valor: null, dentro, cubierta };
  const i0 = Math.min(m.nx - 2, Math.floor(fi)), j0 = Math.min(m.ny - 2, Math.floor(fj));
  const tx = fi - i0, ty = fj - j0;
  const v = (i: number, j: number) => m.valores[j * m.nx + i];
  const a = v(i0, j0), b = v(i0 + 1, j0), cc = v(i0, j0 + 1), d = v(i0 + 1, j0 + 1);
  const val = [a, b, cc, d].every(Number.isFinite)
    ? a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + cc * (1 - tx) * ty + d * tx * ty
    : v(ni, nj);
  return { valor: Number.isFinite(val) ? val : null, dentro, cubierta };
}

/** Inversa lineal del proyector (equirectangular): de coordenadas del mapa (px sin zoom) a lon/lat. */
export function lonLatDe(p: ProyectorMapa, x: number, y: number): { lon: number; lat: number } {
  const x0 = p.x(0), y0 = p.y(0), bx = p.x(1) - x0, by = p.y(1) - y0;
  return { lon: (x - x0) / bx, lat: (y - y0) / by };
}
