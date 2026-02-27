const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function seedData() {
    console.log('Starting seed process for official CONAGUA format...');

    const days = 7;
    const now = new Date();

    for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        console.log(`Seeding day: ${dateStr}`);

        // 1. Lecturas Presas (Hydraulics)
        const lecturas = [
            {
                presa_id: 'PRE-001', // Boquilla
                fecha: dateStr,
                escala_msnm: 1317.00 - (i * 0.05),
                almacenamiento_mm3: 1081.6 - (i * 2),
                porcentaje_llenado: 37.9,
                extraccion_total_m3s: i % 2 === 0 ? 0 : 45.5,
                gasto_toma_baja_m3s: i % 2 === 0 ? 0 : 25.0,
                gasto_cfe_m3s: i % 2 === 0 ? 0 : 20.5,
                responsable: 'Taide Ramírez'
            },
            {
                presa_id: 'PRE-002', // Madero
                fecha: dateStr,
                escala_msnm: 1239.30 - (i * 0.02),
                almacenamiento_mm3: 232.0 - (i * 0.5),
                porcentaje_llenado: 69.6,
                extraccion_total_m3s: 0,
                responsable: 'Taide Ramírez'
            }
        ];

        const { error: errL } = await supabase.from('lecturas_presas').upsert(lecturas, { onConflict: 'presa_id, fecha' });
        if (errL) console.error('Error lecturas:', errL);

        // 2. Clima Presas
        const climas = [
            {
                presa_id: 'PRE-001',
                fecha: dateStr,
                temp_ambiente_c: 18 + (Math.random() * 5),
                temp_maxima_c: 25 + (Math.random() * 5),
                temp_minima_c: 8 + (Math.random() * 5),
                precipitacion_mm: Math.random() > 0.8 ? 15 : 0,
                evaporacion_mm: 4 + Math.random(),
                dir_viento: 'SW',
                intensidad_viento: 'Calma',
                visibilidad: 'Buena',
                edo_tiempo: 'Despejado'
            },
            {
                presa_id: 'PRE-002',
                fecha: dateStr,
                temp_ambiente_c: 19 + (Math.random() * 5),
                temp_maxima_c: 26 + (Math.random() * 5),
                temp_minima_c: 9 + (Math.random() * 5),
                precipitacion_mm: 0,
                evaporacion_mm: 5 + Math.random(),
                dir_viento: 'W',
                intensidad_viento: 'Ligera',
                visibilidad: '4T',
                edo_tiempo: 'Nuvlado'
            },
            {
                presa_id: 'PRE-003', // Delicias
                fecha: dateStr,
                temp_ambiente_c: 22 + (Math.random() * 5),
                temp_maxima_c: 30 + (Math.random() * 4),
                temp_minima_c: 12 + (Math.random() * 3),
                precipitacion_mm: 0,
                evaporacion_mm: 7.5,
                dir_viento: 'S',
                intensidad_viento: 'Fuerte',
                visibilidad: '10km',
                edo_tiempo: 'Soleado'
            }
        ];

        const { error: errC } = await supabase.from('clima_presas').upsert(climas, { onConflict: 'presa_id, fecha' });
        if (errC) console.error('Error clima:', errC);

        // 3. Aforos Principales
        const aforos = [
            { fecha: dateStr, estacion: 'Km 0+580', escala: 1.20 + (Math.random() * 0.5), gasto_m3s: 45.5 - (i * 0.1) },
            { fecha: dateStr, estacion: 'Km 106', escala: 0.80 + (Math.random() * 0.2), gasto_m3s: 15.0 },
            { fecha: dateStr, estacion: 'Km 104', escala: 1.10 + (Math.random() * 0.3), gasto_m3s: 32.2 }
        ];

        const { error: errA } = await supabase.from('aforos_principales_diarios').upsert(aforos, { onConflict: 'fecha, estacion' });
        if (errA) console.error('Error aforos:', errA);
    }

    console.log('Seeding completed.');
}

seedData();
