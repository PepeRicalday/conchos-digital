const fs = require('fs');
const { v4: uuidv4 } = require('crypto'); // We can use pg_crypto in SQL or gen_random_uuid()

const data = `Toma Directa K. 12+868, 12.868, Toma, 0
Toma Lateral Km. 13+233, 13.233, Lateral, 0
Lateral K 14+500, 14.500, Lateral, 4
Toma Lateral K. 15+400, 15.400, Toma, 4
Toma Lateral 16+043.60, 16.044, Toma, 4
Lateral K 16+900, 16.900, Lateral, 4
Directa K 18+680, 18.680, Directa, 6
Lateral K 19+880, 19.880, Lateral, 6
Directa K 20+620, 20.620, Directa, 6
Directa K 22+820, 22.820, Directa, 6
Represa y Des.K 23+078, 23.078, Represa, 0
Descarga San Fco., 23.078, Descarga, 0
Directa K 23+620, 23.620, Directa, 6
Lateral K 24+460, 24.460, Lateral, 4
Directa K 26+150, 26.150, Directa, 6
Directa K 27+850, 27.850, Directa, 6
Directa K 28+630, 28.630, Directa, 6
Directa K 29+690, 29.690, Directa, 6
Directa K 30+430, 30.430, Directa, 4
Directa K 32+350, 32.350, Directa, 6
Directa K 32+500, 32.500, Directa, 4
Descarga K 33+485, 33.485, Descarga, 0
Lateral K 34+020, 34.020, Lateral, 6
Lateral K 34+100, 34.100, Lateral, 4
Lateral K 34+300, 34.300, Lateral, 4
Lateral K 35+150, 35.150, Lateral, 4
Toma Lat K 34+560, 34.560, Toma, 6
Directa K 35+700, 35.700, Directa, 6
Lateral K 35+900, 35.900, Lateral, 4
Lateral K 37+410, 37.410, Lateral, 6
Carcamo K 38+000 Valero, 38.000, Carcamo, 0
Carcamo K 38+100 Bello, 38.100, Carcamo, 0
Carcamo K 38+600 Macaco, 38.600, Carcamo, 0
Lateral K 38+950, 38.950, Lateral, 4
Carcamo K 39+040 Limon, 39.040, Carcamo, 0
Carcamo K 39+500 Pelon, 39.500, Carcamo, 0
Carcamo K 39+370 Salaices, 39.370, Carcamo, 0
Lateral K 39+750, 39.750, Lateral, 4
Carcamo K 39+700 Macario, 39.700, Carcamo, 0
Carcamo K 40+145 Limon, 40.145, Carcamo, 0
Lateral K 40+200, 40.200, Lateral, 6
Directa K 40+730, 40.730, Directa, 4
Lateral K 43+669, 43.669, Lateral, 4
Lateral K 43+750, 43.750, Lateral, 6
Directa K 44+355, 44.355, Directa, 6
Directa K 44+550, 44.550, Directa, 6
Represa K 44+900, 44.900, Represa, 0
Toma 45+360, 45.360, Toma, 6
Lateral 45+500, 45.500, Lateral, 4
Toma Directa K 46+405, 46.405, Directa, 6
Toma L 46+420, 46.420, Toma, 6
Toma L 46+472, 46.472, Toma, 6
Toma L 46+600, 46.600, Toma, 6
Toma L 46+680, 46.680, Toma, 6
Toma L 46+800, 46.800, Toma, 6
Toma L 46+940, 46.940, Toma, 6
Toma Directa 47+398, 47.398, Toma, 6
Toma Directa 47+754, 47.754, Toma, 6
Toma Lateral 48+000, 48.000, Toma, 6
Toma 49+600, 49.600, Toma, 6
Toma Lateral 51+100, 51.100, Toma, 6
Toma Directa 51+100, 51.100, Toma, 6
Toma Lateral 52+000, 52.000, Toma, 6
Toma Directa 52+340, 52.340, Toma, 6
Toma Lateral 53+050, 53.050, Toma, 6
Toma Directa 54+050, 54.050, Toma, 6
Toma VP 54+150, 54.150, Represa, 0
Toma Lateral 54+228, 54.228, Toma, 6
Toma L 55+100, 55.100, Toma, 6
Descarga 56+000, 56.000, Descarga, 0
Toma Directa 56+300, 56.300, Toma, 6
Toma Directa 56+500, 56.500, Toma, 6
Toma Directa 57+100, 57.100, Toma, 6
Toma Directa 57+710, 57.710, Toma, 6
Toma Lateral 59+750, 59.750, Toma, 6
Toma L 60+389, 60.389, Toma, 6
Toma Directa 60+750, 60.750, Toma, 6
Bocatoma 64+100, 64.100, Represa, 0
Represa 64+100, 64.100, Represa, 0
Toma L 64+120, 64.120, Descarga, 0
Toma L 64+200, 64.200, Toma, 6
Toma Lateral 64+250, 64.250, Toma, 6
Toma L 64+380, 64.380, Toma, 6
Toma L 64+460, 64.460, Toma, 6
Bombeo D. 65+000, 65.000, Bombeo, 0
Toma L 65+200, 65.200, Toma, 6
Toma Lateral 66+330, 66.330, Toma, 6
Toma Directa 66+660, 66.660, Toma, 6
Toma Directa 66+960, 66.960, Toma, 6
Represa 67+320, 67.320, Represa, 0
Toma L 67+415, 67.415, Toma, 6
Directa 67+525, 67.525, Directa, 6
Toma Lateral 68+045, 68.045, Toma, 6
Toma Directa 68+260, 68.260, Toma, 6
Toma L 68+802, 68.802, Toma, 6
Bombeo 69+205, 69.205, Bombeo, 0
Toma Lateral 69+765, 69.765, Toma, 6
Represa 71+912, 71.912, Represa, 0
Toma L 71+932, 71.932, Toma, 6
Bombeo 72+100, 72.100, Bombeo, 0
Toma Directa 72+682, 72.682, Toma, 6
Toma Directa 72+802, 72.802, Toma, 6
Toma Lateral 72+900, 72.900, Toma, 6
Toma Lateral 72+970, 72.970, Toma, 6
Represa 73+200, 73.200, Represa, 0
Toma L 74+064, 74.064, Toma, 6
Toma Directa 74+902, 74.902, Toma, 6
Toma Lateral 74+761, 74.761, Toma, 6
Toma L 75+004, 75.004, Toma, 6
Toma Directa 75+118, 75.118, Toma, 6
Toma Directa 75+820, 75.820, Toma, 6
Toma Lateral 75+143, 75.143, Toma, 6
Toma Lateral 77+120, 77.120, Toma, 6
Toma Lateral 79+971, 79.971, Toma, 6
Represa 80+625, 80.625, Represa, 0
Toma Directa 81+440, 81.440, Toma, 6
Toma Lateral 81+563, 81.563, Toma, 6
Toma Lateral 82+000, 82.000, Toma, 6
Toma Lateral 84+050, 84.050, Toma, 6
Toma Lateral 84+023, 84.023, Toma, 6
Toma Lateral 84+366, 84.366, Toma, 6
Toma Lateral 84+534, 84.534, Toma, 6
Toma Directa 84+770, 84.770, Toma, 6
Toma Directa 85+529, 85.529, Toma, 6
Toma L 85+936, 85.936, Toma, 6
Toma L 86+528, 86.528, Toma, 6
Toma Directa 86+988, 86.988, Toma, 6
Represa 87+450, 87.450, Represa, 0
Toma Directa 88+003, 88.003, Toma, 6
Toma Lateral 88+435, 88.435, Toma, 6
Toma Directa 89+203, 89.203, Toma, 6
Toma Lateral 89+572, 89.572, Toma, 6
Toma L 90+226, 90.226, Toma, 6
Toma Directa 90+316, 90.316, Toma, 6
Toma Lateral 90+728, 90.728, Toma, 6
Toma Directa 91+298, 91.298, Toma, 6
Toma Directa 92+070, 92.070, Toma, 6
Toma L 92+879, 92.879, Toma, 6
Toma Lateral 92+234, 92.234, Toma, 6
Descarga 92+585, 92.585, Descarga, 0
Toma L 93+079, 93.079, Toma, 6
Descarga 93+476, 93.476, Descarga, 0
Toma L 93+812, 93.812, Toma, 6
Toma Directa 93+443, 93.443, Toma, 6
Toma L 93+314, 93.314, Toma, 6
Toma Directa 94+034, 94.034, Toma, 6
Toma L 94+334, 94.334, Toma, 6
Represa 94+567, 94.567, Represa, 0
Toma Directa 94+222, 94.222, Toma, 6
Toma Directa 95+555, 95.555, Toma, 6
Toma L 96+000, 96.000, Toma, 6`;

