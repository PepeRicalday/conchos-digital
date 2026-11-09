// ═══════════════════════════════════════════════════════════════════════════
// Informe Geoclimático — sección «Cuenca del Conchos» (alcance «Distrito y toda la cuenca») — puro
// ---------------------------------------------------------------------------
// El informe sigue siendo el de los 6 módulos; con alcance «cuenca» se AÑADE esta sección con un plano por variable (lluvia, temperatura,
// viento) de toda la cuenca, usando los mismos modelos y el mismo dibujo que la vista Cuenca (planosDatos → construirPlano → planoSvg):
// las cifras nunca divergen. Fuente: red JCAS/UACJ (+ lluvia de las estaciones propias), CONTEXTO provisional, S/D nunca 0.
// La radiación solar no tiene red en la cuenca: se declara, no se rellena.
// ═══════════════════════════════════════════════════════════════════════════
import type { ContornoCuenca } from './geoCuenca';
import type { DemGrid } from './camposCuenca';
import { anioInicioCiclo } from './analiticaPresas';
import { arealDe, cuandoVentana, type ModeloRedJcas, type VentanaObs } from './jcasModelo';
import { VARIABLES_PLANO, type VariablePlano } from './paletasClima';
import { construirPlano, planoSvg } from './planosCuenca';
import { puntosObservados } from './planosDatos';
import { esc } from './informeBase';
import type { CapaId, DatosCapas } from './capasCuenca';

export type ClaveGeo = 'tempC' | 'vientoMs' | 'radSolarWm2' | 'lluviaDiaMm';
const A_PLANO: Partial<Record<ClaveGeo, VariablePlano>> = { lluviaDiaMm: 'lluvia', tempC: 'temperatura', vientoMs: 'viento' };
const ORDEN: ClaveGeo[] = ['lluviaDiaMm', 'tempC', 'vientoMs', 'radSolarWm2'];

const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Ventana de la cuenca para el periodo del informe. Hay ventanas de hoy, ayer, 7, 30, 60 y 90 días y el ciclo agrícola en curso; se elige la que
 * coincide con el periodo pedido y, si ninguna, la más cercana, y se DECLARA (`exacta` = false). Sin periodo = hoy (parcial).
 */
export function ventanaParaPeriodo(desde: string | undefined, hasta: string | undefined, hoyLocal: string): { ventana: VentanaObs; exacta: boolean; motivo: string | null } {
    if (!desde || !hasta) return { ventana: 'hoy', exacta: true, motivo: null };
    const ayer = ISO(Date.parse(`${hoyLocal}T00:00:00Z`) - 86_400_000);
    const n = diasEntre(desde, hasta);
    if (desde === hasta && hasta >= hoyLocal) return { ventana: 'hoy', exacta: true, motivo: null };
    if (desde === hasta && hasta === ayer) return { ventana: 1, exacta: true, motivo: null };
    const terminaAyerOHoy = hasta >= ayer;
    const iniCiclo = `${anioInicioCiclo(hoyLocal)}-10-01`;
    if (terminaAyerOHoy && desde === iniCiclo && iniCiclo <= ayer) return { ventana: 'ciclo', exacta: true, motivo: null };
    for (const w of [7, 30, 60, 90] as const) if (n === w && terminaAyerOHoy) return { ventana: w, exacta: true, motivo: null };
    const v: VentanaObs = n <= 7 ? 7 : n <= 30 ? 30 : n <= 60 ? 60 : n <= 90 ? 90 : 'ciclo';
    return { ventana: v, exacta: false, motivo: `La red de la cuenca tiene ventanas de 7, 30, 60 y 90 días y del ciclo agrícola: se usa la ventana más cercana a ${n} ${n === 1 ? 'día' : 'días'} (${cuandoVentana(v)}).` };
}

export interface EntradaGeoCuenca {
    red: ModeloRedJcas | null;
    contorno: ContornoCuenca | null;
    dem: DemGrid | null;
    variables: ClaveGeo[];
    periodoDesde?: string;
    periodoHasta?: string;
    /** Fecha local de hoy (YYYY-MM-DD). */
    hoy: string;
    /** Capas de referencia elegidas y sus datos ya cargados (sin ellas, los planos salen sin capas). */
    capas?: { ids: CapaId[]; datos: DatosCapas };
}

const fmt = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? 'S/D' : v.toFixed(d));

