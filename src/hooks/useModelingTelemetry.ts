import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { getTodayString, addDays, formatTime } from '../utils/dateHelpers';
import {
  DEFAULT_CPS, CD_GATE, FREEBOARD, PLANTILLA, TALUD_Z, MANNING_N, S0_CANAL,
  safeFloat,
  type ControlPoint, type CPTelemetry, type DeliveryData, type DataStatus,
  type BalanceTramo, type TramoGeom,
} from '../utils/modelingTypes';

const INITIAL_DATA_STATUS: DataStatus = {
  dam: false, gates: false, levels: false, deliveries: false,
  timestamp: '',
  damBaseValue: 0, damCurrentValue: 0,
  damNivel: '—', damFuente: 'estimado',
  totalExtractionM3s: 0,
};

/**
 * Telemetría real de ModelingDashboard — extraído del useEffect de fetch
 * principal (antes ~480 líneas inline). 9 queries en paralelo + RPCs que
 * alimentan el estado fundacional del motor de simulación: puntos de
 * control, lecturas base, aperturas, geometría y balance por tramo.
 *
 * gateOverrides, gateBase, qDam, qBase, activeCP y simBaseMin NO viven
 * aquí a propósito: el usuario los edita interactivamente en el resto de
 * ModelingDashboard.tsx (slider de compuerta, slider de Q presa, click en
 * punto de control). Este hook solo los INICIALIZA vía los setters que
 * recibe como parámetro — el estado sigue siendo dueño del componente.
 */
