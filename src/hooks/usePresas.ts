import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────
export interface PresaData {
    id: string;
    nombre: string;
    nombre_corto: string;
    codigo: string;
    rio: string;
    municipio: string;
    tipo_cortina: string;
    latitud: number;
    longitud: number;
    elevacion_corona_msnm: number;
    capacidad_max_mm3: number;
    // Lectura del día (o más reciente disponible)
    lectura: LecturaPresaData | null;
    // Curva EAC
    curva_capacidad: PuntoCurva[];
}

export interface LecturaPresaData {
    fecha: string;
    escala_msnm: number;
    almacenamiento_mm3: number;
    porcentaje_llenado: number;
    extraccion_total_m3s: number;
    gasto_toma_baja_m3s: number | null;
    gasto_cfe_m3s: number | null;
    gasto_toma_izq_m3s: number | null;
    gasto_toma_der_m3s: number | null;
    area_ha: number;
    responsable: string | null;
    notas: string | null;
}

export interface PuntoCurva {
    elevacion_msnm: number;
    volumen_mm3: number;
    area_ha: number;
}

export interface ClimaPresaData {
    presa_id: string;
    fecha: string;
    temp_ambiente_c: number | null;
    temp_maxima_c: number | null;
    temp_minima_c: number | null;
    precipitacion_mm: number | null;
    evaporacion_mm: number | null;
    dir_viento: string | null;
    intensidad_viento: string | null;
    visibilidad: string | null;
    edo_tiempo: string | null;
    edo_tiempo_24h: string | null;
    dir_viento_24h: string | null;
    intensidad_24h: string | null;
}

export interface AforoDiarioData {
    estacion: string;
    fecha: string;
    escala: number | null;
    gasto_m3s: number | null;
}

