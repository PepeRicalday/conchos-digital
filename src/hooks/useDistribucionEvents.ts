import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface DistribucionEvent {
    id: string;
    punto_id: string;
    nombre_punto: string;
    km: number;
    gasto_m3s: number;
    fecha_hora: string;
    estado: string;
    notas: string;
}

export function useDistribucionEvents(fecha: string) {
    const [events, setEvents] = useState<DistribucionEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchEvents() {
            setLoading(true);
            try {
                // Fetch from mediciones table which stores raw events from SICA Capture
                const { data, error } = await supabase
                    .from('mediciones')
                    .select('id, punto_id, valor_q, fecha_hora, estado_evento, notas, puntos_entrega(nombre, km)')
                    .filter('fecha_hora', 'gte', `${fecha}T00:00:00`)
                    .filter('fecha_hora', 'lte', `${fecha}T23:59:59`)
                    .order('fecha_hora', { ascending: true });

                if (error) throw error;

                if (data) {
                    const mapped: DistribucionEvent[] = data.map((d: any) => ({
                        id: d.id,
                        punto_id: d.punto_id,
                        nombre_punto: d.puntos_entrega?.nombre || d.punto_id,
                        km: d.puntos_entrega?.km || 0,
                        gasto_m3s: d.valor_q || 0,
                        fecha_hora: d.fecha_hora,
                        estado: d.estado_evento || 'N/A',
                        notas: d.notas || ''
                    }));
                    setEvents(mapped);
                }
            } catch (err) {
                console.error('Error fetching distribution events:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchEvents();
    }, [fecha]);

    return { events, loading };
}
