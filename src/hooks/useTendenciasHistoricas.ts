import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getTodayString, addDays } from '../utils/dateHelpers';
import { toast } from 'sonner';
import {
  serieNivelesDiaria, serieNivelesLectura, indiceNivelesUpDown, indiceNivelesUpDownPorLectura, serieVolumenTramos,
  serieCompuertas, serieGasto, serieGastoPorLectura, claveInstante,
  type SerieEscala, type SerieTramo, type SerieCompuerta, type SerieGasto, type SeriePunto,
  type LecturaEscala as TndLectura, type ResumenDiario as TndResumen,
  type TramoGeom, type EntregaModulo as TndEntrega, type PerfilGeom,
} from '../utils/tendencias';

export interface TendenciasData {
  niveles: SerieEscala[];
  volTramos: SerieTramo[];
  volTotal: SeriePunto[];
  compuertas: SerieCompuerta[];
  gasto: SerieGasto;
}

const EMPTY_TND_DATA: TendenciasData = {
  niveles: [], volTramos: [], volTotal: [], compuertas: [],
  gasto: { entrada: [], salida: [], entregas: [], perdidas: [] },
};

/**
 * Carga y agrega las series históricas de la pestaña Tendencias (niveles,
 * volumen por tramo, compuertas, gasto) — extraído de PublicMonitor.tsx.
 *
 * Solo consulta la base cuando `activo` es true (la pestaña Tendencias está
 * abierta): con `dockTab !== 'tendencias'` el efecto interno no dispara fetch.
 */
