import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { getTodayString } from '../utils/dateHelpers';
import { useMetadataStore } from './useMetadataStore';

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
    last_update_time?: string;
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
    pointIndexMap: Record<string, { mIndex: number, pIndex: number }>;
    loading: boolean;
    error: string | null;
    isInitialized: boolean;
    fetchHydraulicData: () => Promise<void>;
    initSubscription: () => void;
    destroySubscription: () => void;
}

export const useHydraStore = create<HydraState>((set, get) => ({
    modules: (() => {
        try {
            const cached = localStorage.getItem('hydra_modules_cache');
            const version = localStorage.getItem('hydra_cache_version');
            if (cached && version === __APP_VERSION__) {
                return JSON.parse(cached);
            }
        } catch { /* ignore */ }
        return [];
    })(),
    pointIndexMap: {},
    loading: true,
    error: null,
    isInitialized: false,

    fetchHydraulicData: async () => {
        try {
            const currentModules = get().modules;
            if (currentModules.length === 0) set({ loading: true });

            const today = getTodayString();
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

            // 1. Parallel Fetch (Highly Efficient Initial Load)
            const [
                { data: modulosDB, error: modError },
                { data: reportesHoy }
            ] = await Promise.all([
                supabase.from('modulos').select(`
                    id, codigo_corto, nombre, nombre_acu, logo_url, vol_acumulado, vol_autorizado, caudal_objetivo,
                    puntos_entrega (
                        id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_id,
                        secciones ( id, nombre, color ),
                        mediciones ( valor_q, valor_vol, fecha_hora )
                    )
                `).filter('puntos_entrega.mediciones.fecha_hora', 'gte', threeDaysAgoStr),
                supabase.from('reportes_diarios').select('punto_id, modulo_id, volumen_total_mm3, caudal_promedio_lps').eq('fecha', today)
            ]);

            if (modError) throw modError;
            if (!modulosDB) return;

            // 2. Metadata Sync (Ensure we have the base structure)
            const metaStore = useMetadataStore.getState();
            if (!metaStore.last_fetched) {
                await metaStore.fetchMetadata();
            }

            // 3. Index reports for quick access
            const reporteByPunto: Record<string, any> = {};
            const reporteByModulo: Record<string, number> = {};
            (reportesHoy || []).forEach((r: any) => {
                reporteByPunto[r.punto_id] = r;
                reporteByModulo[r.modulo_id] = (reporteByModulo[r.modulo_id] || 0) + Number(r.volumen_total_mm3 || 0);
            });

            // 4. Transform & Merge Metadata with Realtime Data
            const indexMap: Record<string, { mIndex: number, pIndex: number }> = {};
            const metaModulos = metaStore.modulos;
            const metaPuntos = metaStore.puntos_entrega;

            // Map dynamic data for easy lookup
            // const dynModMap = new Map(modulosDB.map(m => [m.id, m]));
            const dynPtMap = new Map();
            modulosDB.forEach(m => {
                (m.puntos_entrega || []).forEach((p: any) => dynPtMap.set(p.id, p));
            });

            const dynModMap = new Map(modulosDB.map(m => [m.id, m]));
            const fullModules: ModuleData[] = metaModulos.map((mod: any, mIdx: number) => {
                const freshMod = dynModMap.get(mod.id) || mod;
                const points = metaPuntos
                    .filter((p: any) => p.modulo_id === mod.id)
                    .map((p: any, pIdx: number) => {
                        indexMap[p.id] = { mIndex: mIdx, pIndex: pIdx };
                        
                        const dynP = dynPtMap.get(p.id);
                        const measurements = (dynP?.mediciones || []).sort((a: any, b: any) =>
                            new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime()
                        );
                        const latest = measurements[0];
                        const qM3s = Number(latest?.valor_q || 0);

                        const totalAccum = measurements.reduce((acc: number, med: any) => acc + Number(med.valor_vol || 0), 0);
                        const todayStr = getTodayString();
                        const todayMeasurements = measurements.filter((m: any) => m.fecha_hora && m.fecha_hora.startsWith(todayStr));
                        const calculatedDailyVol = todayMeasurements.reduce((acc: number, med: any) => acc + Number(med.valor_vol || 0), 0);

                        const dailyReport = reporteByPunto[p.id];
                        const dailyVolPt = dailyReport ? Number(dailyReport.volumen_total_mm3 || 0) : calculatedDailyVol;

                        // Secciones metadata join
                        const sectionInfo = metaStore.secciones.find(s => s.id === p.seccion_id);

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
                            last_update_time: latest?.fecha_hora,
                            section_data: sectionInfo,
                            mediciones: measurements,
                            reportes: dailyReport ? [dailyReport] : []
                        };
                    });


                const currentFlow = points.reduce((acc: number, pt: any) => acc + pt.current_q, 0);
                const calcDailyVol = points.reduce((acc: number, pt: any) => acc + pt.daily_vol, 0);
                const dailyVol = reporteByModulo[mod.id] || calcDailyVol;

                return {
                    id: mod.id,
                    short_code: mod.codigo_corto,
                    name: mod.nombre,
                    acu_name: mod.nombre_acu,
                    logo_url: mod.logo_url,
                    current_flow: currentFlow,
                    daily_vol: dailyVol,
                    // DB module volumes are stored in 'Millares de m³' (Miles de metros cúbicos)
                    // The UI always renders in 'Mm³' (Millones de metros cúbicos). Div by 1000.
                    accumulated_vol: (Number(freshMod.vol_acumulado || 0) / 1000),
                    authorized_vol: (Number(freshMod.vol_autorizado || 0) / 1000),
                    target_flow: Number(mod.caudal_objetivo || 0),
                    delivery_points: points
                };
            });


            // Sort modules logically: m1, m2 ... m12
            fullModules.sort((a, b) => {
                const codeA = a.short_code || '';
                const codeB = b.short_code || '';
                const numA = parseInt(codeA.replace(/\D/g, '')) || 0;
                const numB = parseInt(codeB.replace(/\D/g, '')) || 0;
                return numA - numB;
            });

            set({ modules: fullModules, pointIndexMap: indexMap, loading: false, error: null });
            localStorage.setItem('hydra_modules_cache', JSON.stringify(fullModules));
            localStorage.setItem('hydra_cache_version', __APP_VERSION__);

        } catch (err: any) {
            console.error('Zustand HydraEngine Error:', err);
            set({ error: err.message, loading: false });
        }
    },

    initSubscription: () => {
        if (get().isInitialized) return;
        set({ isInitialized: true });

        get().fetchHydraulicData();

        // --- Realtime handler for mediciones (INSERT + UPDATE) ---
        const handleMedicionUpsert = (payload: any) => {
            const record = payload.new;
            if (!record || !record.punto_id) return;

            set(state => {
                const indices = state.pointIndexMap[record.punto_id];
                if (!indices) return state; // Unknown point — ignore

                const { mIndex, pIndex } = indices;
                const newModules = [...state.modules];
                const m = { ...newModules[mIndex] };
                const p = { ...m.delivery_points[pIndex] };

                const qM3s = Number(record.valor_q || 0);
                const volMm3 = Number(record.valor_vol || 0);

                p.current_q = qM3s;
                p.current_q_lps = qM3s * 1000;
                p.accumulated += volMm3;
                p.is_open = qM3s > 0;
                p.last_update_time = record.fecha_hora || new Date().toISOString();

                m.delivery_points = [...m.delivery_points];
                m.delivery_points[pIndex] = p;
                m.current_flow = m.delivery_points.reduce((acc, pt) => acc + pt.current_q, 0);

                newModules[mIndex] = m;

                return { modules: newModules };
            });
        };

        const channel = supabase.channel('hydra_realtime_global')
            // Mediciones: INSERT + UPDATE (O(1) patch) + DELETE (full refetch)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mediciones' }, handleMedicionUpsert)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mediciones' }, handleMedicionUpsert)
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'mediciones' }, () => {
                console.log('🗑️ Medición eliminada. Refrescando datos completos...');
                get().fetchHydraulicData();
            })
            // Escalas: full refetch on any change
            .on('postgres_changes', { event: '*', schema: 'public', table: 'lecturas_escalas' }, () => {
                console.log('🔄 Cambio en escalas detectado. Sincronizando...');
                get().fetchHydraulicData();
            })
            // Presas: full refetch (consumed by usePresas indirectly via page-level refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'lecturas_presas' }, () => {
                console.log('🏔️ Cambio en lecturas de presas detectado. Sincronizando...');
                get().fetchHydraulicData();
            })
            .subscribe();

        // --- C-5a: Visibility change — refetch when user returns to tab ---
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Pestaña visible. Refrescando datos...');
                get().fetchHydraulicData();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        // --- Store cleanup reference for proper teardown ---
        (useHydraStore as any)._cleanup = () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            supabase.removeChannel(channel);
        };
    },

    destroySubscription: () => {
        const cleanup = (useHydraStore as any)._cleanup;
        if (cleanup) {
            cleanup();
            (useHydraStore as any)._cleanup = null;
        }
        set({ isInitialized: false });
    }
}));

