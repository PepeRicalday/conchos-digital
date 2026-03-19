import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface MetadataState {
    escalas: any[];
    presas: any[];
    modulos: any[];
    puntos_entrega: any[];
    aforos_control: any[];
    secciones: any[];
    loading: boolean;
    last_fetched: number | null;
    fetchMetadata: (force?: boolean) => Promise<void>;
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
    escalas: JSON.parse(localStorage.getItem('metadata_escalas') || '[]'),
    presas: JSON.parse(localStorage.getItem('metadata_presas') || '[]'),
    modulos: JSON.parse(localStorage.getItem('metadata_modulos') || '[]'),
    puntos_entrega: JSON.parse(localStorage.getItem('metadata_tomas') || '[]'),
    aforos_control: JSON.parse(localStorage.getItem('metadata_aforos_control') || '[]'),
    secciones: JSON.parse(localStorage.getItem('metadata_secciones') || '[]'),
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
                escalas: esc || [],
                presas: pre || [],
                modulos: mod || [],
                puntos_entrega: pe || [],
                aforos_control: af || [],
                secciones: sec || [],
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
