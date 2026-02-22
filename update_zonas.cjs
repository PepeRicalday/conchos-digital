const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const updates = [
    { km: 12.868, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 13.233, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 14.500, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 15.400, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 16.044, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 16.900, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 18.680, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 19.880, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 20.620, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 22.820, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 23.078, zona: 'Zona # 1', sec_txt: '1 y 2' },
    { km: 23.620, zona: 'Zona # 1', sec_txt: '3' },
    { km: 24.460, zona: 'Zona # 1', sec_txt: '3' },
    { km: 26.150, zona: 'Zona # 1', sec_txt: '3' },
    { km: 27.850, zona: 'Zona # 1', sec_txt: '3' },
    { km: 28.630, zona: 'Zona # 1', sec_txt: '4' },
    { km: 29.690, zona: 'Zona # 1', sec_txt: '4' },
    { km: 30.430, zona: 'Zona # 1', sec_txt: '4' },
    { km: 32.350, zona: 'Zona # 1', sec_txt: '4' },
    { km: 32.500, zona: 'Zona # 1', sec_txt: '4' },
    { km: 33.485, zona: 'Zona # 1', sec_txt: '4' },
    { km: 34.020, zona: 'Zona # 1', sec_txt: '4' },
    { km: 34.100, zona: 'Zona # 1', sec_txt: '4' },
    { km: 34.300, zona: 'Zona # 1', sec_txt: '4' },
    { km: 35.150, zona: 'Zona # 1', sec_txt: '4' },
    { km: 34.560, zona: 'Zona # 1', sec_txt: '4' },
    { km: 35.700, zona: 'Zona # 1', sec_txt: '4' },
    { km: 35.900, zona: 'Zona # 1', sec_txt: '4' },
    { km: 37.410, zona: 'Zona # 1', sec_txt: '4' },
    { km: 38.000, zona: 'Zona # 1', sec_txt: '4' },
    { km: 38.100, zona: 'Zona # 1', sec_txt: '4' },
    { km: 38.600, zona: 'Zona # 1', sec_txt: '4' },
    { km: 38.950, zona: 'Zona # 1', sec_txt: '4' },
    { km: 39.040, zona: 'Zona # 1', sec_txt: '4' },
    { km: 39.500, zona: 'Zona # 1', sec_txt: '4' },
    { km: 39.370, zona: 'Zona # 1', sec_txt: '4' },
    { km: 39.750, zona: 'Zona # 1', sec_txt: '4' },
    { km: 39.700, zona: 'Zona # 1', sec_txt: '4' },
    { km: 40.145, zona: 'Zona # 1', sec_txt: '4' },
    { km: 40.200, zona: 'Zona # 1', sec_txt: '4' },
    { km: 40.730, zona: 'Zona # 1', sec_txt: '5' },
    { km: 43.669, zona: 'Zona # 1', sec_txt: '5' },
    { km: 43.750, zona: 'Zona # 1', sec_txt: '5' },
    { km: 44.355, zona: 'Zona # 1', sec_txt: '5' },
    { km: 44.550, zona: 'Zona # 1', sec_txt: '5' },
    { km: 44.900, zona: 'Zona # 1', sec_txt: '5' },
    { km: 45.360, zona: 'Zona # 1', sec_txt: '5' },
    { km: 45.500, zona: 'Zona # 1', sec_txt: '5' },
    { km: 46.405, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.420, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.472, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.600, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.680, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.800, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 46.940, zona: 'Zona # 2', sec_txt: 'M 12' },
    { km: 47.398, zona: 'Zona # 3', sec_txt: '6' },
    { km: 47.754, zona: 'Zona # 3', sec_txt: '6' },
    { km: 48.000, zona: 'Zona # 3', sec_txt: '6' },
    { km: 49.600, zona: 'Zona # 3', sec_txt: '6' },
    { km: 51.100, zona: 'Zona # 3', sec_txt: '6' },
    { km: 52.000, zona: 'Zona # 3', sec_txt: '6' },
    { km: 52.340, zona: 'Zona # 3', sec_txt: '6' },
    { km: 53.050, zona: 'Zona # 3', sec_txt: '6' },
    { km: 54.050, zona: 'Zona # 3', sec_txt: '6' },
    { km: 54.150, zona: 'Zona # 3', sec_txt: '6' },
    { km: 54.228, zona: 'Zona # 3', sec_txt: '6' },
    { km: 55.100, zona: 'Zona # 3', sec_txt: '6' },
    { km: 56.000, zona: 'Zona # 3', sec_txt: '6' },
    { km: 56.300, zona: 'Zona # 3', sec_txt: '7' },
    { km: 56.500, zona: 'Zona # 3', sec_txt: '7' },
    { km: 57.100, zona: 'Zona # 3', sec_txt: '7' },
    { km: 57.710, zona: 'Zona # 3', sec_txt: '7' },
    { km: 59.750, zona: 'Zona # 3', sec_txt: '7' },
    { km: 60.389, zona: 'Zona # 3', sec_txt: '7' },
    { km: 60.750, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.100, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.120, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.200, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.250, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.380, zona: 'Zona # 3', sec_txt: '7' },
    { km: 64.460, zona: 'Zona # 3', sec_txt: '7' },
    { km: 65.000, zona: 'Zona # 3', sec_txt: '8' },
    { km: 65.200, zona: 'Zona # 3', sec_txt: '8' },
    { km: 66.330, zona: 'Zona # 3', sec_txt: '8' },
    { km: 66.660, zona: 'Zona # 3', sec_txt: '8' },
    { km: 66.960, zona: 'Zona # 3', sec_txt: '8' },
    { km: 67.320, zona: 'Zona # 3', sec_txt: '8' },
    { km: 67.415, zona: 'Zona # 3', sec_txt: '8/18' },
    { km: 67.525, zona: 'Zona # 3', sec_txt: '8/18' },
    { km: 68.045, zona: 'Zona # 3', sec_txt: '8' },
    { km: 68.260, zona: 'Zona # 3', sec_txt: '8' },
    { km: 68.802, zona: 'Zona # 3', sec_txt: '8' },
    { km: 69.205, zona: 'Zona # 3', sec_txt: '18 1D' },
    { km: 69.765, zona: 'Zona # 3', sec_txt: '18' },
    { km: 71.912, zona: 'Zona # 3', sec_txt: '18' },
    { km: 71.932, zona: 'Zona # 3', sec_txt: '24 LI' },
    { km: 72.100, zona: 'Zona # 3', sec_txt: '24 LI' },
    { km: 72.682, zona: 'Zona # 3', sec_txt: '24 LI' },
    { km: 72.802, zona: 'Zona # 3', sec_txt: '18' },
    { km: 72.900, zona: 'Zona # 3', sec_txt: '18' },
    { km: 72.970, zona: 'Zona # 4', sec_txt: '18' },
    { km: 73.200, zona: 'Zona # 4', sec_txt: '18' },
    { km: 74.064, zona: 'Zona # 4', sec_txt: '18' },
    { km: 74.902, zona: 'Zona # 4', sec_txt: '20' },
    { km: 74.761, zona: 'Zona # 4', sec_txt: '20' },
    { km: 75.004, zona: 'Zona # 4', sec_txt: '20' },
    { km: 75.118, zona: 'Zona # 4', sec_txt: '20' },
    { km: 75.820, zona: 'Zona # 4', sec_txt: '22' },
    { km: 75.143, zona: 'Zona # 4', sec_txt: '22' },
    { km: 77.120, zona: 'Zona # 4', sec_txt: '22' },
    { km: 79.971, zona: 'Zona # 4', sec_txt: '22' },
    { km: 80.625, zona: 'Zona # 4', sec_txt: '22' },
    { km: 81.440, zona: 'Zona # 4', sec_txt: '22' },
    { km: 81.563, zona: 'Zona # 4', sec_txt: '22' },
    { km: 82.000, zona: 'Zona # 4', sec_txt: '22' },
    { km: 84.050, zona: 'Zona # 4', sec_txt: '23' },
    { km: 84.023, zona: 'Zona # 4', sec_txt: '23' },
    { km: 84.366, zona: 'Zona # 4', sec_txt: '23' },
    { km: 84.534, zona: 'Zona # 4', sec_txt: '23' },
    { km: 84.770, zona: 'Zona # 4', sec_txt: '23' },
    { km: 85.529, zona: 'Zona # 4', sec_txt: '23' },
    { km: 85.936, zona: 'Zona # 4', sec_txt: '23' },
    { km: 86.528, zona: 'Zona # 4', sec_txt: '23' },
    { km: 86.988, zona: 'Zona # 4', sec_txt: '23' },
    { km: 87.450, zona: 'Zona # 4', sec_txt: '23' },
    { km: 88.003, zona: 'Zona # 4', sec_txt: '23' },
    { km: 88.435, zona: 'Zona # 4', sec_txt: '23' },
    { km: 89.203, zona: 'Zona # 4', sec_txt: '23' },
    { km: 89.572, zona: 'Zona # 4', sec_txt: '23' },
    { km: 90.226, zona: 'Zona # 4', sec_txt: '23' },
    { km: 90.316, zona: 'Zona # 4', sec_txt: '24' },
    { km: 90.728, zona: 'Zona # 4', sec_txt: '24' },
    { km: 91.298, zona: 'Zona # 4', sec_txt: '24' },
    { km: 92.070, zona: 'Zona # 4', sec_txt: '24' },
    { km: 92.879, zona: 'Zona # 4', sec_txt: '24' },
    { km: 92.234, zona: 'Zona # 4', sec_txt: '24' },
    { km: 92.585, zona: 'Zona # 4', sec_txt: '24' },
    { km: 93.079, zona: 'Zona # 4', sec_txt: '24' },
    { km: 93.476, zona: 'Zona # 4', sec_txt: '24' },
    { km: 93.812, zona: 'Zona # 4', sec_txt: '24' },
    { km: 93.443, zona: 'Zona # 4', sec_txt: '24' },
    { km: 93.314, zona: 'Zona # 4', sec_txt: '24' },
    { km: 94.034, zona: 'Zona # 4', sec_txt: '24' },
    { km: 94.334, zona: 'Zona # 4', sec_txt: '24' },
    { km: 94.567, zona: 'Zona # 4', sec_txt: '24' },
    { km: 94.222, zona: 'Zona # 4', sec_txt: '24' },
    { km: 95.555, zona: 'Zona # 4', sec_txt: '24' },
    { km: 96.000, zona: 'Zona # 4', sec_txt: '24' }
];

async function updateTomas() {
    let successCount = 0;
    for (const item of updates) {
        let seccion_id = '';
        if (item.zona === 'Zona # 1') seccion_id = 'SEC-001';
        else if (item.zona === 'Zona # 2') seccion_id = 'SEC-002';
        else if (item.zona === 'Zona # 3') seccion_id = 'SEC-003';
        else if (item.zona === 'Zona # 4') seccion_id = 'SEC-004';

        const { data, error } = await supabase
            .from('puntos_entrega')
            .update({ zona: item.zona, seccion_texto: item.sec_txt, seccion_id })
            .eq('modulo_id', 'MOD-005')
            .eq('km', item.km);

        if (error) {
            console.error(`Error en km ${item.km}:`, error);
        } else {
            successCount++;
        }
    }
    console.log(`Updated ${successCount} entries!`);
}

updateTomas();