export function useModelingTelemetry(setters: {
  setGateBase: (v: Record<string, number>) => void;
  setGateOverrides: (v: Record<string, number>) => void;
  setQBase: (v: number) => void;
  setQDam: (v: number) => void;
  setSimBaseMin: (v: number) => void;
  setActiveCP: (v: string) => void;
}) {
  const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
  const [baseReadings, setBaseReadings] = useState<Record<string, number>>({});
  const [cpTelemetry, setCpTelemetry] = useState<Record<string, CPTelemetry>>({});
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryData[]>([]);
  const [dataStatus, setDataStatus] = useState<DataStatus>(INITIAL_DATA_STATUS);
  // false hasta que fetchData complete al menos una carga exitosa
  const [dataLoaded, setDataLoaded] = useState(false);
  // Geometría real por tramo (perfil_hidraulico_canal)
  const [tramoGeom, setTramoGeom] = useState<TramoGeom[]>([]);
  // Perfil hidráulico real del RPC (fn_perfil_canal_completo) para línea ámbar
  const [perfilRpc, setPerfilRpc] = useState<any[]>([]);
  // Balance hídrico por tramo (fn_balance_hidrico_tramos)
  const [balanceTramos, setBalanceTramos] = useState<BalanceTramo[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      // 1. Puntos de control con Cd real por estructura
      const { data: cpData } = await supabase
        .from('escalas')
        .select('id, nombre, km, pzas_radiales, ancho, coeficiente_descarga, nivel_max_operativo')
        .gt('pzas_radiales', 0)
        .order('km', { ascending: true });

      // P2-9: addDays usa noon-UTC — correcto en cambio de horario (86400000ms no cubre DST)
      const today = getTodayString();
      const tomorrow = addDays(today, 1);

      // 2. Todas las fuentes en paralelo — 9 queries simultáneas
      const [
        { data: summary },
        { data: rawAM },        // turno AM de hoy = estado base del canal
        { data: rawLatest },    // lecturas más recientes = estado actual
        { data: firstMovPresa },// PRIMER movimiento de presa del día → qBase
        { data: lastMovPresa }, // ÚLTIMO movimiento de presa del día → qDam inicial
        { data: lecturaHoy },   // lecturas_presas hoy (respaldo)
        { data: rawReportes },  // reportes_diarios hoy → volúmenes puntos de entrega
        { data: rawPuntos },    // puntos_entrega → km de cada toma/lateral
        { data: rawPerfil },    // perfil_hidraulico_canal → geometría real por tramo
        { data: rawPerfilRpc }, // fn_perfil_canal_completo → perfil hidráulico real
        { data: rawBalance },   // fn_balance_hidrico_tramos → fugas detectadas por tramo
      ] = await Promise.all([
        // Resumen diario con AM/PM y delta 12h
        supabase.from('resumen_escalas_diario')
          .select('escala_id, nivel_actual, gasto_calculado_m3s, delta_12h, lectura_am, lectura_pm, hora_am, hora_pm')
          .eq('fecha', today),

        // Lecturas AM de hoy: nivel base que corresponde al Q inicial
        supabase.from('lecturas_escalas')
          .select('escala_id, nivel_m, apertura_radiales_m, gasto_calculado_m3s')
          .eq('fecha', today)
          .eq('turno', 'am')
          .order('hora_lectura', { ascending: true })
          .limit(50),

        // Lecturas más recientes (cualquier día) para estado actual de aperturas
        supabase.from('lecturas_escalas')
          .select('escala_id, nivel_m, apertura_radiales_m, gasto_calculado_m3s')
          .order('fecha', { ascending: false })
          .order('hora_lectura', { ascending: false })
          .limit(100),

        // PRIMER movimiento de presa hoy = Q0 base de la simulación
        supabase.from('movimientos_presas')
          .select('gasto_m3s, fecha_hora, fuente_dato')
          .gte('fecha_hora', `${today}T00:00:00`)
          .lt('fecha_hora', `${tomorrow}T00:00:00`)
          .order('fecha_hora', { ascending: true })
          .limit(1)
          .maybeSingle(),

        // ÚLTIMO movimiento de presa (estado actual real, puede ser de días anteriores)
        supabase.from('movimientos_presas')
          .select('gasto_m3s, fecha_hora, fuente_dato')
          .order('fecha_hora', { ascending: false })
          .limit(1)
          .maybeSingle(),

        // lecturas_presas de hoy (respaldo si no hay movimientos)
        supabase.from('lecturas_presas')
          .select('extraccion_total_m3s, escala_msnm, fecha')
          .eq('fecha', today)
          .maybeSingle(),

        // Reportes diarios de hoy — caudal y volumen entregado por punto de entrega
        // Solo registros del día actual para escenario más actualizado
        supabase.from('reportes_diarios')
          .select('punto_id, punto_nombre, caudal_promedio_m3s, volumen_total_mm3, hora_apertura, hora_cierre, estado, modulo_nombre')
          .eq('fecha', today),

        // Posición km de cada punto de entrega (necesaria para ubicarlos en el canal)
        supabase.from('puntos_entrega')
          .select('id, nombre, km, tipo')
          .not('km', 'is', null)
          .order('km', { ascending: true })
          .limit(300),

        // Geometría hidráulica real por tramo — Fase 1: reemplaza constantes globales
        supabase.from('perfil_hidraulico_canal')
          .select('km_inicio, km_fin, plantilla_m, talud_z, rugosidad_n, pendiente_s0, tirante_diseno_m, capacidad_diseno_m3s, bordo_libre_m')
          .order('km_inicio', { ascending: true }),

        // Perfil hidráulico real del canal (cascada Q + GVF SQL)
        supabase.rpc('fn_perfil_canal_completo', { p_fecha: today }),

        // Balance hídrico por tramo — fugas detectadas
        supabase.rpc('fn_balance_hidrico_tramos', { p_fecha: today }),
      ]);

      // 3. Construir lista de puntos de control — safeFloat en todos los campos numéricos
      // para blindar NaN cuando Supabase devuelve null en columnas numéricas (null*n = 0, undefined*n = NaN)
      const cps: ControlPoint[] = (cpData && cpData.length > 0)
        ? cpData
            .map(c => ({
              id: c.id,
              nombre: c.nombre || `K-${c.km}`,
              km: safeFloat(c.km, NaN),
              pzas_radiales: Math.max(1, safeFloat(c.pzas_radiales, 1)),
              ancho: Math.max(1, safeFloat(c.ancho, 8)),
              coeficiente_descarga: c.coeficiente_descarga != null
                ? safeFloat(c.coeficiente_descarga, CD_GATE) : undefined,
              nivel_max_op: c.nivel_max_operativo != null
                ? safeFloat(c.nivel_max_operativo, FREEBOARD) : undefined,
            }))
            .filter(c => Number.isFinite(c.km))  // elimina registros sin KM válido
        : [...DEFAULT_CPS];

      if (!cps.some(p => p.km >= 100)) {
        cps.push({ id: 'k104', nombre: 'K-104 Final Canal', km: 104, pzas_radiales: 1, ancho: 6 });
      }
      setControlPoints(cps);
      setters.setActiveCP(cps[0]?.id ?? '');

      // 4. y_base = lecturas más actuales de SICA Capture
      // Prioridad: rawLatest (registro más reciente de hoy/ayer) > lectura_pm (resumen) > lectura_am > rawAM
      // Se filtra v > 0.05 para evitar que lecturas 0 o nulas contaminen la base hidráulica
      const lvlMap = new Map<string, number>();
      // 1º rawLatest — el registro más reciente disponible (lectura actual del canal)
      rawLatest?.forEach(r => {
        const v = safeFloat(r.nivel_m, NaN);
        if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
      });
      // 2º lectura_pm del resumen (lectura de tarde, si rawLatest no tiene dato)
      summary?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.lectura_pm, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      // 3º lectura_am del resumen
      summary?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.lectura_am, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      // 4º rawAM como último respaldo
      rawAM?.forEach(r => {
        if (!lvlMap.has(r.escala_id)) {
          const v = safeFloat(r.nivel_m, NaN);
          if (Number.isFinite(v) && v > 0.05) lvlMap.set(r.escala_id, v);
        }
      });
      const rm: Record<string, number> = {};
      cps.forEach(cp => { if (lvlMap.has(cp.id)) rm[cp.id] = lvlMap.get(cp.id)!; });

      // Overlay: RPC nivel_real_m es más preciso que lecturas_escalas raw
      // (usa nivel_abajo_m en K0+000, aplica la misma lógica que el perfil SQL)
      let rpcQ: number | null = null;
      let rpcFuente: string | null = null;
      if (rawPerfilRpc && rawPerfilRpc.length > 0) {
        const firstRow = rawPerfilRpc[0] as any;
        const fq = safeFloat(firstRow?.q_m3s, 0);
        if (fq > 0) rpcQ = fq;
        rpcFuente = firstRow?.fuente_q_entrada ?? null;
        (rawPerfilRpc as any[]).forEach(row => {
          const rpcKm = safeFloat(row.km_ref, NaN);
          const rpcNivel = safeFloat(row.nivel_real_m, NaN);
          if (!Number.isFinite(rpcKm) || !Number.isFinite(rpcNivel) || rpcNivel <= 0.05) return;
          const cp = cps.find(c => Math.abs(c.km - rpcKm) < 2.0);
          if (cp) rm[cp.id] = rpcNivel;
        });
      }

      setBaseReadings(rm);
      setPerfilRpc(rawPerfilRpc ?? []);
      setBalanceTramos(
        ((rawBalance ?? []) as any[]).map(r => ({
          km_inicio: safeFloat(r.km_inicio, 0),
          km_fin: safeFloat(r.km_fin, 0),
          escala_entrada: r.escala_entrada ?? '',
          escala_salida: r.escala_salida ?? '',
          q_entrada_m3s: safeFloat(r.q_entrada_m3s, 0),
          q_salida_m3s: safeFloat(r.q_salida_m3s, 0),
          q_tomas_registradas: safeFloat(r.q_tomas_registradas, 0),
          q_fuga_detectada: safeFloat(r.q_fuga_detectada, 0),
          estado_balance: r.estado_balance ?? 'BALANCEADO',
        }))
      );
      const hasLevels = Object.keys(rm).length > 0;

      // 5. Aperturas — safeFloat en todos los parseos
      const gateMapAM = new Map<string, number>();
      rawAM?.forEach(r => {
        if (!gateMapAM.has(r.escala_id)) {
          const v = safeFloat(r.apertura_radiales_m, 0);
          if (v > 0) gateMapAM.set(r.escala_id, v);
        }
      });
      const gateMapCurrent = new Map<string, number>();
      rawLatest?.forEach(r => {
        if (!gateMapCurrent.has(r.escala_id)) {
          const v = safeFloat(r.apertura_radiales_m, 0);
          if (v > 0) gateMapCurrent.set(r.escala_id, v);
        }
      });
      cps.forEach(cp => {
        if (!gateMapAM.has(cp.id) && gateMapCurrent.has(cp.id)) {
          gateMapAM.set(cp.id, gateMapCurrent.get(cp.id)!);
        }
      });
      const gb: Record<string, number> = {};
      const go: Record<string, number> = {};
      cps.forEach(cp => {
        if (gateMapAM.has(cp.id)) gb[cp.id] = gateMapAM.get(cp.id)!;
        if (gateMapCurrent.has(cp.id)) go[cp.id] = gateMapCurrent.get(cp.id)!;
        else if (gateMapAM.has(cp.id)) go[cp.id] = gateMapAM.get(cp.id)!;
      });
      setters.setGateBase(gb);
      setters.setGateOverrides(go);
      const hasGates = Object.keys(go).length > 0;

      // 6. Telemetría — safeFloat en todos los campos numéricos
      const gastoMedidoMap = new Map<string, number>();
      rawLatest?.forEach(r => {
        if (!gastoMedidoMap.has(r.escala_id)) {
          const v = safeFloat(r.gasto_calculado_m3s, NaN);
          if (Number.isFinite(v)) gastoMedidoMap.set(r.escala_id, v);
        }
      });
      const telMap: Record<string, CPTelemetry> = {};
      cps.forEach(cp => {
        const s = summary?.find(r => r.escala_id === cp.id);
        const amV = safeFloat(s?.lectura_am, NaN);
        const pmV = safeFloat(s?.lectura_pm, NaN);
        const dV = safeFloat(s?.delta_12h, 0);
        telMap[cp.id] = {
          delta_12h: Number.isFinite(dV) ? dV : 0,
          lectura_am: Number.isFinite(amV) ? amV : null,
          lectura_pm: Number.isFinite(pmV) ? pmV : null,
          hora_am: s?.hora_am ?? null,
          hora_pm: s?.hora_pm ?? null,
          gasto_medido: gastoMedidoMap.get(cp.id) ?? null,
          apertura_real: gateMapCurrent.get(cp.id) ?? gateMapAM.get(cp.id) ?? null,
        };
      });
      setCpTelemetry(telMap);

      // 7. ── PUNTOS DE ENTREGA — volúmenes del día más actuales ────────
      // Fuente: reportes_diarios (VIEW) filtrado por hoy + km de puntos_entrega
      // Estados activos: inicio / continua / reabierto / modificacion (sin hora_cierre = sigue abierto)
      const ACTIVE_STATES = new Set(['inicio', 'continua', 'reabierto', 'modificacion']);
      const kmMap = new Map<string, number>();
      const tipoMap = new Map<string, string>();
      rawPuntos?.forEach(p => {
        const km = safeFloat(p.km, NaN);
        if (Number.isFinite(km)) {
          kmMap.set(p.id, km);
          if (p.tipo) tipoMap.set(p.id, p.tipo);
        }
      });

      const deliveries: DeliveryData[] = (rawReportes ?? [])
        .map(r => {
          const km = kmMap.get(r.punto_id ?? '') ?? NaN;
          const caudal = safeFloat(r.caudal_promedio_m3s, 0);
          const volumen = safeFloat(r.volumen_total_mm3, 0);
          const isActive = ACTIVE_STATES.has(r.estado ?? '') && !r.hora_cierre && caudal > 0;
          return {
            punto_id: r.punto_id ?? '',
            nombre: r.punto_nombre ?? r.punto_id ?? 'Toma s/n',
            km,
            tipo: tipoMap.get(r.punto_id ?? '') ?? 'toma',
            caudal_m3s: caudal,
            volumen_mm3: volumen,
            hora_apertura: r.hora_apertura ?? null,
            estado: r.estado ?? 'desconocido',
            modulo_nombre: r.modulo_nombre ?? null,
            is_active: isActive,
          };
        })
        .filter(d => Number.isFinite(d.km))   // descartar tomas sin posición km
        .sort((a, b) => a.km - b.km);          // ordenar por km ascendente

      setDeliveryPoints(deliveries);
      const hasDeliveries = deliveries.length > 0;

      // 9. ── GEOMETRÍA POR TRAMO — perfil_hidraulico_canal ─────────────
      const tramos: TramoGeom[] = (rawPerfil ?? []).map(t => ({
        km_inicio: safeFloat(t.km_inicio, 0),
        km_fin: safeFloat(t.km_fin, 999),
        plantilla_m: safeFloat(t.plantilla_m, PLANTILLA),
        talud_z: safeFloat(t.talud_z, TALUD_Z),
        rugosidad_n: safeFloat(t.rugosidad_n, MANNING_N),
        pendiente_s0: safeFloat(t.pendiente_s0, S0_CANAL),
        tirante_diseno_m: safeFloat(t.tirante_diseno_m, 2.5),
        capacidad_diseno_m3s: safeFloat(t.capacidad_diseno_m3s, 62),
        bordo_libre_m: safeFloat(t.bordo_libre_m, FREEBOARD),
      }));
      setTramoGeom(tramos);
      const totalExtractionM3s = deliveries
        .filter(d => d.is_active)
        .reduce((s, d) => s + d.caudal_m3s, 0);

      // 8. ── GASTO PRESA — safeFloat + validación isFinite ─────────────
      const ts = formatTime(new Date());
      let qBaseVal = 62.4, qDamVal = 62.4;
      let damNivel = '—', damFuente = 'estimado';
      let damLive = false;

      if (lastMovPresa?.gasto_m3s != null) {
        // La simulación utiliza el ÚLTIMO movimiento de presa como "Base"
        const base = safeFloat(lastMovPresa.gasto_m3s, 0);
        if (base > 0) {
          qBaseVal = base;
          qDamVal = base; // Ambos inician iguales (Delta 0 hasta que el usuario mueva el slider)
          damFuente = 'movimientos_presas';
          damLive = true;
          damNivel = lastMovPresa.fecha_hora
            ? formatTime(lastMovPresa.fecha_hora)
            : '—';
          // T₀ = hora del ÚLTIMO movimiento de presa
          if (lastMovPresa.fecha_hora) {
            const movDate = new Date(lastMovPresa.fecha_hora);
            if (!isNaN(movDate.getTime())) {
              setters.setSimBaseMin(movDate.getHours() * 60 + movDate.getMinutes());
            }
          }
          // El tipo de evento se mantendrá en reposo hasta que el slider se mueva
        }
      } else if (firstMovPresa?.gasto_m3s != null) {
        // Fallback si por alguna razón falla lastMovPresa pero hay firstMovPresa
        const base = safeFloat(firstMovPresa.gasto_m3s, 0);
        if (base > 0) {
          qBaseVal = base;
          qDamVal = base;
          damFuente = 'movimientos_presas';
          damLive = true;
        }
      }
      if (!damLive && lecturaHoy?.extraccion_total_m3s != null) {
        const ext = safeFloat(lecturaHoy.extraccion_total_m3s, 0);
        if (ext > 0) {
          qBaseVal = ext;
          qDamVal = ext;
          damFuente = 'lecturas_presas';
          damLive = true;
          const nivelNum = safeFloat(lecturaHoy.escala_msnm, NaN);
          damNivel = Number.isFinite(nivelNum) ? nivelNum.toFixed(2) : '—';
        }
      }
      // Tier 3: perfil hidráulico RPC — Q ya calculado con cascada completa (aforo → compuerta → presa)
      if (!damLive && rpcQ && rpcQ > 0) {
        qBaseVal = rpcQ;
        qDamVal = rpcQ;
        damFuente = 'fn_perfil_canal_completo';
        damLive = true;
      }
      if (!damLive) {
        // Tier 4: lectura directa K-0 (respaldo si RPC no disponible).
        // NOTA: gasto de K-0 ya incluye pérdidas del tramo río (~36 km), por lo que
        // se aplica corrección inversa ÷0.95 para estimar el gasto real en cabeza de presa.
        const q0Escala = safeFloat(gastoMedidoMap.get(cps[0]?.id ?? ''), NaN);
        if (Number.isFinite(q0Escala) && q0Escala > 0) {
          const q0Corregido = q0Escala / 0.95;
          qBaseVal = q0Corregido;
          qDamVal = q0Corregido;
        }
        damFuente = 'estimado';

        // Tier 4: si la extracción total medida en tomas supera en >40% al estimado
        // de K-0, es más confiable usar la suma de tomas ÷ eficiencia de conducción.
        // Esto ocurre cuando gasto_calculado_m3s en K-0 está mal calibrado o es nulo.
        const totalExt = deliveries
          .filter(d => d.is_active)
          .reduce((s, d) => s + safeFloat(d.caudal_m3s, 0), 0);
        if (totalExt > qDamVal * 1.4) {
          const qFromTomas = totalExt / 0.88; // eficiencia conducción ~88%
          qBaseVal = qFromTomas;
          qDamVal = qFromTomas;
        }
      }

      setters.setQBase(qBaseVal);
      setters.setQDam(qDamVal);
      const q0Escala = safeFloat(gastoMedidoMap.get(cps[0]?.id ?? 'k0'), NaN);

      setDataLoaded(true);
      setDataStatus({
        dam: damLive, gates: hasGates, levels: hasLevels, deliveries: hasDeliveries,
        timestamp: ts,
        damBaseValue: qBaseVal,
        damCurrentValue: qDamVal,
        damNivel, damFuente,
        totalExtractionM3s,
        qRealK0: Number.isFinite(q0Escala) ? q0Escala : undefined,
        perfilFuente: rpcFuente ?? undefined,
        perfilQ: rpcQ ?? undefined,
      });
    };
    fetchData();

    // ── Refresh parcial cada 5 min: solo las 2 queries dinámicas ─────────
    // reportes_diarios y puntos_entrega cambian con cada captura de SICA.
    // El resto (presa, escalas, geometría) usa realtime o carga inicial.
    const fetchDeliveries = async () => {
      const today = getTodayString();
      const ACTIVE_STATES = new Set(['inicio', 'continua', 'reabierto', 'modificacion']);
      const [{ data: rawReportes }, { data: rawPuntos }] = await Promise.all([
        supabase.from('reportes_diarios')
          .select('punto_id, punto_nombre, caudal_promedio_m3s, volumen_total_mm3, hora_apertura, hora_cierre, estado, modulo_nombre')
          .eq('fecha', today),
        supabase.from('puntos_entrega')
          .select('id, nombre, km, tipo')
          .not('km', 'is', null)
          .order('km', { ascending: true })
          .limit(300),
      ]);

      const kmMap = new Map<string, number>();
      const tipoMap = new Map<string, string>();
      rawPuntos?.forEach(p => {
        const km = safeFloat(p.km, NaN);
        if (Number.isFinite(km)) {
          kmMap.set(p.id, km);
          if (p.tipo) tipoMap.set(p.id, p.tipo);
        }
      });

      const deliveries: DeliveryData[] = (rawReportes ?? [])
        .map(r => {
          const km = kmMap.get(r.punto_id ?? '') ?? NaN;
          const caudal = safeFloat(r.caudal_promedio_m3s, 0);
          const volumen = safeFloat(r.volumen_total_mm3, 0);
          const isActive = ACTIVE_STATES.has(r.estado ?? '') && !r.hora_cierre && caudal > 0;
          return {
            punto_id: r.punto_id ?? '', nombre: r.punto_nombre ?? r.punto_id ?? 'Toma s/n',
            km, tipo: tipoMap.get(r.punto_id ?? '') ?? 'toma',
            caudal_m3s: caudal, volumen_mm3: volumen,
            hora_apertura: r.hora_apertura ?? null, estado: r.estado ?? 'desconocido',
            modulo_nombre: r.modulo_nombre ?? null, is_active: isActive,
          };
        })
        .filter(d => Number.isFinite(d.km))
        .sort((a, b) => a.km - b.km);

      setDeliveryPoints(deliveries);
      const totalExtractionM3s = deliveries.filter(d => d.is_active).reduce((s, d) => s + d.caudal_m3s, 0);
      setDataStatus(prev => ({
        ...prev,
        deliveries: deliveries.length > 0,
        totalExtractionM3s,
        timestamp: formatTime(new Date()),
      }));
    };

    const deliveryInterval = setInterval(fetchDeliveries, 300_000);

    // Suscripción realtime: cuando llega un nuevo movimiento de presa, recalcular
    const unsubPresa = onTable('movimientos_presas', 'INSERT', () => {
      console.log('🏔️ Nuevo movimiento de presa detectado. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando hay nuevas capturas manuales de escalas/compuertas
    const unsubEscalas = onTable('lecturas_escalas', 'INSERT', () => {
      console.log('💧 Nueva captura de escala SICA detectada. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando hay nuevas capturas de tomas activas
    // NOTA: reportes_diarios es una VIEW (no tabla) — Supabase Realtime no puede
    // suscribirse directo a ella, así que este handler probablemente nunca dispara.
    // La vista se deriva de reportes_operacion; el refresh real de este bloque
    // depende del polling de 5 min (fetchDeliveries) hasta que se corrija.
    const unsubReportes = onTable('reportes_diarios', 'INSERT', () => {
      console.log('🚰 Nueva alta de tomas SICA detectada. Recargando modelo...');
      fetchData();
    });

    // Suscripción realtime: cuando se aplica calibración Manning, refrescar geometría
    const unsubPerfil = onTable('perfil_hidraulico_canal', 'UPDATE', () => {
      console.log('📐 Perfil hidráulico actualizado. Recargando geometría...');
      fetchData();
    });

    return () => {
      unsubPresa();
      unsubEscalas();
      unsubReportes();
      unsubPerfil();
      clearInterval(deliveryInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    controlPoints, baseReadings, cpTelemetry, deliveryPoints,
    dataStatus, dataLoaded, tramoGeom, perfilRpc, balanceTramos,
  };
}
