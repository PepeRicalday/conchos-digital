import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
    EscalaRow, PresaConCurva, ModuloRow,
    PuntoEntregaRow, AforoControlRow, SeccionRow,
} from '../types/sica.types';

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
                { data: pre },
                { data: mod },
                { data: pe },
                { data: af },
                { data: sec }
            ] = await Promise.all([
                supabase.from('escalas').select('*').eq('activa', true).order('km'),
                supabase.from('presas').select('*, curvas_capacidad (elevacion_msnm, volumen_mm3, area_ha)').neq('id', 'PRE-003').order('nombre'),
                supabase.from('modulos').select('*'),
                supabase.from('puntos_entrega').select('*'),
                supabase.from('aforos_control').select('*'),
                supabase.from('secciones').select('*').order('km_inicio')
            ]);

            const metadata = {
                escalas:        (esc || []) as EscalaRow[],
                presas:         (pre || []) as PresaConCurva[],
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
