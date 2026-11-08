// Genera el SQL de siembra (aqwp_ubicaciones / aqwp_datasets) desde el catálogo vivo del portal AQWP.
// Uso: node scripts/aqwp_generar_seed.mjs > supabase/migrations/20261108110000_aqwp_seed_catalogo.sql
const B = 'https://waterdata.ibwc.gov/AQWebportal';
const UBIC = [
  [536, 'La Boquilla', 'presa', 'PRE-001'], [537, 'Francisco I. Madero', 'presa', 'PRE-002'],
  [538, 'Chihuahua', 'presa', null], [539, 'El Rejón', 'presa', null], [540, 'Pico del Águila', 'presa', null],
  [541, 'San Gabriel', 'presa', null], [526, 'Luis L. León', 'presa', null],
  [230, 'Río Conchos cerca de Ojinaga', 'aforo', null],
];
// Id del dataset en el portal -> [magnitud, prefijo del Title, unidad]
const MAG = {
  'CONAGUA-Daily-Storage': ['almacenamiento', 'Total Storage', 'Mm3'],
  'CONAGUA-Daily-Inflow': ['aportacion', 'Discharge', 'm3/s'],
  'CONAGUA-Daily-Release': ['extraccion', 'Discharge', 'm3/s'],
  'CONAGUA-Daily-Spill': ['vertido', 'Discharge', 'm3/s'],
  'CONAGUA-Daily-Total-Release': ['extraccion_total', 'Discharge', 'm3/s'],
  'CONAGUA-Daily-Percent-NAMO': ['pct_namo', 'Percentage', '%'],
  'CONAGUA-Daily-NAMO': ['namo', 'Total Storage', 'Mm3'],
  'CONAGUA-Daily-Dead-Storage': ['almacenamiento_muerto', 'Total Storage', 'Mm3'],
  'CONAGUA-Daily-Change-Storage': ['cambio_almacenamiento', 'Discharge Total', 'Mm3'],
  'Daily Rounded': ['gasto', 'Discharge', 'm3/s'],
  'Preliminary-Daily-Volume-TCM': ['volumen_tcm', 'Discharge Total', 'TCM'],
};
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const ub = [], ds = [];
for (const [idn, nombre, tipo, presa] of UBIC) {
  const arr = await (await fetch(`${B}/Data/DataSets?locationid=${idn}`)).json();
  const cod = arr[0].LocationIdentifier;
  ub.push(`(${idn}, ${q(cod)}, ${q(nombre)}, ${q(tipo)}, ${q(presa)})`);
  for (const d of arr) {
    const m = MAG[d.Id];
    if (!m || !d.EndTime) continue;
    if (d.ParameterName === 'Discharge' && m[0] === 'gasto' && !/^Daily Rounded$/.test(d.Id)) continue;
    ds.push(`(${d.IDNumber}, ${idn}, ${q(`${m[1]}.${d.Id}@${cod}`)}, ${q(m[0])}, ${q(m[2])}, ${q(d.StartTime.slice(0, 10))})`);
  }
}
console.log(`-- Catálogo AQWP (generado por scripts/aqwp_generar_seed.mjs el ${new Date().toISOString().slice(0, 10)}).
-- titulo = identificador EXACTO que pide el export (OJO: "Total Storage", no "Total Reservoir Storage").
INSERT INTO public.aqwp_ubicaciones (id_number, codigo, nombre, tipo, presa_id) VALUES
${ub.join(',\n')}
ON CONFLICT (id_number) DO UPDATE SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, presa_id = EXCLUDED.presa_id;

INSERT INTO public.aqwp_datasets (id_number, ubicacion_id, titulo, magnitud, unidad, desde) VALUES
${ds.join(',\n')}
ON CONFLICT (id_number) DO UPDATE SET titulo = EXCLUDED.titulo, magnitud = EXCLUDED.magnitud, unidad = EXCLUDED.unidad, desde = EXCLUDED.desde;`);
