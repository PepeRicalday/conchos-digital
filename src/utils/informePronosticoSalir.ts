// Infografías del nivel Básico: "¿Cuándo salir?" (semáforo hora por hora + mejor ventana) y escalas de lluvia y viento.
// Lógica pura y SVG como string: se prueba sin navegador. Regla de veracidad: sin dato de lluvia NO es "buen momento".
import { esNoche, horaLocal } from './informePronosticoSvg';
import { fmtDia, fmtHora, type DatosPronostico } from './informePronosticoDatos';

export type NivelSalir = 'bueno' | 'cuidado' | 'evitar' | 'sin';
export interface HoraSemaforo { ts: number; nivel: NivelSalir; diurna: boolean }
export interface UmbralesSalir { vientoAvisoMs: number; vientoCriticoMs: number }
export interface Ventana { desdeMs: number; hastaMs: number; horas: number }

export const COLOR_SALIR: Record<NivelSalir, string> = { bueno: '#4ade80', cuidado: '#fbbf24', evitar: '#f87171', sin: '#e2e8f0' };
export const ROTULO_SALIR: Record<NivelSalir, string> = { bueno: 'Buen momento', cuidado: 'Con cuidado', evitar: 'Mejor evitar', sin: 'Sin información' };
const HORA = 3_600_000;

/**
 * Nivel de cada hora del horizonte, el más desfavorable entre los módulos:
 *   evitar  = lluvia probable (≥ 60 %) o apreciable (≥ 2.5 mm/h) o viento en umbral crítico;
 *   cuidado = lluvia posible (≥ 30 %) o cualquier lámina (≥ 0.2 mm/h) o viento en umbral de aviso;
 *   bueno   = el resto. Sin probabilidad de lluvia en ningún módulo → 'sin' (no se asume "seco").
 */
export function semaforoHoras(d: DatosPronostico, u: UmbralesSalir): HoraSemaforo[] {
    return d.ejeHoras.map(ts => {
        let prob: number | null = null, mm = 0, viento: number | null = null;
        for (const m of d.modulos) {
            const h = m.horas.find(x => x.ts === ts);
            if (!h) continue;
            if (h.probPct != null) prob = Math.max(prob ?? 0, h.probPct);
            if (h.precipMm != null) mm = Math.max(mm, h.precipMm);
            if (h.vientoMs != null) viento = Math.max(viento ?? 0, h.vientoMs);
        }
        const diurna = !esNoche(ts);
        if (prob == null) return { ts, nivel: 'sin' as const, diurna };
        if (prob >= 60 || mm >= 2.5 || (viento != null && viento >= u.vientoCriticoMs)) return { ts, nivel: 'evitar' as const, diurna };
        if (prob >= 30 || mm >= 0.2 || (viento != null && viento >= u.vientoAvisoMs)) return { ts, nivel: 'cuidado' as const, diurna };
        return { ts, nivel: 'bueno' as const, diurna };
    });
}

/** Tramo continuo más largo (≥ minHoras) de horas con `nivel`; si `soloDia`, solo horas de día. Empate: el más cercano. */
export function tramoMasLargo(horas: HoraSemaforo[], nivel: NivelSalir, soloDia: boolean, minHoras = 2): Ventana | null {
    let mejor: Ventana | null = null, ini: number | null = null, prev = 0, n = 0;
    const cierra = () => { if (ini != null && n >= minHoras && (!mejor || n > mejor.horas)) mejor = { desdeMs: ini, hastaMs: prev + HORA, horas: n }; ini = null; n = 0; };
    for (const h of horas) {
        const ok = h.nivel === nivel && (!soloDia || h.diurna);
        if (ok && ini != null && h.ts - prev === HORA) { n++; prev = h.ts; continue; }
        cierra();
        if (ok) { ini = h.ts; prev = h.ts; n = 1; }
    }
    cierra();
    return mejor;
}

export const textoVentana = (v: Ventana) => `${fmtDia(v.desdeMs)}, de ${fmtHora(v.desdeMs)} a ${fmtHora(v.hastaMs)} h`;

/** Frase para la infografía: mejor ventana de día sin lluvia ni viento fuerte, y el tramo a evitar más largo. */
export function resumenSalir(horas: HoraSemaforo[]): { mejor: string; evitar: string | null } {
    const hayInfo = horas.some(h => h.nivel !== 'sin');
    if (!hayInfo) return { mejor: 'Sin información suficiente del pronóstico para recomendar un horario.', evitar: null };
    const mejor = tramoMasLargo(horas, 'bueno', true);
    const evitar = tramoMasLargo(horas, 'evitar', false, 1);
    return {
        mejor: mejor
            ? `Mejor momento para salir (de día, sin lluvia ni viento fuerte): ${textoVentana(mejor)}.`
            : 'En las próximas horas no hay un tramo largo de día sin lluvia posible o viento notable: salga con cuidado.',
        evitar: evitar ? `Mejor evitar salir: ${textoVentana(evitar)}.` : null,
    };
}

