import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { getTodayString, getStartOfTodayISO } from '../utils/dateHelpers';
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
            if (cached && version === __V2_APP_VERSION__) {
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

            // 1. Parallel Fetch (Highly Efficient Initial Load)
            // Separate Modulos from Mediciones to avoid nested filtering issues in PostgREST
            const today = getTodayString();
            // P1-4: Query only today's mediciones (midnight Chihuahua → UTC) to reduce payload.
            // Accumulated volumes come from reportes_diarios (authoritative), not from raw sums.
            const startOfToday = getStartOfTodayISO();

            const [
                { data: modulosDB, error: modError },
                { data: allMediciones, error: medError },
                { data: reportesHoy },
                { data: reportesOperacion },
                { data: volDiarioModulo }
            ] = await Promise.all([
                supabase.from('modulos').select(`
                    id, codigo_corto, nombre, nombre_acu, logo_url, vol_acumulado, vol_autorizado, caudal_objetivo,
                    puntos_entrega (
                        id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_id,
                        secciones ( id, nombre, color )
                    )
                `),
                supabase.from('mediciones')
                    .select('punto_id, valor_q, valor_vol, fecha_hora')
                    .gte('fecha_hora', startOfToday)
                    .order('fecha_hora', { ascending: false }),
                supabase.from('reportes_diarios').select('punto_id, modulo_id, volumen_total_mm3, caudal_promedio_lps').eq('fecha', today),
                // Fuente secundaria: estado operativo activo de hoy (inicio/continua/reabierto/modificacion)
                supabase.from('reportes_operacion')
                    .select('punto_id, caudal_promedio, volumen_acumulado, hora_apertura, estado, fecha')
                    .eq('fecha', today)
                    .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
                // Volumen acumulado del ciclo activo por módulo (fuente authoritative)
                supabase.from('resumen_ciclo')
                    .select('modulo_id, volumen_entregado_mm3')
                    .eq('activo', true)
            ]);

            if (modError) throw modError;
            if (medError) throw medError;
            if (!modulosDB) return;

            // Map mediciones to points for easy lookup
            const medicionMap = new Map<string, any[]>();
            (allMediciones || []).forEach(m => {
                if (!medicionMap.has(m.punto_id)) medicionMap.set(m.punto_id, []);
                medicionMap.get(m.punto_id)?.push(m);
            });

            // Map reportes_operacion by punto_id (fallback when mediciones is empty)
            const reporteOpMap = new Map<string, any>();
            (reportesOperacion || []).forEach(r => {
                if (!reporteOpMap.has(r.punto_id)) reporteOpMap.set(r.punto_id, r);
            });

            // 2. Metadata Sync — also force refresh if secciones is empty (avoids stale cache with no sections)
            const metaStore = useMetadataStore.getState();
            if (!metaStore.last_fetched || metaStore.secciones.length === 0) {
                await metaStore.fetchMetadata();
            }

            // 3. Index reports for quick access
            const reporteByPunto: Record<string, any> = {};
            const reporteByModulo: Record<string, number> = {};
            (reportesHoy || []).forEach((r: any) => {
                reporteByPunto[r.punto_id] = r;
                reporteByModulo[r.modulo_id] = (reporteByModulo[r.modulo_id] || 0) + Number(r.volumen_total_mm3 || 0);
            });

            // 4. Index resumen_ciclo por módulo (volumen acumulado ciclo activo)
            const resumenCicloMap = new Map<string, number>();
            (volDiarioModulo || []).forEach((v: any) => {
                resumenCicloMap.set(v.modulo_id, Number(v.volumen_entregado_mm3 || 0));
            });

            // 5. Transform & Merge Metadata with Realtime Data
            const indexMap: Record<string, { mIndex: number, pIndex: number }> = {};
            const metaModulos = metaStore.modulos;
            const metaPuntos = metaStore.puntos_entrega;

            const dynModMap = new Map(modulosDB.map(m => [m.id, m]));
            const fullModules: ModuleData[] = metaModulos.map((mod: any, mIdx: number) => {
                const freshMod = dynModMap.get(mod.id) || mod;
                const points = metaPuntos
                    .filter((p: any) => p.modulo_id === mod.id)
                    .map((p: any, pIdx: number) => {
                        indexMap[p.id] = { mIndex: mIdx, pIndex: pIdx };
                        
                        const measurements = medicionMap.get(p.id) || [];
                        const latest = measurements[0];
                        // Fallback: si no hay medicion para hoy, usar reportes_operacion (estado activo)
                        const reporteOp = reporteOpMap.get(p.id);
                        const qM3s = Number(latest?.valor_q || reporteOp?.caudal_promedio || 0);

                        // P1-4: All measurements are today's — no JS date filter needed.
                        // reportes_diarios is authoritative for daily/accumulated volumes;
                        // fall back to reportes_operacion.volumen_acumulado (already in Mm³) if no report exists.
                        const calculatedDailyVol = measurements.reduce((acc: number, med: any) => acc + Number(med.valor_vol || 0), 0);
                        const dailyReport = reporteByPunto[p.id];
                        const opVol = reporteOp ? Number(reporteOp.volumen_acumulado || 0) : 0;
                        const dailyVolPt = dailyReport
                            ? Number(dailyReport.volumen_total_mm3 || 0)
                            : (calculatedDailyVol > 0 ? calculatedDailyVol : opVol);

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
                            accumulated: dailyVolPt,
                            daily_vol: dailyVolPt,
                            is_open: qM3s > 0,
                            coordinates: { x: Number(p.coords_x), y: Number(p.coords_y) },
                            zone: p.zona || 'General',
                            section: sectionInfo?.nombre || 'Sin Sección',
                            last_update_time: latest?.fecha_hora || (reporteOp?.fecha ? `${reporteOp.fecha}T12:00:00` : undefined),
                            section_data: sectionInfo ? { ...sectionInfo, color: sectionInfo.color ?? '#64748b' } : undefined,
                            mediciones: measurements.length > 0 ? measurements : (reporteOp ? [{
                                punto_id: p.id,
                                valor_q: reporteOp.caudal_promedio || 0,
                                valor_vol: reporteOp.volumen_acumulado || 0,
                                fecha_hora: `${reporteOp.fecha}T12:00:00`
                            }] : []),
                            reportes: dailyReport ? [dailyReport] : []
                        };
                    });


                const currentFlow = points.reduce((acc: number, pt: any) => acc + pt.current_q, 0);
                const calcDailyVol = points.reduce((acc: number, pt: any) => acc + pt.daily_vol, 0);
                // Volumen diario: suma de reportes_operacion.volumen_acumulado de los puntos del módulo (Mm³)
                const opDailyVol = points.reduce((acc: number, pt: any) => {
                    const op = reporteOpMap.get(pt.id);
                    return acc + Number(op?.volumen_acumulado || 0);
                }, 0);
                const dailyVol = reporteByModulo[mod.id] || opDailyVol || calcDailyVol;

                // Acumulado ciclo: resumen_ciclo.volumen_entregado_mm3 (ya en Mm³)
                const accumulatedVol = resumenCicloMap.get(mod.id) ?? (Number(freshMod.vol_acumulado || 0) / 1000);

                return {
                    id: mod.id,
                    short_code: mod.codigo_corto,
                    name: mod.nombre,
                    acu_name: mod.nombre_acu,
                    logo_url: mod.logo_url,
                    current_flow: currentFlow,
                    daily_vol: dailyVol,
                    accumulated_vol: accumulatedVol,
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
            localStorage.setItem('hydra_cache_version', __V2_APP_VERSION__);

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

        // --- Register hub handlers (via realtimeHub — single shared channel) ---
        const unsubMedicionInsert = onTable('mediciones', 'INSERT', handleMedicionUpsert);
        const unsubMedicionUpdate = onTable('mediciones', 'UPDATE', handleMedicionUpsert);
        const unsubMedicionDelete = onTable('mediciones', 'DELETE', () => {
            console.log('🗑️ Medición eliminada. Refrescando datos completos...');
            get().fetchHydraulicData();
        });
        const unsubEscalas = onTable('lecturas_escalas', '*', () => {
            console.log('🔄 Cambio en escalas detectado. Sincronizando...');
            get().fetchHydraulicData();
        });
        const unsubPreasas = onTable('lecturas_presas', '*', () => {
            console.log('🏔️ Cambio en lecturas de presas detectado. Sincronizando...');
            get().fetchHydraulicData();
        });

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
            unsubMedicionInsert();
            unsubMedicionUpdate();
            unsubMedicionDelete();
            unsubEscalas();
            unsubPreasas();
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

