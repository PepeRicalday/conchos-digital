import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/** Fila de precisión agregada por estación y horizonte (fn_clima_skill_resumen). */
export interface SkillResumen {
    estacion_nombre: string;
    horizonte_bucket: '0-6h' | '7-24h' | '25-48h' | string;
    n_muestras: number;
    /** Error absoluto medio de nubosidad (puntos porcentuales). Menor = mejor. */
    mae_nubosidad_pct: number | null;
    /** Sesgo firmado: positivo = el modelo sobreestima nubosidad; negativo = subestima. */
    sesgo_nubosidad_pct: number | null;
}

interface EstadoSkill {
    resumen: SkillResumen[];
    /** Muestras totales evaluadas en la ventana (suma de n_muestras). Útil para
     *  no mostrar el panel con confianza cuando hay muy pocos emparejamientos. */
    totalMuestras: number;
    cargando: boolean;
    error: string | null;
}

/**
 * Verificación de skill del pronóstico: qué tan bien acertó Open-Meteo contra
 * lo que las propias estaciones midieron después. Sin esto el sistema solo
 * consume el pronóstico, nunca lo audita — ver fn_clima_skill_resumen (RPC).
 */
export function useClimaSkill(diasVentana = 7) {
    const [estado, setEstado] = useState<EstadoSkill>({
        resumen: [], totalMuestras: 0, cargando: true, error: null,
    });

    useEffect(() => {
        let cancelado = false;
        const cargar = async () => {
            setEstado((s) => ({ ...s, cargando: true, error: null }));
            const { data, error } = await supabase.rpc('fn_clima_skill_resumen', { p_dias: diasVentana });
            if (cancelado) return;
            if (error) {
                setEstado({ resumen: [], totalMuestras: 0, cargando: false, error: error.message });
                return;
            }
            const resumen = (data ?? []) as SkillResumen[];
            const totalMuestras = resumen.reduce((acc, r) => acc + (r.n_muestras ?? 0), 0);
            setEstado({ resumen, totalMuestras, cargando: false, error: null });
        };
        cargar();
        return () => { cancelado = true; };
    }, [diasVentana]);

    return estado;
}