// ─── Hook ────────────────────────────────────────────
export function usePresas(fecha: string) {
    const [presas, setPresas] = useState<PresaData[]>([]);
    const [clima, setClima] = useState<ClimaPresaData[]>([]);
    const [aforos, setAforos] = useState<AforoDiarioData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchData() {
            try {
                setLoading(true);
                setError(null);

                // 1. Presas base data + curvas de capacidad
                const { data: presasDB, error: errP } = await supabase
                    .from('presas')
                    .select(`
                        *,
                        curvas_capacidad (
                            elevacion_msnm,
                            volumen_mm3,
                            area_ha
                        )
                    `)
                    .neq('id', 'PRE-003') // Ignore Delicias pseudo-presa visually in list
                    .order('nombre');

                if (errP) throw errP;

                // 2. Lecturas para la fecha seleccionada
                let { data: lecturasDB, error: errL } = await supabase
                    .from('lecturas_presas')
                    .select('*')
                    .eq('fecha', fecha);

                if (errL) throw errL;

                // Si no hay lecturas para esa fecha, buscar la más reciente
                if (!lecturasDB || lecturasDB.length === 0) {
                    const { data: fallback, error: errFb } = await supabase
                        .from('lecturas_presas')
                        .select('*')
                        .lte('fecha', fecha)
                        .order('fecha', { ascending: false })
                        .limit(2); // una por presa max

                    if (errFb) throw errFb;
                    lecturasDB = fallback;
                }

                // 3. Clima para la fecha
                let { data: climaDB, error: errC } = await supabase
                    .from('clima_presas')
                    .select('*')
                    .eq('fecha', fecha);

                if (errC) throw errC;

                // Fallback clima
                if (!climaDB || climaDB.length === 0) {
                    const { data: climaFb } = await supabase
                        .from('clima_presas')
                        .select('*')
                        .lte('fecha', fecha)
                        .order('fecha', { ascending: false })
                        .limit(3);
                    climaDB = climaFb;
                }

                // 4. Aforos para la fecha
                const { data: aforosDB, error: errA } = await supabase
                    .from('aforos_principales_diarios')
                    .select('*')
                    .eq('fecha', fecha);

                if (errA) throw errA;

                if (cancelled) return;

                // Index lecturas by presa_id
                const lecturaMap: Record<string, any> = {};
                (lecturasDB || []).forEach((l: any) => {
                    lecturaMap[l.presa_id] = l;
                });

                // Transform
                const result: PresaData[] = (presasDB || []).map((p: any) => {
                    const lect = lecturaMap[p.id];
                    const curva = (p.curvas_capacidad || [])
                        .sort((a: any, b: any) => Number(a.elevacion_msnm) - Number(b.elevacion_msnm))
                        .map((c: any) => ({
                            elevacion_msnm: Number(c.elevacion_msnm),
                            volumen_mm3: Number(c.volumen_mm3),
                            area_ha: Number(c.area_ha),
                        }));

                    return {
                        id: p.id,
                        nombre: p.nombre,
                        nombre_corto: p.nombre_corto || '',
                        codigo: p.codigo,
                        rio: p.rio || '',
                        municipio: p.municipio || '',
                        tipo_cortina: p.tipo_cortina || '',
                        latitud: Number(p.latitud) || 0,
                        longitud: Number(p.longitud) || 0,
                        elevacion_corona_msnm: Number(p.elevacion_corona_msnm) || 0,
                        capacidad_max_mm3: Number(p.capacidad_max),
                        lectura: lect ? {
                            fecha: lect.fecha,
                            escala_msnm: Number(lect.escala_msnm) || 0,
                            almacenamiento_mm3: Number(lect.almacenamiento_mm3) || 0,
                            porcentaje_llenado: Number(lect.porcentaje_llenado) || 0,
                            extraccion_total_m3s: Number(lect.extraccion_total_m3s) || 0,
                            gasto_toma_baja_m3s: lect.gasto_toma_baja_m3s != null ? Number(lect.gasto_toma_baja_m3s) : null,
                            gasto_cfe_m3s: lect.gasto_cfe_m3s != null ? Number(lect.gasto_cfe_m3s) : null,
                            gasto_toma_izq_m3s: lect.gasto_toma_izq_m3s != null ? Number(lect.gasto_toma_izq_m3s) : null,
                            gasto_toma_der_m3s: lect.gasto_toma_der_m3s != null ? Number(lect.gasto_toma_der_m3s) : null,
                            area_ha: Number(lect.area_ha) || 0,
                            responsable: lect.responsable,
                            notas: lect.notas,
                        } : null,
                        curva_capacidad: curva,
                    };
                });

                setPresas(result);
                setClima((climaDB || []).map((c: any) => ({
                    presa_id: c.presa_id,
                    fecha: c.fecha,
                    temp_ambiente_c: c.temp_ambiente_c != null ? Number(c.temp_ambiente_c) : null,
                    temp_maxima_c: c.temp_maxima_c != null ? Number(c.temp_maxima_c) : null,
                    temp_minima_c: c.temp_minima_c != null ? Number(c.temp_minima_c) : null,
                    precipitacion_mm: c.precipitacion_mm != null ? Number(c.precipitacion_mm) : null,
                    evaporacion_mm: c.evaporacion_mm != null ? Number(c.evaporacion_mm) : null,
                    dir_viento: c.dir_viento,
                    intensidad_viento: c.intensidad_viento,
                    visibilidad: c.visibilidad,
                    edo_tiempo: c.edo_tiempo,
                    edo_tiempo_24h: c.edo_tiempo_24h,
                    dir_viento_24h: c.dir_viento_24h,
                    intensidad_24h: c.intensidad_24h,
                })));
                setAforos((aforosDB || []).map((a: any) => ({
                    estacion: a.estacion,
                    fecha: a.fecha,
                    escala: a.escala != null ? Number(a.escala) : null,
                    gasto_m3s: a.gasto_m3s != null ? Number(a.gasto_m3s) : null
                })));

            } catch (err: any) {
                if (!cancelled) {
                    console.error('usePresas Error:', err);
                    setError(err.message);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchData();

        // C-3: Realtime subscription for lecturas_presas changes
        const channel = supabase.channel('presas_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'lecturas_presas' }, () => {
                console.log('🏔️ Lectura de presa actualizada. Refrescando...');
                fetchData();
            })
            .subscribe();

        // C-5: Refetch when tab becomes visible again
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') fetchData();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            cancelled = true;
            supabase.removeChannel(channel);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [fecha]);

    // Derived values
    const totalAlmacenamiento = presas.reduce((acc, p) => acc + (p.lectura?.almacenamiento_mm3 || 0), 0);
    const totalCapacidad = presas.reduce((acc, p) => acc + p.capacidad_max_mm3, 0);
    const totalExtraccion = presas.reduce((acc, p) => acc + (p.lectura?.extraccion_total_m3s || 0), 0);
    const porcentajeLlenado = totalCapacidad > 0 ? (totalAlmacenamiento / totalCapacidad) * 100 : 0;

    return {
        presas,
        clima,
        aforos,
        loading,
        error,
        // Aggregates
        totalAlmacenamiento,
        totalCapacidad,
        totalExtraccion,
        porcentajeLlenado,
    };
}
