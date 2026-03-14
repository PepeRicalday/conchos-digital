
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function fix() {
    const today = '2026-03-14';
    const presaId = 'PRE-001'; // Boquilla
    const gasto = 30;

    console.log(`--- Corrigiendo Gasto en Boquilla para ${today} ---`);

    // 1. Obtener la última lectura para traer elevación y almacenamiento base
    const { data: latest } = await supabase
        .from('lecturas_presas')
        .select('*')
        .eq('presa_id', presaId)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

    console.log('Última lectura base:', latest?.fecha);

    const newReading = {
        presa_id: presaId,
        fecha: today,
        escala_msnm: latest?.escala_msnm || 1310.5, // Fallback razonable
        almacenamiento_mm3: latest?.almacenamiento_mm3 || 1241.1,
        porcentaje_llenado: latest?.porcentaje_llenado || 39.0,
        extraccion_total_m3s: gasto,
        gasto_toma_baja_m3s: gasto, // Asumimos toma baja para el llenado
        area_ha: latest?.area_ha || 15000,
        responsable: 'Sincronía Digital',
        notas: 'Apertura Protocolo LLENADO - 30 m3/s'
    };

    const { data, error } = await supabase
        .from('lecturas_presas')
        .upsert(newReading, { onConflict: 'presa_id,fecha' });

    if (error) {
        console.error('Error al insertar lectura:', error);
    } else {
        console.log('Lectura de presa insertada/actualizada con éxito.');
    }
}

fix();
