import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface SectionData {
    id: string;
    nombre: string;
    color: string;
}

export interface DeliveryPoint {
    id: string;
    name: string;
    km: number;
    type: 'toma' | 'lateral' | 'carcamo';
    capacity: number;
    current_q: number;
    current_q_lps: number;
    current_h: string;
    accumulated: number;
    daily_vol: number;
    is_open: boolean;
    coordinates: { x: number; y: number };
    zone: string;
    section: string;
    section_data?: SectionData;
    mediciones?: any[];
    reportes?: any[];
}

export interface ModuleData {
    id: string;
    short_code?: string;
    name: string;
    acu_name: string;
    logo_url?: string;
    current_flow: number;
    daily_vol: number;
    accumulated_vol: number;
    authorized_vol: number;
    target_flow: number;
    delivery_points: DeliveryPoint[];
}

interface HydraState {
    modules: ModuleData[];
    loading: boolean;
    error: string | null;
    isInitialized: boolean;
    fetchHydraulicData: () => Promise<void>;
    initSubscription: () => void;
}

export const useHydraStore = create<HydraState>((set, get) => ({
    modules: (() => {
        try {
            const cached = localStorage.getItem('hydra_modules_cache');
            const version = localStorage.getItem('hydra_cache_version');
            if (cached && version === '2026-02-16-v2') {
                return JSON.parse(cached);
            }
        } catch { /* ignore */ }
        return [];
    })(),
    loading: true,
    error: null,
    isInitialized: false,

    fetchHydraulicData: async () => {
        try {
            const currentModules = get().modules;
            if (currentModules.length === 0) set({ loading: true });

            // 1. Fetch
            const { data: modulosDB, error: modError } = await supabase
                .from('modulos')
                .select(`
                    *,
                    puntos_entrega (
                        *,
                        secciones (
                            id, nombre, color
                        ),
                        mediciones (
                            valor_q,
                            valor_vol,
                            fecha_hora
                        )
                    )
                `);

            if (modError) throw modError;
            if (!modulosDB) return;

            // 2. Fetch reportes
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const today = `${y}-${m}-${d}`;

            const { data: reportesHoy } = await supabase
                .from('reportes_diarios')
                .select('punto_id, modulo_id, volumen_total_mm3, caudal_promedio_lps')
                .eq('fecha', today);

            const reporteByPunto: Record<string, any> = {};
            const reporteByModulo: Record<string, number> = {};
            (reportesHoy || []).forEach((r: any) => {
                reporteByPunto[r.punto_id] = r;
                reporteByModulo[r.modulo_id] = (reporteByModulo[r.modulo_id] || 0) + Number(r.volumen_total_mm3 || 0);
            });

            // 3. Transform Map
            const fullModules: ModuleData[] = modulosDB.map((mod: any) => {
                const points = (mod.puntos_entrega || []).map((p: any) => {
                    const measurements = (p.mediciones || []).sort((a: any, b: any) =>
                        new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime()
                    );
                    const latest = measurements[0];
                    const qM3s = Number(latest?.valor_q || 0);

                    const totalAccum = measurements.reduce((acc: number, med: any) => acc + Number(med.valor_vol || 0), 0);
                    const dailyReport = reporteByPunto[p.id];
                    const dailyVolPt = dailyReport ? Number(dailyReport.volumen_total_mm3 || 0) : 0;

                    let sectionInfo = p.secciones;
                    if (!sectionInfo && p.km !== null) {
                        const km = Number(p.km);
                        if (km <= 25) sectionInfo = { id: 'sec-1', nombre: 'Sección 1: La Boquilla - Km 25', color: '#3b82f6' };
                        else if (km <= 50) sectionInfo = { id: 'sec-2', nombre: 'Sección 2: Km 25 - Km 50', color: '#10b981' };
                        else if (km <= 75) sectionInfo = { id: 'sec-3', nombre: 'Sección 3: Km 50 - Km 75', color: '#f59e0b' };
                        else sectionInfo = { id: 'sec-4', nombre: 'Sección 4: Km 75 - Fin', color: '#ef4444' };
                    }

                    return {
                        id: p.id,
                        name: p.nombre,
                        km: Number(p.km),
                        type: p.tipo,
                        capacity: Number(p.capacidad_max),
                        current_q: qM3s,
                        current_q_lps: qM3s * 1000,
                        current_h: '0.0',
                        accumulated: totalAccum,
                        daily_vol: dailyVolPt,
                        is_open: qM3s > 0,
                        coordinates: { x: Number(p.coords_x), y: Number(p.coords_y) },
                        zone: p.zona || 'General',
                        section: sectionInfo?.nombre || 'Sin Sección',
                        section_data: sectionInfo ? {
                            id: sectionInfo.id,
                            nombre: sectionInfo.nombre,
                            color: sectionInfo.color
                        } : undefined,
                        mediciones: measurements,
                        reportes: dailyReport ? [dailyReport] : []
                    };
                });

                const currentFlow = points.reduce((acc: number, pt: any) => acc + pt.current_q, 0);
                const dailyVol = reporteByModulo[mod.id] || 0;

                return {
                    id: mod.id,
                    short_code: mod.codigo_corto,
                    name: mod.nombre,
                    acu_name: mod.nombre_acu,
                    logo_url: mod.logo_url,
                    current_flow: currentFlow,
                    daily_vol: dailyVol,
                    accumulated_vol: Number(mod.vol_acumulado || 0),
                    authorized_vol: Number(mod.vol_autorizado || 0),
                    target_flow: Number(mod.caudal_objetivo || 0),
                    delivery_points: points
                };
            });

            set({ modules: fullModules, loading: false, error: null });
            localStorage.setItem('hydra_modules_cache', JSON.stringify(fullModules));
            localStorage.setItem('hydra_cache_version', '2026-02-16-v2');

        } catch (err: any) {
            console.error('Zustand HydraEngine Error:', err);
            set({ error: err.message, loading: false });
        }
    },

    initSubscription: () => {
        if (get().isInitialized) return;
        set({ isInitialized: true });

        get().fetchHydraulicData();

        supabase.channel('hydra_realtime_global')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mediciones' }, (payload) => {
                const newMeasurement = payload.new;
                if (!newMeasurement || !newMeasurement.punto_id) return;

                set(state => {
                    const newModules = [...state.modules];
                    let pointUpdated = false;

                    for (let mIndex = 0; mIndex < newModules.length; mIndex++) {
                        const m = { ...newModules[mIndex] };
                        const pIndex = m.delivery_points.findIndex(pt => pt.id === newMeasurement.punto_id);

                        if (pIndex !== -1) {
                            pointUpdated = true;
                            const p = { ...m.delivery_points[pIndex] };

                            const qM3s = Number(newMeasurement.valor_q || 0);
                            const volMm3 = Number(newMeasurement.valor_vol || 0);

                            p.current_q = qM3s;
                            p.current_q_lps = qM3s * 1000;
                            p.accumulated += volMm3;
                            p.is_open = qM3s > 0;

                            m.delivery_points = [...m.delivery_points];
                            m.delivery_points[pIndex] = p;
                            m.current_flow = m.delivery_points.reduce((acc, pt) => acc + pt.current_q, 0);

                            newModules[mIndex] = m;
                            break;
                        }
                    }

                    if (pointUpdated) {
                        localStorage.setItem('hydra_modules_cache', JSON.stringify(newModules));
                        return { modules: newModules };
                    }

                    return state;
                });
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lecturas_escalas' }, (payload) => {
                console.log('🔄 Nueva escala detectada. Sincronizando dashboard...');
                get().fetchHydraulicData();
            })
            .subscribe();
    }
}));
