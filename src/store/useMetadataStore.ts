import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
    EscalaRow, PresaConCurva, PresaRow, ModuloRow,
    PuntoEntregaRow, AforoControlRow, SeccionRow, CurvaCapacidadRow,
} from '../types/sica.types';

/**
 * Trae TODAS las filas de curvas_capacidad, paginando de 1000 en 1000.
 * PostgREST limita cada respuesta (y cada recurso embebido) a 1000 filas —
 * las curvas de este proyecto tienen paso de 0.01m y llegan a 5000+ puntos
 * por presa, así que un solo select() o un embed en presas() se trunca
 * silenciosamente. Sin paginar, cualquier elevación por encima del punto de
 * corte queda fuera de la curva cargada en cliente y la interpolación hace
 * clamp al último punto disponible en vez de al real.
 */
async function fetchCurvasCapacidadCompletas(): Promise<CurvaCapacidadRow[]> {
    const PAGE_SIZE = 1000;
    const todas: CurvaCapacidadRow[] = [];
    let desde = 0;
    while (true) {
        const { data, error } = await supabase
            .from('curvas_capacidad')
            .select('*')
            .order('presa_id', { ascending: true })
            .order('elevacion_msnm', { ascending: true })
            .range(desde, desde + PAGE_SIZE - 1);
        if (error || !data) break;
        todas.push(...(data as CurvaCapacidadRow[]));
        if (data.length < PAGE_SIZE) break;
        desde += PAGE_SIZE;
    }
    return todas;
}

/**
 * P2-8: Safe localStorage parser.
 * JSON.parse throws on corrupted/truncated values — if the app crashes mid-write
 * or the browser truncates the entry, the entire store would fail to initialize.
 * This helper returns an empty array and clears the corrupt key instead of throwing.
 */
function parseCached<T>(key: string): T[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        return JSON.parse(raw) ?? [];
    } catch {
        console.warn(`[MetadataStore] Cache corrupta en "${key}". Descartando y forzando re-fetch.`);
        localStorage.removeItem(key);
        return [];
    }
}

// Bump al cambiar qué campos/forma trae metadata_presas — invalida la caché
// de 12h en dispositivos ya visitados sin esperar a que expire. Subido tras
// el fix de paginación de curvas_capacidad (antes: embed truncado a 1000
// filas, curva de la Boquilla cortada en 1274.99msnm).
const METADATA_CACHE_VERSION = 2;

interface MetadataState {
    escalas: EscalaRow[];
    presas: PresaConCurva[];
    modulos: ModuloRow[];
    puntos_entrega: PuntoEntregaRow[];
    aforos_control: AforoControlRow[];
    secciones: SeccionRow[];
    loading: boolean;
    last_fetched: number | null;
    fetchMetadata: (force?: boolean) => Promise<void>;
}

// Caché de una versión de esquema vieja: se descarta entera (todas las
// claves + last_fetched) para forzar un re-fetch inmediato en vez de
// esperar a que expiren las 12h normales.
const cacheVigente = Number(localStorage.getItem('metadata_cache_version')) === METADATA_CACHE_VERSION;
if (!cacheVigente) {
    ['metadata_escalas', 'metadata_presas', 'metadata_modulos', 'metadata_tomas',
        'metadata_aforos_control', 'metadata_secciones', 'metadata_last_fetched']
        .forEach(k => localStorage.removeItem(k));
    localStorage.setItem('metadata_cache_version', String(METADATA_CACHE_VERSION));
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
    escalas:        parseCached<EscalaRow>('metadata_escalas'),
    presas:         parseCached<PresaConCurva>('metadata_presas'),
    modulos:        parseCached<ModuloRow>('metadata_modulos'),
    puntos_entrega: parseCached<PuntoEntregaRow>('metadata_tomas'),
    aforos_control: parseCached<AforoControlRow>('metadata_aforos_control'),
    secciones:      parseCached<SeccionRow>('metadata_secciones'),
    loading: false,
    last_fetched: Number(localStorage.getItem('metadata_last_fetched')) || null,

    fetchMetadata: async (force = false) => {
        const now = Date.now();
        const lastFetched = get().last_fetched;
        
        // Cache por 12 horas (43200000 ms)
        if (!force && lastFetched && (now - lastFetched < 43200000) && get().escalas.length > 0) {
            console.log('📦 Metadatos cargados desde cache local');
            return;
        }

        set({ loading: true });
        console.log('🔄 Sincronizando metadatos estáticos desde Supabase...');

        try {
            const [
                { data: esc },
                { data: preSinCurva },
                { data: mod },
                { data: pe },
                { data: af },
                { data: sec },
                curvasCompletas
            ] = await Promise.all([
                supabase.from('escalas').select('*').eq('activa', true).order('km'),
                supabase.from('presas').select('*').neq('id', 'PRE-003').order('nombre'),
                supabase.from('modulos').select('*'),
                supabase.from('puntos_entrega').select('*'),
                supabase.from('aforos_control').select('*'),
                supabase.from('secciones').select('*').order('km_inicio'),
                fetchCurvasCapacidadCompletas()
            ]);

            // La curva batimétrica llega en PÁGINAS separadas (no como embed de
            // presas) porque PostgREST limita los recursos embebidos a 1000 filas:
            // con curvas de 5000+ puntos (paso de 0.01m), un embed truncaba la
            // curva de la Boquilla en 1274.99msnm — cualquier nivel real por
            // encima de eso (la presa opera cerca de 1296-1302msnm) quedaba
            // fuera de rango y la interpolación hacía clamp al último punto
            // disponible (~11 km²), inflando la validación cruzada NDWI vs.
            // curva batimétrica a 400-600% de "coincidencia".
            const curvasPorPresa = new Map<string, Pick<CurvaCapacidadRow, 'elevacion_msnm' | 'volumen_mm3' | 'area_ha'>[]>();
            for (const c of curvasCompletas) {
                const lista = curvasPorPresa.get(c.presa_id) ?? [];
                lista.push({ elevacion_msnm: c.elevacion_msnm, volumen_mm3: c.volumen_mm3, area_ha: c.area_ha });
                curvasPorPresa.set(c.presa_id, lista);
            }

            const metadata = {
                escalas:        (esc || []) as EscalaRow[],
                presas:         ((preSinCurva || []) as PresaRow[]).map(p => ({
                    ...p,
                    curvas_capacidad: curvasPorPresa.get(p.id) ?? [],
                })) as PresaConCurva[],
                modulos:        (mod || []) as ModuloRow[],
                puntos_entrega: (pe  || []) as PuntoEntregaRow[],
                aforos_control: (af  || []) as AforoControlRow[],
                secciones:      (sec || []) as SeccionRow[],
                last_fetched: now
            };

            set({ ...metadata, loading: false });

            // Persistir en localStorage
            localStorage.setItem('metadata_escalas', JSON.stringify(metadata.escalas));
            localStorage.setItem('metadata_presas', JSON.stringify(metadata.presas));
            localStorage.setItem('metadata_modulos', JSON.stringify(metadata.modulos));
            localStorage.setItem('metadata_tomas', JSON.stringify(metadata.puntos_entrega));
            localStorage.setItem('metadata_aforos_control', JSON.stringify(metadata.aforos_control));
            localStorage.setItem('metadata_secciones', JSON.stringify(metadata.secciones));
            localStorage.setItem('metadata_last_fetched', now.toString());

        } catch (err) {
            console.error('❌ Error al sincronizar metadatos:', err);
            set({ loading: false });
        }
    }
}));
