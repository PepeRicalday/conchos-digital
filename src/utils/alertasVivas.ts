/**
 * alertasVivas — alertas que el Dashboard calcula con los datos actuales (tomas varadas, fugas, sobregiros, nivel de
 * presas, protocolo prolongado, predictivas). Antes vivían dentro del componente de 1,100 líneas, sin pruebas.
 * Pura: recibe la hora actual, no la lee.
 */
import { porcentajeLlenadoPresa, type PresaLike } from './presaMetrics';
import {
    UMBRAL_PERDIDA_M3S, UMBRAL_DIAS_PROTOCOLO, EFICIENCIA_TRAMO_MIN_PCT, PRESA_ALTA_PCT, PRESA_BAJA_PCT,
    TOLERANCIA_SOBREGIRO, TOLERANCIA_SOBREGIRO_LLENADO, type AlertaSistema,
} from './dashboardKpis';

export interface TomaVaradaEntrada { punto_id: string; punto_nombre: string; ultimo_estado: string; dias_varada: number | string }
export interface TramoEntrada {
    tramo_inicio?: string | null; tramo_fin?: string | null; km_inicio?: number | null;
    eficiencia_pct: number | null; q_perdida: number | null;
}
export interface ModuloEntrada { id: string; name: string; current_flow: number; target_flow: number }
export interface PresaEntrada extends PresaLike { id: string; nombre: string }
export interface ProtocoloEntrada { id: string; evento_tipo: string; fecha_inicio?: string | null }

export interface EntradaAlertas {
    tomasVaradas: TomaVaradaEntrada[];
    tramos: TramoEntrada[];
    modulos: ModuloEntrada[];
    presas: PresaEntrada[];
    protocolo: ProtocoloEntrada | null;
    predictivas: AlertaSistema[];
    ahoraMs: number;
}

/** Nombre legible de un tramo (la vista no siempre trae tramo_inicio). */
export function nombrarTramo(s: { tramo_inicio?: string | null; tramo_fin?: string | null; km_inicio?: number | null }): string {
    const km = s.km_inicio != null ? `KM ${s.km_inicio.toFixed(1)}` : 'KM s/d';
    if (s.tramo_inicio && s.tramo_fin) return `Tramo ${s.tramo_inicio} → ${s.tramo_fin}`;
    if (s.tramo_inicio) return `Tramo ${s.tramo_inicio} (${km})`;
    return `Tramo ${km}`;
}

export function diasDesde(iso: string | null | undefined, ahoraMs: number): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? Math.floor((ahoraMs - t) / 86_400_000) : null;
}

export function construyeAlertasVivas(e: EntradaAlertas): AlertaSistema[] {
    const alertas: AlertaSistema[] = [];
    const llenado = e.protocolo?.evento_tipo === 'LLENADO';

    // 1. Continuidad: tomas varadas
    for (const tv of e.tomasVaradas) {
        alertas.push({
            id: `varada-${tv.punto_id}`, type: 'critical', title: 'Toma Varada (Falla de Continuidad)',
            message: `${tv.punto_nombre}: Estado "${tv.ultimo_estado}" hace ${tv.dias_varada} días. Se requiere intervención diagnóstica.`,
            timestamp: 'Crítico',
        });
    }

    // 2. Pérdidas en tramos: se exige pérdida MATERIAL; sin medición de pérdida (null) se dice S/D, no "0.00"
    for (const s of e.tramos.filter((t) => (t.eficiencia_pct ?? 100) < EFICIENCIA_TRAMO_MIN_PCT)) {
        const perdida = s.q_perdida;
        const nombre = nombrarTramo(s);
        const ef = s.eficiencia_pct != null ? s.eficiencia_pct.toFixed(1) : 'S/D';
        if (perdida != null && perdida >= UMBRAL_PERDIDA_M3S) {
            alertas.push({
                id: `leak-${s.km_inicio}`, type: 'critical', title: 'Pérdida Crítica / Posible Fuga',
                message: `${nombre}: Eficiencia ${ef}% — pérdida de ${perdida.toFixed(2)} m³/s. Requiere inspección.`, timestamp: 'Ahora',
            });
        } else {
            alertas.push({
                id: `leak-info-${s.km_inicio}`, type: 'info', title: 'Eficiencia Baja sin Pérdida Medible',
                message: perdida != null
                    ? `${nombre}: Eficiencia ${ef}% con pérdida ${perdida.toFixed(2)} m³/s (bajo umbral de ${UMBRAL_PERDIDA_M3S} m³/s). Posible error de aforo.`
                    : `${nombre}: Eficiencia ${ef}% y pérdida sin medición (S/D). Verificar aforos de entrada y salida.`,
                timestamp: 'Ahora',
            });
        }
    }

    // 3. Sobregiros en módulos (en LLENADO los gastos son erráticos: se tolera más)
    const tolerancia = llenado ? TOLERANCIA_SOBREGIRO_LLENADO : TOLERANCIA_SOBREGIRO;
    for (const m of e.modulos) {
        if (m.target_flow > 0 && m.current_flow > m.target_flow * tolerancia) {
            alertas.push({
                id: `ovf-${m.id}`, type: 'warning', title: 'Sobregiro Detectado',
                message: `${m.name}: Gasto ${(m.current_flow * 1000).toFixed(0)} L/s excede autorizado (+${((m.current_flow / m.target_flow - 1) * 100).toFixed(0)}%).`,
                timestamp: 'Ahora',
            });
        }
    }

    // 4. Presas: solo con nivel capturado (sin lectura no se afirma nada del embalse)
    for (const p of e.presas) {
        const pct = porcentajeLlenadoPresa(p);
        if (pct == null) continue;
        const fecha = p.lectura?.fecha || 'Hoy';
        if (pct > PRESA_ALTA_PCT) {
            alertas.push({ id: `dam-high-${p.id}`, type: 'warning', title: 'Alto Nivel (NAMO)', message: `${p.nombre}: ${pct.toFixed(1)}% de llenado.`, timestamp: fecha });
        }
        if (pct < PRESA_BAJA_PCT && !llenado) {
            alertas.push({ id: `dam-low-${p.id}`, type: 'critical', title: 'Almacenamiento Crítico', message: `${p.nombre}: Nivel por debajo del ${PRESA_BAJA_PCT}% (${pct.toFixed(1)}%).`, timestamp: fecha });
        }
    }

    // 4b. Protocolo abierto por tiempo prolongado
    const dias = diasDesde(e.protocolo?.fecha_inicio, e.ahoraMs);
    if (e.protocolo && dias != null && dias > UMBRAL_DIAS_PROTOCOLO) {
        alertas.push({
            id: `proto-stale-${e.protocolo.id}`, type: 'warning', title: 'Protocolo Abierto Prolongado',
            message: `${e.protocolo.evento_tipo} activo desde hace ${dias} días. Verificar si sigue vigente o debe cerrarse.`,
            timestamp: (e.protocolo.fecha_inicio ?? '').slice(0, 10),
        });
    }

    // 5. Predictivas: si ya hay una fuga real del mismo tramo, la predictiva no aporta nada nuevo
    const norm = (id: string) => id.replace('pred-fuga-', 'leak-');
    for (const pa of e.predictivas) {
        if (!alertas.some((a) => norm(a.id) === norm(pa.id))) alertas.push(pa);
    }

    if (alertas.length === 0) {
        alertas.push({ id: 'ok', type: 'info', title: 'Sistema Estable', message: 'Operando dentro de parámetros normales.', timestamp: 'Ahora' });
    }
    return alertas;
}

