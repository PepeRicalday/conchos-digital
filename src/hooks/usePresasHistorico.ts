import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { indexarSerie, aniosDisponibles, type FilaSerie, type Indice } from '../utils/historicoPresas';

/**
 * Serie diaria unificada de las presas (v_presas_serie_diaria): operativo CAMPO/CILA + histórico SRL.
 * Se descarga completa una sola vez (≈3,600 filas) y se comparte entre Presas y Análisis Histórico;
 * la caché expira a los 10 minutos para recoger lecturas nuevas (p. ej. la ingesta CILA diaria).
 */

const COLUMNAS = 'presa_id,fecha,escala_msnm,almacenamiento_mm3,pct,fuente,calidad,almacenamiento_reportado_mm3,pct_reportado';
const PAGINA = 1000; // tope por defecto de PostgREST
const TTL_MS = 10 * 60 * 1000;

let cache: { filas: Promise<FilaSerie[]>; ts: number } | null = null;

// La vista no está en los tipos generados de Supabase.
interface ClienteLibre {
    from: (tabla: string) => {
        select: (cols: string) => {
            in: (col: string, vals: string[]) => {
                order: (col: string, o: { ascending: boolean }) => {
                    order: (col: string, o: { ascending: boolean }) => {
                        range: (a: number, b: number) => PromiseLike<{ data: FilaSerie[] | null; error: { message: string } | null }>;
                    };
                };
            };
        };
    };
}

async function descargar(): Promise<FilaSerie[]> {
    const sb = supabase as unknown as ClienteLibre;
    const filas: FilaSerie[] = [];
    for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await sb
            .from('v_presas_serie_diaria')
            .select(COLUMNAS)
            .in('presa_id', ['PRE-001', 'PRE-002'])
            .order('fecha', { ascending: true })
            .order('presa_id', { ascending: true })
            .range(desde, desde + PAGINA - 1);
        if (error) throw new Error(error.message);
        filas.push(...(data ?? []));
        if (!data || data.length < PAGINA) break;
    }
    return filas;
}

function obtener(forzar = false): Promise<FilaSerie[]> {
    if (!forzar && cache && Date.now() - cache.ts < TTL_MS) return cache.filas;
    const filas = descargar();
    cache = { filas, ts: Date.now() };
    filas.catch(() => { if (cache?.filas === filas) cache = null; }); // un fallo no se queda en caché
    return filas;
}

export interface EstadoHistorico {
    indice: Indice;
    anios: number[];
    totalDias: number;
    loading: boolean;
    error: string | null;
    recargar: () => void;
}

export function usePresasHistorico(): EstadoHistorico {
    const [filas, setFilas] = useState<FilaSerie[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Carga inicial: los setState ocurren en los callbacks de la promesa, no de forma síncrona en el efecto.
    useEffect(() => {
        let vivo = true;
        obtener(false)
            .then(f => { if (vivo) { setFilas(f); setLoading(false); } })
            .catch((e: Error) => { if (vivo) { setError(e.message); setLoading(false); } });
        return () => { vivo = false; };
    }, []);

    // Recarga manual (botón «Reintentar»): evento de usuario, fuera del efecto.
    const recargar = useCallback(() => {
        setLoading(true);
        setError(null);
        obtener(true)
            .then(f => { setFilas(f); setLoading(false); })
            .catch((e: Error) => { setError(e.message); setLoading(false); });
    }, []);

    const indice = useMemo(() => indexarSerie(filas), [filas]);
    const anios = useMemo(() => aniosDisponibles(indice), [indice]);
    const totalDias = useMemo(() => new Set(filas.map(f => f.fecha)).size, [filas]);

    return { indice, anios, totalDias, loading, error, recargar };
}
