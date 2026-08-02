/**
 * SICA 005 — Extractor de Contexto Hidráulico para Modelos de IA
 * ================================================================
 * Genera un archivo JSON + Markdown con el estado completo del
 * Canal Principal Conchos para la fecha indicada.
 *
 * Uso:  node extract_hydraulic_data.cjs [YYYY-MM-DD]
 *       (sin argumento = fecha de hoy)
 */

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const SUPABASE_URL  = 'https://dumfyrgwnshcgeibffvr.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const fecha = process.argv[2] || new Date().toISOString().slice(0, 10);
const tomorrow = new Date(new Date(fecha + 'T12:00:00').getTime() + 86400000)
  .toISOString().slice(0, 10);

// Directorio de salida: raíz del proyecto SICA 005
const OUT_DIR = path.resolve(__dirname, '..');

async function main() {
  console.log(`\n🌊 SICA 005 — Extrayendo contexto hidráulico para: ${fecha}\n`);

  const [
    { data: escalas },
    { data: movPresa },
    { data: lecturaPresa },
    { data: lecturas },
    { data: resumen },
    { data: reportes },
    { data: puntosEntrega },
    { data: perfil },
    { data: perfilRpc },
    { data: balance },
  ] = await Promise.all([
    supabase.from('escalas')
      .select('id, nombre, km, pzas_radiales, ancho, coeficiente_descarga, nivel_max_operativo')
      .gt('pzas_radiales', 0)
      .order('km', { ascending: true }),

    supabase.from('movimientos_presas')
      .select('id, presa_id, gasto_m3s, fecha_hora, fuente_dato, notas')
      .gte('fecha_hora', `${fecha}T00:00:00`)
      .lt('fecha_hora', `${tomorrow}T00:00:00`)
      .order('fecha_hora', { ascending: true }),

    supabase.from('lecturas_presas')
      .select('*')
      .eq('fecha', fecha)
      .limit(5),

    supabase.from('lecturas_escalas')
      .select('escala_id, nivel_m, apertura_radiales_m, gasto_calculado_m3s, turno, hora_lectura, fecha')
      .eq('fecha', fecha)
      .order('hora_lectura', { ascending: true }),

    supabase.from('resumen_escalas_diario')
      .select('escala_id, nivel_actual, gasto_calculado_m3s, delta_12h, lectura_am, lectura_pm, hora_am, hora_pm')
      .eq('fecha', fecha),

    supabase.from('reportes_diarios')
      .select('punto_id, punto_nombre, caudal_promedio_m3s, volumen_total_mm3, hora_apertura, hora_cierre, estado, modulo_nombre')
      .eq('fecha', fecha),

    supabase.from('puntos_entrega')
      .select('id, nombre, km, tipo')
      .not('km', 'is', null)
      .order('km', { ascending: true })
      .limit(300),

    supabase.from('perfil_hidraulico_canal')
      .select('km_inicio, km_fin, plantilla_m, talud_z, rugosidad_n, pendiente_s0, tirante_diseno_m, capacidad_diseno_m3s, bordo_libre_m')
      .order('km_inicio', { ascending: true }),

    supabase.rpc('fn_perfil_canal_completo', { p_fecha: fecha }),

    supabase.rpc('fn_balance_hidrico_tramos', { p_fecha: fecha }),
  ]);

  // Último movimiento global de presa
  const { data: lastMovGlobal } = await supabase
    .from('movimientos_presas')
    .select('gasto_m3s, fecha_hora, fuente_dato')
    .order('fecha_hora', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Enriquecer lecturas con nombre
  const escalaMap = new Map();
  (escalas || []).forEach(e => escalaMap.set(e.id, e));

  const lecturasEnriquecidas = (lecturas || []).map(l => {
    const esc = escalaMap.get(l.escala_id);
    return { ...l, escala_nombre: esc?.nombre ?? l.escala_id, escala_km: esc?.km ?? null };
  });

  // Enriquecer reportes con km
  const kmMap = new Map();
  (puntosEntrega || []).forEach(p => { if (p.km != null) kmMap.set(p.id, p.km); });

  const reportesEnriquecidos = (reportes || []).map(r => ({
    ...r, km: kmMap.get(r.punto_id) ?? null,
  })).sort((a, b) => (a.km ?? 999) - (b.km ?? 999));

  // Límites operativos
  const limitesOperativos = {
    tramo_general: { km_inicio: 0, km_fin: 96, y_min_m: 2.80, y_max_m: 3.50, descripcion: 'Tramos con tomas de riego activas - servicio ininterrumpido' },
    tramo_cola:    { km_inicio: 96, km_fin: 104, y_min_m: 2.40, y_max_m: 2.55, descripcion: 'Cola del canal - descarga libre sin tomas activas' },
  };

  const parametrosSistema = {
    canal: 'Canal Principal Conchos',
    distrito: 'DR-005 Delicias, Chihuahua, México',
    longitud_canal_km: 104,
    distancia_presa_k0_km: 36,
    presa: 'La Boquilla (Lago Toronto)',
    rio: 'Río Conchos (tramo Presa → Bocatoma K-0)',
    tipo_seccion: 'Trapezoidal revestida',
    capacidad_diseno_m3s: 60,
    velocidad_onda_ms: 1.2,
    coeficiente_descarga_compuertas: 0.62,
    rugosidad_manning_n: 0.014,
    eficiencia_conduccion_estimada: 0.88,
    perdida_rio_estimada_pct: 5,
    ecuacion_curva_calibracion: 'Q = Cd × H^n (Aforador Garganta Larga)',
    modelo_simulacion: 'Saint-Venant 1D simplificado (onda cinemática)',
    limite_operativo: limitesOperativos,
  };

  // ── Paquete JSON ─────────────────────────────────────────────────
  const paquete = {
    _meta: {
      version: '1.0.0',
      generado_por: 'SICA 005 — Conchos Digital',
      fecha_extraccion: fecha,
      hora_generacion_utc: new Date().toISOString(),
      proposito: 'Paquete de contexto hidráulico para alimentar modelos de Inteligencia Artificial. Contiene el estado completo del Canal Principal Conchos incluyendo: telemetría de presa, niveles en 12 puntos de control, aperturas de compuertas radiales, tomas activas, geometría del canal y balance hídrico. Diseñado para que un LLM pueda simular escenarios operativos, anticipar maniobras y optimizar la distribución del agua.',
      instrucciones_para_ia: [
        'Este archivo contiene datos hidráulicos reales del Canal Principal Conchos, Distrito de Riego 005, Chihuahua, México.',
        'El canal transporta agua desde la Presa La Boquilla hasta las zonas agrícolas a lo largo de 104 km.',
        'Los 12 puntos de control tienen compuertas radiales que regulan el nivel del agua (tirante).',
        'Los LÍMITES OPERATIVOS son críticos: si el tirante baja de y_min, las tomas de riego no reciben agua.',
        'La "onda" de un cambio de gasto en presa tarda ~1.2 m/s en propagarse por el canal.',
        'Usa estos datos para: (1) Simular el efecto de cambios de gasto en presa, (2) Proponer ajustes de compuertas radiales, (3) Anticipar problemas de nivel, (4) Calcular tiempos de arribo.',
        'Las fórmulas clave son: Manning (Q = (1/n)·A·R^(2/3)·S^(1/2)), Compuerta (Q = Cd·W·a·√(2g·h)), Balance (Q_entrada = Q_salida + Q_tomas + Q_pérdidas).',
        'El gasto de presa representa la extracción en la Presa La Boquilla. El agua recorre ~36 km de río antes de llegar al inicio del canal (K-0+000). La pérdida estimada en el tramo de río es del 5%.',
        'Cada punto de control tiene compuertas radiales verticales. La apertura se mide en metros desde el fondo. El gasto se calcula con Q = Cd × W × a × √(2g×h) donde W=ancho, a=apertura, h=tirante aguas arriba.',
      ],
    },

    parametros_sistema: parametrosSistema,

    estado_presa: {
      ultimo_movimiento_global: lastMovGlobal,
      movimientos_del_dia: movPresa || [],
      lectura_diaria: lecturaPresa || [],
      nota: 'ultimo_movimiento_global es el gasto vigente real de la presa (puede ser de días anteriores si hoy no hubo cambios). movimientos_del_dia son los cambios realizados exclusivamente en la fecha consultada.',
    },

    red_de_control: {
      puntos_de_control: (escalas || []).map(e => ({
        id: e.id,
        nombre: e.nombre,
        km: e.km,
        compuertas_radiales: e.pzas_radiales,
        ancho_compuerta_m: e.ancho,
        coeficiente_descarga: e.coeficiente_descarga ?? 0.62,
        nivel_max_operativo: e.nivel_max_operativo,
      })),
      total_puntos: (escalas || []).length,
    },

    lecturas_del_dia: {
      por_turno: lecturasEnriquecidas,
      resumen_diario: resumen || [],
      nota: 'nivel_m es el tirante medido en metros. apertura_radiales_m es la apertura de las compuertas. gasto_calculado_m3s se obtiene con la ecuación de compuerta o curva de calibración.',
    },

    tomas_y_entregas: {
      reportes: reportesEnriquecidos,
      total_tomas_activas: reportesEnriquecidos.filter(r => !r.hora_cierre && r.caudal_promedio_m3s > 0).length,
      caudal_total_activo_m3s: reportesEnriquecidos
        .filter(r => !r.hora_cierre && r.caudal_promedio_m3s > 0)
        .reduce((s, r) => s + (r.caudal_promedio_m3s ?? 0), 0),
      nota: 'Las tomas activas (estado=inicio/continua sin hora_cierre) extraen agua del canal. El simulador debe restarlas del gasto disponible en cada tramo.',
    },

    geometria_canal: {
      tramos: perfil || [],
      nota: 'Cada tramo define la sección transversal trapezoidal: plantilla_m (ancho de fondo), talud_z (relación H:V), rugosidad_n (Manning), pendiente_s0 (m/m). Usar para calcular tirante normal y capacidad.',
    },

    perfil_hidraulico_calculado: {
      datos: perfilRpc || [],
      nota: 'Perfil calculado por la función SQL fn_perfil_canal_completo. Incluye el Q de entrada real detectado por cascada (aforo > compuerta > presa) y el perfil de flujo gradualmente variado (GVF).',
    },

    balance_hidrico: {
      tramos: balance || [],
      nota: 'Balance entrada-salida por tramo. q_fuga_detectada > 0 indica posible pérdida o toma clandestina. estado_balance = FUGA_ALTA cuando la diferencia supera el 10%.',
    },
  };

  // ── Escribir JSON ────────────────────────────────────────────────
  const jsonPath = path.join(OUT_DIR, `SICA_005_contexto_hidraulico_${fecha}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(paquete, null, 2), 'utf-8');
  console.log(`✅ JSON generado: ${jsonPath}`);

  // ── Generar Markdown ─────────────────────────────────────────────
  let md = `# 🌊 SICA 005 — Contexto Hidráulico del Canal Principal Conchos\n`;
  md += `**Fecha:** ${fecha} · **Generado:** ${new Date().toISOString()}\n\n`;
  md += `---\n\n`;

  md += `## Instrucciones para el Modelo de IA\n\n`;
  paquete._meta.instrucciones_para_ia.forEach((inst, i) => { md += `${i+1}. ${inst}\n`; });
  md += `\n---\n\n`;

  md += `## 1. Estado de Presa La Boquilla\n\n`;
  if (lastMovGlobal) {
    md += `| Parámetro | Valor |\n|---|---|\n`;
    md += `| **Gasto vigente** | ${lastMovGlobal.gasto_m3s} m³/s |\n`;
    md += `| **Fecha/hora registro** | ${lastMovGlobal.fecha_hora} |\n`;
    md += `| **Fuente** | ${lastMovGlobal.fuente_dato} |\n\n`;
  }
  if ((movPresa || []).length > 0) {
    md += `### Movimientos del día (${fecha})\n\n`;
    md += `| Hora | Gasto (m³/s) | Fuente |\n|---|---|---|\n`;
    movPresa.forEach(m => { md += `| ${m.fecha_hora} | ${m.gasto_m3s} | ${m.fuente_dato || '—'} |\n`; });
    md += `\n`;
  } else { md += `> Sin movimientos de presa registrados hoy. El gasto vigente corresponde al último movimiento global.\n\n`; }

  md += `## 2. Red de Control — ${(escalas||[]).length} Puntos\n\n`;
  md += `| # | Nombre | KM | Compuertas | Ancho (m) | Cd |\n|---|---|---|---|---|---|\n`;
  (escalas||[]).forEach((e, i) => { md += `| ${i+1} | ${e.nombre} | ${e.km} | ${e.pzas_radiales} | ${e.ancho} | ${e.coeficiente_descarga ?? 0.62} |\n`; });
  md += `\n`;

  md += `## 3. Lecturas del Día — Niveles y Aperturas\n\n`;
  if (lecturasEnriquecidas.length > 0) {
    md += `| Escala | KM | Turno | Nivel (m) | Apertura (m) | Q calc. (m³/s) |\n|---|---|---|---|---|---|\n`;
    lecturasEnriquecidas.forEach(l => { md += `| ${l.escala_nombre} | ${l.escala_km ?? '—'} | ${l.turno} | ${l.nivel_m ?? '—'} | ${l.apertura_radiales_m ?? '—'} | ${l.gasto_calculado_m3s ?? '—'} |\n`; });
  } else { md += `> Sin lecturas registradas para hoy.\n`; }
  md += `\n`;

  md += `## 4. Tomas Activas y Entregas\n\n`;
  md += `**Total activas:** ${paquete.tomas_y_entregas.total_tomas_activas} · **Caudal total:** ${paquete.tomas_y_entregas.caudal_total_activo_m3s.toFixed(2)} m³/s\n\n`;
  if (reportesEnriquecidos.length > 0) {
    md += `| Punto | KM | Caudal (m³/s) | Vol. (Mm³) | Estado | Módulo |\n|---|---|---|---|---|---|\n`;
    reportesEnriquecidos.forEach(r => { md += `| ${r.punto_nombre ?? r.punto_id} | ${r.km ?? '—'} | ${r.caudal_promedio_m3s ?? 0} | ${r.volumen_total_mm3 ?? 0} | ${r.estado} | ${r.modulo_nombre ?? '—'} |\n`; });
  } else { md += `> Sin reportes de entrega para hoy.\n`; }
  md += `\n`;

  md += `## 5. Geometría del Canal (Perfil Hidráulico)\n\n`;
  if ((perfil||[]).length > 0) {
    md += `| Tramo | Plantilla (m) | Talud Z | n Manning | S₀ (m/m) | Tirante diseño (m) | Cap. diseño (m³/s) |\n|---|---|---|---|---|---|---|\n`;
    perfil.forEach(t => { md += `| K-${t.km_inicio}→K-${t.km_fin} | ${t.plantilla_m} | ${t.talud_z} | ${t.rugosidad_n} | ${t.pendiente_s0} | ${t.tirante_diseno_m} | ${t.capacidad_diseno_m3s} |\n`; });
  } else { md += `> Geometría no disponible en BD.\n`; }
  md += `\n`;

  md += `## 6. Balance Hídrico por Tramo\n\n`;
  if ((balance||[]).length > 0) {
    md += `| Tramo | Q entrada | Q salida | Q tomas | Q fuga | Estado |\n|---|---|---|---|---|---|\n`;
    balance.forEach(b => { md += `| ${b.escala_entrada}→${b.escala_salida} | ${b.q_entrada_m3s} | ${b.q_salida_m3s} | ${b.q_tomas_registradas} | ${b.q_fuga_detectada} | ${b.estado_balance} |\n`; });
  } else { md += `> Balance no disponible para hoy.\n`; }
  md += `\n`;

  md += `## 7. Límites Operativos\n\n`;
  md += `| Tramo | KM inicio | KM fin | Y mín (m) | Y máx (m) | Descripción |\n|---|---|---|---|---|---|\n`;
  md += `| General | 0 | 96 | 2.80 | 3.50 | ${limitesOperativos.tramo_general.descripcion} |\n`;
  md += `| Cola | 96 | 104 | 2.40 | 2.55 | ${limitesOperativos.tramo_cola.descripcion} |\n\n`;

  md += `## 8. Parámetros del Sistema\n\n`;
  md += `| Parámetro | Valor |\n|---|---|\n`;
  md += `| Canal | ${parametrosSistema.canal} |\n`;
  md += `| Distrito | ${parametrosSistema.distrito} |\n`;
  md += `| Longitud | ${parametrosSistema.longitud_canal_km} km |\n`;
  md += `| Distancia Presa→K-0 | ${parametrosSistema.distancia_presa_k0_km} km (río) |\n`;
  md += `| Capacidad de diseño | ${parametrosSistema.capacidad_diseno_m3s} m³/s |\n`;
  md += `| Velocidad de onda | ${parametrosSistema.velocidad_onda_ms} m/s |\n`;
  md += `| Rugosidad Manning | ${parametrosSistema.rugosidad_manning_n} |\n`;
  md += `| Eficiencia conducción | ${parametrosSistema.eficiencia_conduccion_estimada * 100}% |\n`;
  md += `| Modelo simulación | ${parametrosSistema.modelo_simulacion} |\n\n`;

  md += `---\n`;
  md += `*Generado automáticamente por SICA 005 — Conchos Digital · DR-005 Delicias, Chihuahua*\n`;

  const mdPath = path.join(OUT_DIR, `SICA_005_contexto_hidraulico_${fecha}.md`);
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`✅ Markdown generado: ${mdPath}`);

  // ── Resumen ──────────────────────────────────────────────────────
  console.log(`\n📊 Resumen de extracción:`);
  console.log(`   Puntos de control: ${(escalas||[]).length}`);
  console.log(`   Movimientos presa hoy: ${(movPresa||[]).length}`);
  console.log(`   Lecturas escalas hoy: ${lecturasEnriquecidas.length}`);
  console.log(`   Tomas activas: ${paquete.tomas_y_entregas.total_tomas_activas}`);
  console.log(`   Tramos geometría: ${(perfil||[]).length}`);
  console.log(`   Tramos balance: ${(balance||[]).length}`);
  console.log(`   Gasto vigente presa: ${lastMovGlobal?.gasto_m3s ?? '—'} m³/s`);
  console.log(`\n🎯 Archivos listos para compartir con cualquier modelo de IA.\n`);
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