/** Semáforo hora por hora: una celda por hora, franja día/noche arriba, hora cada 6 h. */
export function semaforoSvg(horas: HoraSemaforo[], ancho = 480): string {
    if (horas.length < 2) return '';
    const ML = 8, MR = 8, MT = 22, FILA = 34, MB = 30;
    const iw = ancho - ML - MR, cw = iw / horas.length, H = MT + FILA + MB;
    const franja = horas.map((h, i) => `<rect x="${(ML + i * cw).toFixed(1)}" y="${MT - 12}" width="${(cw + 0.4).toFixed(1)}" height="7" fill="${esNoche(h.ts) ? '#475569' : '#fde68a'}"/>`).join('');
    const celdas = horas.map((h, i) => {
        const x = ML + i * cw;
        const relleno = h.nivel === 'sin' ? 'url(#sal-sin)' : COLOR_SALIR[h.nivel];
        return `<rect x="${x.toFixed(1)}" y="${MT}" width="${(cw - 0.8).toFixed(1)}" height="${FILA}" fill="${relleno}"/>`;
    }).join('');
    const eje = horas.map((h, i) => {
        const hr = horaLocal(h.ts);
        if (hr % 6 !== 0 && i !== 0) return '';
        const x = ML + (i + 0.5) * cw;
        const dia = hr === 0 ? `<text x="${x.toFixed(1)}" y="${MT + FILA + 26}" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" font-family="system-ui">${fmtDia(h.ts)}</text>` : '';
        return `<text x="${x.toFixed(1)}" y="${MT + FILA + 13}" text-anchor="middle" font-size="11" font-weight="600" fill="#475569" font-family="system-ui">${String(hr).padStart(2, '0')}:00</text>${dia}`;
    }).join('');
    const resumen = `Semáforo por hora: ${horas.filter(h => h.nivel === 'bueno').length} horas buenas, ${horas.filter(h => h.nivel === 'cuidado').length} con cuidado, ${horas.filter(h => h.nivel === 'evitar').length} a evitar y ${horas.filter(h => h.nivel === 'sin').length} sin información.`;
    return `<svg viewBox="0 0 ${ancho} ${H}" width="100%" role="img" aria-label="${resumen}">
  <defs><pattern id="sal-sin" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f8fafc"/><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" stroke-width="1.5"/></pattern></defs>
  ${franja}${celdas}${eje}
  <rect x="${ML}" y="${MT - 2}" width="2.5" height="${FILA + 4}" fill="#0f172a"/><text x="${ML + 6}" y="${MT - 14}" font-size="10" font-weight="800" fill="#0f172a" font-family="system-ui">AHORA</text>
</svg>`;
}

interface TramoEscala { hasta: number; color: string; texto: string }
/** Barra de escala con marcador del máximo previsto. `tope` es el valor del extremo derecho de la barra. */
function barraEscala(titulo: string, unidad: string, tramos: TramoEscala[], tope: number, valor: number | null, y0: number, ancho: number, dec: number): string {
    const ML = 8, iw = ancho - 16, BH = 22;
    const x = (v: number) => ML + (Math.min(Math.max(v, 0), tope) / tope) * iw;
    let desde = 0;
    const segs = tramos.map(t => {
        const x1 = x(desde), x2 = x(Math.min(t.hasta, tope)); desde = Math.min(t.hasta, tope);
        return `<rect x="${x1.toFixed(1)}" y="${y0 + 20}" width="${(x2 - x1).toFixed(1)}" height="${BH}" fill="${t.color}"/>`
            + `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y0 + 20 + BH + 14}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155" font-family="system-ui">${t.texto}</text>`;
    }).join('');
    const marca = valor == null
        ? `<text x="${ancho - 8}" y="${y0 + 12}" text-anchor="end" font-size="12" font-weight="700" fill="#475569" font-family="system-ui">Máximo previsto: sin información</text>`
        : `<path d="M${x(valor).toFixed(1)} ${y0 + 20} l-6 -9 h12 z" fill="#0f172a"/><text x="${Math.min(Math.max(x(valor), 60), ancho - 60).toFixed(1)}" y="${y0 + 7}" text-anchor="middle" font-size="12" font-weight="800" fill="#0f172a" font-family="system-ui">Máximo previsto: ${valor.toFixed(dec)} ${unidad}</text>`;
    return `<text x="${ML}" y="${y0 - 6}" font-size="14" font-weight="800" fill="#0f172a" font-family="system-ui">${titulo}</text>${segs}${marca}`;
}

/** Escalas de referencia (lluvia por hora y viento) con el máximo previsto marcado. Mismos cortes que el resto del informe. */
export function escalasSvg(o: { maxMmh: number | null; maxKmh: number | null }, ancho = 480): string {
    const lluvia = barraEscala('Lluvia por hora', 'mm/h', [
        { hasta: 2.5, color: '#dbeafe', texto: 'Ligera' }, { hasta: 7.6, color: '#93c5fd', texto: 'Moderada' }, { hasta: 12, color: '#2563eb', texto: 'Fuerte' },
    ], 12, o.maxMmh, 30, ancho, 1);
    const viento = barraEscala('Viento', 'km/h', [
        { hasta: 20, color: '#d1fae5', texto: 'Brisa' }, { hasta: 36, color: '#6ee7b7', texto: 'Se nota' }, { hasta: 54, color: '#f59e0b', texto: 'Fuerte' }, { hasta: 70, color: '#dc2626', texto: 'Muy fuerte' },
    ], 70, o.maxKmh, 130, ancho, 0);
    return `<svg viewBox="0 0 ${ancho} 200" width="100%" role="img" aria-label="Escalas de lluvia por hora y de viento${o.maxMmh != null ? `; lluvia máxima prevista ${o.maxMmh.toFixed(1)} mm por hora` : ''}${o.maxKmh != null ? `; viento máximo previsto ${o.maxKmh.toFixed(0)} kilómetros por hora` : ''}">${lluvia}${viento}</svg>`;
}
