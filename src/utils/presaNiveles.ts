/**
 * presaNiveles — lógica PURA del modal "Manejo de vaso" (sin React ni Supabase): cotas, interpolación en la curva,
 * déficit bajo el NAMO, clasificación del estado del embalse, tendencia real del nivel y conciliación de superficies.
 * Una sola definición de los umbrales de estado (antes repetidos en 4 sitios con valores distintos 20/30/40) y de los
 * mensajes (antes "estable" era texto fijo). S/D nunca es 0: sin dato se devuelve null.
 */
import { COTAS_OFICIALES } from './cotasPresas';

// ── Estado del embalse ───────────────────────────────────────────────────────
/** % de llenado por debajo del cual el embalse es CRÍTICO. */
export const UMBRAL_CRITICO_PCT = 20;
/** % de llenado por debajo del cual el embalse es BAJO (y por encima, NORMAL). */
export const UMBRAL_BAJO_PCT = 40;

export type ClaveEstado = 'sd' | 'crit' | 'warn' | 'ok';
export interface EstadoEmbalse { clave: ClaveEstado; etiqueta: string }

export function estadoEmbalse(pct: number | null | undefined): EstadoEmbalse {
    if (pct == null || !Number.isFinite(pct)) return { clave: 'sd', etiqueta: 'S/D' };
    if (pct < UMBRAL_CRITICO_PCT) return { clave: 'crit', etiqueta: 'CRÍTICO' };
    if (pct < UMBRAL_BAJO_PCT) return { clave: 'warn', etiqueta: 'BAJO' };
    return { clave: 'ok', etiqueta: 'NORMAL' };
}

// ── Cotas ────────────────────────────────────────────────────────────────────
export interface CotasPresa { namo: number | null; name: number | null; muerta: number | null; fondo: number | null }

/** NAMO / NAME / capacidad muerta oficiales (cotasPresas.ts). El NAMO NO es la corona: así se nombra aquí y en pantalla. */
export function cotasDePresa(presaId: string): CotasPresa {
    const c = COTAS_OFICIALES[presaId];
    if (!c) return { namo: null, name: null, muerta: null, fondo: null };
    const elev = (label: string) => c.cotas.find((x) => x.label === label)?.elev ?? null;
    return { namo: elev('NAMO'), name: elev('NAME'), muerta: elev('Capacidad muerta'), fondo: c.fondo };
}

/** Metros que faltan para el NAMO (positivo = por debajo del NAMO). null si falta el nivel o la cota. */
export function deficitBajoNamo(nivel: number | null | undefined, namo: number | null | undefined): number | null {
    if (nivel == null || namo == null || !Number.isFinite(nivel) || !Number.isFinite(namo)) return null;
    return namo - nivel;
}

// ── Curva elevación–volumen–área ─────────────────────────────────────────────
export interface PuntoCurva { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

function interpola(curva: PuntoCurva[] | undefined, elevacion: number, campo: 'volumen_mm3' | 'area_ha'): number | null {
    if (!curva || curva.length < 2 || !Number.isFinite(elevacion)) return null;
    const pts = [...curva].sort((a, b) => a.elevacion_msnm - b.elevacion_msnm);
    const val = (p: PuntoCurva) => p[campo];
    if (elevacion <= pts[0].elevacion_msnm) return val(pts[0]);
    if (elevacion >= pts[pts.length - 1].elevacion_msnm) return val(pts[pts.length - 1]);
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (elevacion >= a.elevacion_msnm && elevacion <= b.elevacion_msnm) {
            const va = val(a), vb = val(b);
            if (va == null || vb == null) return null;
            const t = (elevacion - a.elevacion_msnm) / (b.elevacion_msnm - a.elevacion_msnm);
            return va + t * (vb - va);
        }
    }
    return null;
}

/** Volumen (Mm³) a una elevación según la curva de la presa; sin curva → null (nunca un factor inventado). */
export const volumenPorElevacion = (curva: PuntoCurva[] | undefined, elevacion: number): number | null => interpola(curva, elevacion, 'volumen_mm3');

/** Superficie (km²) del espejo de agua a una elevación según la curva (area_ha / 100). */
export function areaKm2PorElevacion(curva: PuntoCurva[] | undefined, elevacion: number): number | null {
    const ha = interpola(curva, elevacion, 'area_ha');
    return ha == null ? null : ha / 100;
}

// ── Tendencia real del nivel ─────────────────────────────────────────────────
export type DireccionNivel = 'sube' | 'baja' | 'estable' | 'sd';
export interface TendenciaNivel { mPorDia: number | null; dias: number | null; direccion: DireccionNivel }

/** Variación diaria por debajo de la cual se considera estable (m/día). */
export const NIVEL_ESTABLE_M_DIA = 0.02;

