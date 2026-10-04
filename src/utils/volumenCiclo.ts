// ÚNICA FUENTE de "volumen a entregar vs entregado" por módulo y ciclo.
//
// Lee la vista volumen_ciclo_modulo (BD):
//   entregado = hoja institucional mensual (volumen_modulo_mensual_provisional)
//             + remanente post-cierre (entregas_modulo adicional "Remanente%").
// Ningún componente debe volver a sumar entregas_modulo / mediciones /
// reportes_* para obtener el acumulado del ciclo: usar este módulo.
// Unidades: la vista entrega miles de m³; aquí se expone también en Mm³ y m³.
import { supabase } from '../lib/supabase';

export interface VolumenCicloModulo {
    cicloId: string;
    cicloNombre: string;
    activo: boolean;
    moduloId: string;
    moduloNombre: string;
    codigoCorto: string;
    numeroModulo: number | null;
    autorizadoMm3: number;
    hojaMm3: number;
    remanenteMm3: number;
    entregadoMm3: number;
    saldoMm3: number;
    pctEntregado: number | null;
    ultimoMesHoja: string | null;
    hojaMesParcial: boolean;
    remanenteDesde: string | null;
    remanenteHasta: string | null;
}

export interface VolumenCicloTotales {
    autorizadoMm3: number;
    hojaMm3: number;
    remanenteMm3: number;
    entregadoMm3: number;
    saldoMm3: number;
    pctEntregado: number | null;
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const mm3 = (miles: unknown) => n(miles) / 1000;

export function totalesVolumenCiclo(rows: VolumenCicloModulo[]): VolumenCicloTotales {
    const t = rows.reduce(
        (a, r) => ({
            autorizadoMm3: a.autorizadoMm3 + r.autorizadoMm3,
            hojaMm3: a.hojaMm3 + r.hojaMm3,
            remanenteMm3: a.remanenteMm3 + r.remanenteMm3,
            entregadoMm3: a.entregadoMm3 + r.entregadoMm3,
            saldoMm3: a.saldoMm3 + r.saldoMm3,
        }),
        { autorizadoMm3: 0, hojaMm3: 0, remanenteMm3: 0, entregadoMm3: 0, saldoMm3: 0 },
    );
    return { ...t, pctEntregado: t.autorizadoMm3 > 0 ? (t.entregadoMm3 / t.autorizadoMm3) * 100 : null };
}

/** Estado derivado del % entregado (mismos umbrales que balance_volumen_modulo). */
export function estadoVolumen(pct: number | null): 'agotado' | 'alerta' | 'normal' {
    if (pct == null) return 'normal';
    return pct >= 100 ? 'agotado' : pct >= 85 ? 'alerta' : 'normal';
}

/** Volumen autorizado vs entregado por módulo del ciclo ACTIVO (o de `cicloId`). */
export async function fetchVolumenCiclo(cicloId?: string): Promise<VolumenCicloModulo[]> {
    let q = supabase.from('volumen_ciclo_modulo').select('*');
    q = cicloId ? q.eq('ciclo_id', cicloId) : q.eq('activo', true);
    const { data, error } = await q;
    if (error) {
        console.error('[volumenCiclo] error:', error.message);
        return [];
    }
    return (data ?? [])
        .map((r: any): VolumenCicloModulo => ({
            cicloId: r.ciclo_id,
            cicloNombre: r.ciclo_nombre,
            activo: !!r.activo,
            moduloId: r.modulo_id,
            moduloNombre: r.modulo_nombre,
            codigoCorto: r.codigo_corto,
            numeroModulo: r.numero_modulo,
            autorizadoMm3: mm3(r.vol_autorizado_miles_m3),
            hojaMm3: mm3(r.vol_hoja_miles_m3),
            remanenteMm3: mm3(r.vol_remanente_miles_m3),
            entregadoMm3: mm3(r.vol_entregado_miles_m3),
            saldoMm3: mm3(r.vol_saldo_miles_m3),
            pctEntregado: r.pct_entregado == null ? null : Number(r.pct_entregado),
            ultimoMesHoja: r.ultimo_mes_hoja ?? null,
            hojaMesParcial: !!r.hoja_mes_parcial,
            remanenteDesde: r.remanente_desde ?? null,
            remanenteHasta: r.remanente_hasta ?? null,
        }))
        .sort((a, b) => (a.numeroModulo ?? 99) - (b.numeroModulo ?? 99));
}