// ── Chips de estado de la cabecera ───────────────────────────────────────────
export type SeveridadChip = 'crit' | 'warn' | 'info' | 'ok';
export interface ChipEstado { key: string; sev: SeveridadChip; texto: string }

export interface EntradaChips {
    protocolo: (ProtocoloEntrada & { gasto_solicitado_m3s?: number | null }) | null;
    diasProtocolo: number | null;
    almacenamiento: { parcial: boolean; presasConDato: number; presasTotal: number };
    fuentesCaidas: string[];
    /** Frescura por presa (una presa al día ya no oculta a otra con lectura vieja). */
    frescuraPresas: { nombre: string; texto: string | null; stale: boolean }[];
}

const PESO: Record<SeveridadChip, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

export function construyeChips(e: EntradaChips): ChipEstado[] {
    const chips: ChipEstado[] = [];
    if (e.protocolo) {
        const vencido = (e.diasProtocolo ?? 0) > UMBRAL_DIAS_PROTOCOLO;
        chips.push({
            key: 'protocolo', sev: vencido ? 'crit' : 'info',
            texto: `Protocolo ${e.protocolo.evento_tipo}${e.protocolo.gasto_solicitado_m3s ? ` · ${e.protocolo.gasto_solicitado_m3s} m³/s solicitados` : ''}`
                + `${e.diasProtocolo != null ? ` · ${e.diasProtocolo} d abierto` : ''}${vencido ? ' — revisar cierre' : ''}`,
        });
    } else {
        chips.push({ key: 'protocolo', sev: 'ok', texto: 'Sin protocolo activo' });
    }
    if (e.almacenamiento.parcial) {
        chips.push({
            key: 'nivel-presa', sev: e.almacenamiento.presasConDato === 0 ? 'crit' : 'warn',
            texto: `Nivel de presa: ${e.almacenamiento.presasConDato} de ${e.almacenamiento.presasTotal} con lectura`,
        });
    }
    if (e.fuentesCaidas.length > 0) chips.push({ key: 'fuentes-caidas', sev: 'crit', texto: `Sin respuesta: ${e.fuentesCaidas.join(', ')}` });
    for (const f of e.frescuraPresas) {
        if (!f.texto) chips.push({ key: `fresc-${f.nombre}`, sev: 'warn', texto: `${f.nombre}: sin lectura` });
        else chips.push({ key: `fresc-${f.nombre}`, sev: f.stale ? 'warn' : 'ok', texto: `${f.nombre}: ${f.texto}` });
    }
    return chips.sort((a, b) => PESO[a.sev] - PESO[b.sev]);
}