const diasEntre = (a: string, b: string) => (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000;

/** Tendencia entre la lectura más reciente y la más antigua dentro de `maxDias` días antes (mayor base = menos ruido). */
export function tendenciaNivel(lecturas: { fecha: string; escala_msnm: number | null }[], maxDias = 7): TendenciaNivel {
    const v = lecturas.filter((l): l is { fecha: string; escala_msnm: number } => l.escala_msnm != null && Number.isFinite(l.escala_msnm)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    if (v.length < 2) return { mPorDia: null, dias: null, direccion: 'sd' };
    const ult = v[v.length - 1];
    const previas = v.slice(0, -1).filter((l) => { const d = diasEntre(l.fecha.slice(0, 10), ult.fecha.slice(0, 10)); return d >= 1 && d <= maxDias; });
    if (!previas.length) return { mPorDia: null, dias: null, direccion: 'sd' };
    const base = previas[0];
    const dias = diasEntre(base.fecha.slice(0, 10), ult.fecha.slice(0, 10));
    const m = (ult.escala_msnm - base.escala_msnm) / dias;
    return { mPorDia: m, dias, direccion: Math.abs(m) < NIVEL_ESTABLE_M_DIA ? 'estable' : m > 0 ? 'sube' : 'baja' };
}

// ── Mensaje de estado (derivado de datos, nunca texto fijo) ─────────────────
export interface MensajeEstado { severidad: ClaveEstado | 'info'; titulo: string; detalle: string }

const m2 = (v: number) => v.toFixed(2);

export function mensajeEstado(p: {
    tieneNivel: boolean; estado: EstadoEmbalse; deficitM: number | null; tendencia: TendenciaNivel;
    simulado: boolean; deltaSimM: number | null;
}): MensajeEstado {
    if (!p.tieneNivel) return { severidad: 'sd', titulo: 'Sin lectura de nivel', detalle: 'Todavía no hay una lectura de nivel del día: las cifras aparecen como S/D.' };
    if (p.simulado) {
        const d = p.deltaSimM ?? 0;
        return { severidad: 'info', titulo: 'Simulación activa', detalle: `${d >= 0 ? '+' : '−'}${m2(Math.abs(d))} m sobre la lectura base de hoy. El déficit bajo el NAMO y el volumen se recalculan.` };
    }
    const titulo = p.estado.clave === 'ok' ? 'Embalse en nivel normal' : p.estado.clave === 'warn' ? 'Embalse bajo' : p.estado.clave === 'crit' ? 'Embalse en nivel crítico' : 'Estado sin clasificar';
    const partes: string[] = [];
    if (p.deficitM != null) partes.push(p.deficitM > 0 ? `${m2(p.deficitM)} m por debajo del NAMO` : `${m2(Math.abs(p.deficitM))} m sobre el NAMO`);
    const t = p.tendencia;
    if (t.direccion === 'sube' && t.mPorDia != null) partes.push(`nivel subiendo +${m2(t.mPorDia)} m/día (${t.dias} d)`);
    else if (t.direccion === 'baja' && t.mPorDia != null) partes.push(`nivel bajando −${m2(Math.abs(t.mPorDia))} m/día (${t.dias} d)`);
    else if (t.direccion === 'estable') partes.push(`nivel estable (${t.dias} d)`);
    else partes.push('tendencia sin datos suficientes');
    return { severidad: p.estado.clave, titulo, detalle: partes.join(' · ') };
}

// ── Conciliación de superficies ──────────────────────────────────────────────
export interface FuenteSuperficie {
    clave: 'curva' | 'sentinel' | 'visual';
    etiqueta: string;
    km2: number;
    detalle: string;
    /** true = medición validada (curva oficial / Sentinel-2 multiespectral); false = estimación visual. */
    validada: boolean;
    /** Diferencia contra la curva oficial, en %. null para la propia curva o si no hay curva. */
    difVsCurvaPct: number | null;
}

export function conciliaSuperficie(p: {
    curvaKm2: number | null;
    sentinel: { km2: number; fecha: string; nubesPct: number | null } | null;
    visual: { km2: number; cobertura: number } | null;
}): FuenteSuperficie[] {
    const dif = (km2: number) => (p.curvaKm2 != null && p.curvaKm2 > 0 ? ((km2 - p.curvaKm2) / p.curvaKm2) * 100 : null);
    const out: FuenteSuperficie[] = [];
    if (p.curvaKm2 != null) out.push({ clave: 'curva', etiqueta: 'Curva oficial al nivel actual', km2: p.curvaKm2, detalle: 'Batimetría 2020 (elevación → área)', validada: true, difVsCurvaPct: null });
    if (p.sentinel) out.push({ clave: 'sentinel', etiqueta: 'Sentinel-2 (NDWI)', km2: p.sentinel.km2, detalle: `Escena del ${new Date(p.sentinel.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Chihuahua" })}${p.sentinel.nubesPct != null ? ` · ${p.sentinel.nubesPct.toFixed(1)} % de nubes` : ''}`, validada: true, difVsCurvaPct: dif(p.sentinel.km2) });
    if (p.visual) out.push({ clave: 'visual', etiqueta: 'Estimación visual de hoy', km2: p.visual.km2, detalle: `ArcGIS World Imagery, sin infrarrojo · cobertura ${(p.visual.cobertura * 100).toFixed(0)} %`, validada: false, difVsCurvaPct: dif(p.visual.km2) });
    return out;
}

/** El dato trae comillas literales (PRESA LA "BOQUILLA"): fuera del título. */
export const sinComillas = (s: string): string => s.replace(/["“”«»]/g, '').replace(/\s{2,}/g, ' ').trim();