/** HTML de la sección. Si no hay red o contorno, devuelve una sección con S/D explícito (nunca se omite en silencio). */
export function seccionCuencaGeo(e: EntradaGeoCuenca): string {
    const { ventana, exacta, motivo } = ventanaParaPeriodo(e.periodoDesde, e.periodoHasta, e.hoy);
    const sel = ORDEN.filter((k) => e.variables.includes(k));
    const cab = `<h2 class="geoinf-grupo-titulo">Cuenca del Conchos</h2>`;
    if (!e.red || !e.contorno) {
        return `<section class="geoinf-cuenca">${cab}<p class="geoinf-grupo-sub">Sin datos de la red de estaciones de la cuenca (S/D): no se pudieron cargar las estaciones JCAS en este momento. El resto del informe (distrito) no se ve afectado.</p></section>`;
    }
    const red = e.red, contorno = e.contorno;
    const figuras = sel.map((k) => {
        const v = A_PLANO[k];
        if (!v) {
            return `<figure class="geoinf-cu-fig"><figcaption><b>Radiación solar</b></figcaption><p class="geoinf-cu-sd">S/D en la cuenca: JCAS no mide radiación solar y no se estima. Los módulos del distrito sí la muestran arriba.</p></figure>`;
        }
        const plano = construirPlano({ variable: v, periodo: { tipo: 'obs', dias: ventana }, puntos: puntosObservados(red, v, ventana), contorno, dem: e.dem, areal: v === 'lluvia' ? arealDe(red, ventana) : null });
        const cfg = VARIABLES_PLANO[v];
        const dec = v === 'temperatura' || (plano.resumen.media != null && plano.resumen.media < 10) ? 1 : 0;
        const svg = planoSvg(plano, contorno, { tema: 'papel', idPrefijo: `gcu-${v}`, textoPx: 11, descripcion: plano.titulo, capas: e.capas && e.capas.ids.length ? e.capas : undefined });
        const res = plano.motivoSD
            ? `<b>S/D</b> — ${esc(plano.motivoSD)}`
            : `Promedio de la cuenca <b>${fmt(plano.resumen.media, dec)} ${esc(cfg.unidad)}</b> · rango ${fmt(plano.resumen.min, 0)}–${fmt(plano.resumen.max, 0)} · n = ${plano.resumen.n} estaciones · cobertura ${plano.resumen.coberturaPct.toFixed(0)} % del área${plano.resumen.maxEn ? ` · mayor: ${esc(plano.resumen.maxEn.nombre)}, ${fmt(plano.resumen.maxEn.valor, dec)} ${esc(cfg.unidad)}` : ''}`;
        const excl = plano.excluidos.length ? `<p class="geoinf-cu-nota">Excluida del plano: ${esc(plano.excluidos.map((p) => p.nombre).join(', '))} (pluviómetro sospechoso).</p>` : '';
        return `<figure class="geoinf-cu-fig"><figcaption><b>${esc(plano.titulo)}</b></figcaption>${svg}<p class="geoinf-cu-res">${res}</p>${excl}</figure>`;
    }).join('');
    const parcial = ventana === 'hoy'
        ? `El día en curso es <b>parcial</b>${red.fechaHoy ? ` (lectura del ${esc(red.fechaHoy)})` : ' y todavía no tiene lectura (S/D)'}.`
        : `Días completos al ${esc(red.fin)}.`;
    return `<section class="geoinf-cuenca">
  <style>
    .geoinf-cuenca{margin-top:22px;break-inside:avoid-page}
    .geoinf-cu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:10px}
    .geoinf-cu-fig{margin:0;border:1px solid #d6dde6;border-radius:10px;padding:10px 12px;background:#fff;break-inside:avoid}
    .geoinf-cu-fig figcaption{font-size:13px;margin-bottom:6px;color:#0E1B2C}
    .geoinf-cu-res,.geoinf-cu-nota,.geoinf-cu-sd{font-size:12px;line-height:1.4;margin:6px 0 0;color:#33465c}
    .geoinf-cu-aviso{font-size:12px;line-height:1.45;border-left:3px solid #c8962a;padding:6px 10px;background:#fbf6ea;margin:8px 0;color:#4a3a12}
  </style>
  ${cab}
  <p class="geoinf-grupo-sub">Planos de toda la cuenca (INEGI-CONAGUA, cuencas J–N de la RH24) con la red de estaciones JCAS/UACJ y, en lluvia, también las estaciones propias del distrito: ${esc(cuandoVentana(ventana))}. ${parcial} Dato provisional de contexto; no sustituye las mediciones oficiales.</p>
  ${motivo && !exacta ? `<p class="geoinf-cu-aviso">${esc(motivo)}</p>` : ''}
  <div class="geoinf-cu-grid">${figuras}</div>
  <p class="geoinf-cu-nota">Interpolación por inverso de la distancia al cuadrado limitada a 90 km de cada estación; donde no hay estación a esa distancia el plano queda con trama y no entra a los promedios. Con menos de 5 estaciones útiles o menos del 50 % del área cubierta el plano es S/D. Las estaciones de una misma ciudad pesan una vez. Viento en km/h (velocidad media; JCAS no entrega dirección).</p>
</section>`;
}
