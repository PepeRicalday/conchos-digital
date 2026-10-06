import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { ensureMetadata } from '../store/useMetadataStore';
import { gastoDeLectura, esFrescaEscala } from '../utils/geoKpis';
import { usePolling } from './useClimaOperativo';
import { esEscalaReferencia } from '../utils/escalasReferencia';

export interface EscalaCanal {
    id: string;
    nombre: string;
    km: number;
    nivelM: number | null;
    /** Gasto con el criterio de Geo-Monitor / Monitor Público; null si falta el dato. */
    gasto: number | null;
    fresca: boolean;
    telemetriaMs: number | null;
    /** Escala de solo referencia (K-64, K-94+200): aporta nivel, nunca gasto. */
    referencia: boolean;
}

type EscalaMeta = { id: string; nombre: string; km: number; pzas_radiales?: number | null; ancho?: number | null };

/** Escalas del canal con su última lectura (nivel y gasto) y vigencia, para dibujarlas sobre el mapa lineal. */
export function useEscalasCanal() {
    const [escalas, setEscalas] = useState<EscalaCanal[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const meta = await ensureMetadata();
            const esc = (meta.escalas as unknown as EscalaMeta[]).filter((e) => Number.isFinite(Number(e.km)) && Number(e.km) >= 0 && Number(e.km) <= 104);
            const desde = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
            const { data, error: e } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, nivel_m, nivel_abajo_m, radiales_json, gasto_calculado_m3s, gasto_metodo, creado_en')
                .gte('fecha', desde)
                .order('fecha', { ascending: false })
                .order('hora_lectura', { ascending: false })
                .limit(800);
            if (e) throw e;
            const ultima = new Map<string, NonNullable<typeof data>[number]>();
            for (const l of data ?? []) if (!ultima.has(l.escala_id as string)) ultima.set(l.escala_id as string, l);
            const ahora = Date.now();
            setEscalas(esc.map((m) => {
                const l = ultima.get(m.id);
                const ts = l?.creado_en ? new Date(l.creado_en as string).getTime() : null;
                const referencia = esEscalaReferencia(m);
                return {
                    id: m.id, nombre: m.nombre, km: Number(m.km), referencia,
                    nivelM: l?.nivel_m != null ? Number(l.nivel_m) : null,
                    gasto: l && !referencia ? gastoDeLectura(l, { pzas_radiales: m.pzas_radiales, ancho: m.ancho, nombre: m.nombre, km: Number(m.km) }) : null,
                    fresca: esFrescaEscala(ts, ahora),
                    telemetriaMs: ts,
                };
            }).sort((a, b) => a.km - b.km));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudieron leer las escalas');
        } finally {
            setCargado(true);
        }
    }, []);

    usePolling(cargar, 5 * 60_000);
    useEffect(() => {
        const unsub = onTable('lecturas_escalas', '*', () => { void cargar(); });
        return () => unsub();
    }, [cargar]);

    return { escalas, error, cargado };
}