export function useTendenciasHistoricas(activo: boolean) {
  const hoyISO = getTodayString();
  const hace7 = addDays(hoyISO, -7);

  const [tndDesde, setTndDesde] = useState(hace7);
  const [tndHasta, setTndHasta] = useState(hoyISO);
  const [tndGran, setTndGran] = useState<'diaria' | 'lectura'>('diaria');
  const [tndLoading, setTndLoading] = useState(false);
  const [tndError, setTndError] = useState<string | null>(null);
  // Se incrementa por el poll de "Hoy" para forzar recarga sin cambiar rango/gran.
  const [tndRefreshTick, setTndRefreshTick] = useState(0);
  const [tndData, setTndData] = useState<TendenciasData>(EMPTY_TND_DATA);

  // Callback estable: TendenciasPanel está memoizado; una arrow inline aquí
  // invalidaría el memo en cada render del monitor (reloj de 60 s, mapa, etc.).
  const onTndRango = useCallback((d: string, h: string) => { setTndDesde(d); setTndHasta(h); }, []);
  const onTndReintentar = useCallback(() => setTndRefreshTick(x => x + 1), []);

  // prevFiltro: distingue si el disparo vino de un cambio real de rango/gran
  // (muestra "Cargando periodo…") o del poll silencioso de "Hoy" (tndRefreshTick,
  // no debe ocultar el gráfico ya pintado ni parpadear cada 90 s).
  const tndPrevFiltro = useRef<string>('');
  useEffect(() => {
    if (!activo) return;
    let cancel = false;
    const filtroKey = `${tndDesde}|${tndHasta}|${tndGran}`;
    const esRefreshSilencioso = tndRefreshTick > 0 && tndPrevFiltro.current === filtroKey;
    tndPrevFiltro.current = filtroKey;
    const cargar = async () => {
      if (!esRefreshSilencioso) setTndLoading(true);
      if (!cancel) setTndError(null);
      try {
        // Paginación con .range(): la API REST de Supabase corta a 1000 filas
        // POR PETICIÓN, ignorando .limit() mayores. Un rango amplio (mar–jul)
        // supera ese tope; sin paginar, .order desc dejaba fuera marzo/abril.
        const PAGE = 1000;
        const fetchAll = async <T,>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
          const acc: T[] = [];
          for (let from = 0; ; from += PAGE) {
            const { data } = await build(from, from + PAGE - 1);
            const rows = data || [];
            acc.push(...rows);
            if (rows.length < PAGE) break;   // última página
          }
          return acc;
        };

        const [escRes, tramoRes, perfilRes] = await Promise.all([
          supabase.from('escalas').select('id, nombre, km, nivel_max_operativo, pzas_radiales').order('km'),
          supabase.from('vol_interescalas').select('esc_up_id, esc_up, km_up, esc_down_id, esc_down, km_down, longitud_km, ancho_canal_m, vol_m3, nivel_up_m, nivel_down_m'),
          // Geometría trapezoidal por tramo (plantilla, talud) para el volumen real del Bloque 2
          supabase.from('perfil_hidraulico_canal').select('km_inicio, km_fin, plantilla_m, talud_z, tirante_diseno_m, bordo_libre_m').order('km_inicio'),
        ]);
        const escalasGeom = (escRes.data || []) as { id: string; nombre: string; km: number; nivel_max_operativo: number | null; pzas_radiales?: number | null }[];
        const tramos = (tramoRes.data || []) as TramoGeom[];
        const perfiles = (perfilRes.data || []) as PerfilGeom[];
        // Escalas de SÓLO REFERENCIA (sin compuerta de control, pzas_radiales=0):
        // K-64 y K-94+200. No reciben lecturas de campo, sólo el nivel de
        // continuidad autogenerado por Chronos — pero ese nivel SÍ es válido para
        // representar el tramo (K-104 entrega volumen con esa escala). Se conserva
        // su lectura autogenerada para el índice de volumen, no se descarta.
        const escalasReferencia = new Set(
          escalasGeom.filter(e => (e.pzas_radiales ?? 0) === 0).map(e => e.id)
        );

        // Lecturas de campo (nivel ↑↓, compuertas, gasto) — paginado, filtra autogeneradas
        const lecRaw = await fetchAll<TndLectura & { responsable?: string; notas?: string }>((from, to) =>
          supabase.from('lecturas_escalas')
            .select('escala_id, fecha, hora_lectura, nivel_m, nivel_abajo_m, gasto_calculado_m3s, gasto_metodo, radiales_json, creado_en, responsable, notas')
            .gte('fecha', tndDesde).lte('fecha', tndHasta)
            .order('creado_en', { ascending: true }).range(from, to));
        const esAutogenerada = (r: { responsable?: string; notas?: string }) =>
          /chronos|autogenerad|medianoche/i.test((r.responsable || '') + (r.notas || ''));
        // Lecturas de campo (compuertas, gasto, niveles): sin autogeneradas.
        const lecturas = lecRaw.filter(r => !esAutogenerada(r));
        // Para el VOLUMEN por tramo, además conserva las lecturas autogeneradas
        // de las escalas de sólo referencia (única fuente de su nivel), para que
        // los tramos que las tocan (…→K-94+200, K-94+200→K-104, …→K-64→…) no
        // queden vacíos pese a no tener lectura manual.
        const lecturasVol = lecRaw.filter(r =>
          !esAutogenerada(r) || escalasReferencia.has(r.escala_id));

        // Resumen diario (serie de nivel por escala, paginado) + entregas
        const [resRaw, { data: entRaw }] = await Promise.all([
          fetchAll<Record<string, unknown>>((from, to) =>
            supabase.from('resumen_escalas_diario').select('escala_id, fecha, lectura_am, hora_am, lectura_pm, hora_pm, nivel_actual')
              .gte('fecha', tndDesde).lte('fecha', tndHasta).order('fecha', { ascending: true }).range(from, to)),
          supabase.from('entregas_modulo').select('modulo_id, zona_id, tipo_entrega, gasto_m3s, fecha')
            .gte('fecha', tndDesde).lte('fecha', tndHasta).gt('gasto_m3s', 0),
        ]);
        const resumen: TndResumen[] = resRaw.map((r: Record<string, unknown>) => ({
          escala_id: r.escala_id as string, fecha: r.fecha as string,
          nivel_am: (r.lectura_am as number) ?? null, nivel_pm: (r.lectura_pm as number) ?? null,
          nivel_actual: (r.nivel_actual as number) ?? null,
        }));
        const entregas = (entRaw || []) as TndEntrega[];

        // Series
        const niveles = tndGran === 'diaria'
          ? serieNivelesDiaria(resumen, escalasGeom)
          : serieNivelesLectura(lecturas, escalasGeom);
        // Volumen por tramo con modelo de compuertas: usa nivel ABAJO de la
        // escala aguas arriba y nivel ARRIBA de la aguas abajo (ambas caras
        // vienen de lecturas_escalas, no del resumen diario de una sola cara).
        // En "Por lectura" se indexa por INSTANTE (fecha+hora), no por día:
        // con un solo día en rango ("Hoy"), la agregación diaria colapsaría
        // todas las lecturas del día a un único punto (Δ=0 aunque sí hubo
        // variación intradía real).
        const { idx, fechas } = tndGran === 'lectura'
          ? indiceNivelesUpDownPorLectura(lecturasVol)
          : indiceNivelesUpDown(lecturasVol);
        const { series: volTramos, totalPorFecha: volTotal } = serieVolumenTramos(tramos, idx, fechas, perfiles);
        const compuertas = serieCompuertas(lecturas, escalasGeom);
        // Gasto: "Diaria" agrega por día calendario (gastoDiarioPorKm). "Por
        // lectura" usa un punto por INSTANTE de K-0/K-104 — igual razón que
        // el volumen: con un solo día en rango, la agregación diaria colapsa
        // todas las lecturas del día a un único punto sin variación visible.
        const fechasDia = [...new Set(lecturas.map(l => l.fecha))].sort();
        const gasto = tndGran === 'lectura'
          ? serieGastoPorLectura(lecturas, escalasGeom, entregas,
              [...new Set(lecturas
                .filter(l => l.gasto_calculado_m3s != null)
                .map(l => claveInstante(l.fecha, l.hora_lectura)))].sort())
          : serieGasto(lecturas, escalasGeom, entregas, fechasDia.length ? fechasDia : [tndHasta]);

        if (!cancel) setTndData({ niveles, volTramos, volTotal, compuertas, gasto });
      } catch (e) {
        if (!cancel) {
          toast.error('No se pudo cargar el histórico de tendencias');
          setTndError('No se pudo cargar el histórico de tendencias. Verifique su conexión e intente de nuevo.');
        }
        console.error('[TENDENCIAS]', e);
      } finally {
        if (!cancel) setTndLoading(false);
      }
    };
    cargar();
    return () => { cancel = true; };
  }, [activo, tndDesde, tndHasta, tndGran, tndRefreshTick]);

  // TENDENCIAS — "Hoy": refresco periódico mientras el rango activo sea el
  // día en curso. El efecto anterior solo recarga cuando cambian rango/gran,
  // así que sin este poll una lectura capturada en campo mientras el
  // operador ya está viendo "Hoy" nunca aparecería hasta salir y reentrar.
  // Se limita a este caso (no a 7d/30d/90d) para no generar tráfico extra
  // en rangos históricos que no cambian minuto a minuto.
  const tndEsHoy = tndDesde === tndHasta && tndDesde === hoyISO;
  useEffect(() => {
    if (!activo || !tndEsHoy) return;
    const t = setInterval(() => setTndRefreshTick(x => x + 1), 90_000);
    return () => clearInterval(t);
  }, [activo, tndEsHoy]);

  return {
    tndDesde, tndHasta, tndGran, setTndGran,
    tndLoading, tndError, tndData,
    onTndRango, onTndReintentar,
  };
}