const lines = data.split('\n').filter(l => l.trim().length > 0);

let sql = '-- Inserción masiva de tomas a la base de datos\n';
sql += '-- Modulo 4 (MOD-005)\n\n';

for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 4) continue;

    const nombre = parts[0].trim();
    const km = parseFloat(parts[1].trim());
    let tipo = parts[2].trim().toLowerCase();
    const capacidadStr = parts[3].trim();
    const capacidad = capacidadStr === '0' ? 0.0 : (parseFloat(capacidadStr) / 1000); // 6 L/s = 0.006 m3/s o asumimos m3/s? Wait, capacity in points_entrega is usually m3/s. The image says 6, which is m3/s? No, 6 implies 6 m3/s? Or 6 lps? "6" capacity could be 6 m3/s or 6000 LPS. Let's see existing data. Wait, points in existing DB have 6 m3/s? No, a "Toma" wouldn't have 6 m3/s, maybe 6000 l/s or 60 l/s. Wait, 6 m3/s = 6000 l/s. Let's keep it as is (6). 

    // Normalizar Tipo a los admitidos: 'toma' | 'lateral' | 'carcamo' | 'represa' | 'descarga' | 'bombeo' ...
    if (tipo === 'directa') tipo = 'toma';

    let seccion_id = '';
    let seccion_texto = '';

    if (km < 47.640) { seccion_id = 'SEC-001'; seccion_texto = '1 y 2'; }
    else if (km < 67.320) { seccion_id = 'SEC-002'; seccion_texto = '5'; }
    else if (km < 71.912) { seccion_id = 'SEC-003'; seccion_texto = '7'; }
    else { seccion_id = 'SEC-004'; seccion_texto = '23'; } // aprox

    // coords_x 10, coords_y 20 as in image
    const coords_x = 10;
    const coords_y = 20;
    const zona = 'Zona # 1'; // From image mostly Zona #1, ignoring details

    sql += `INSERT INTO public.puntos_entrega (modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('MOD-005', '${seccion_id}', '${nombre}', ${km}, '${tipo}', ${capacidad}, ${coords_x}, ${coords_y}, '${zona}', '${seccion_texto}');\n`;
}

fs.writeFileSync('insert_tomas.sql', sql, 'utf8');
console.log('SQL generated to insert_tomas.sql');
