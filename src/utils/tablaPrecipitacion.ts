// ═══════════════════════════════════════════════════════════════════════════
// Tabla de precipitación por estación — SICA-005
// ---------------------------------------------------------------------------
// Extraída de exportClimaInfografia.ts (tablaPrecipitacion original) a un
// módulo compartido para reusarla en el Informe Geoclimático sin arrastrar
// la cadena de imports de la infografía (que sí depende de Supabase vía
// exportClimaReport.ts) — mismo motivo que assetToDataURI.ts/nombreMes.ts:
// mantener exportClimaGeoInforme.ts probable fuera de la UI.
//
// DOS MODOS, nunca mezclados en las mismas columnas:
//  - Sin periodo (corte instantáneo): 24 h / mes en curso / acum. temporada,
//    los contadores nativos de la consola WeatherLink — `lluvia_24h_mm` y
//    `lluvia_anio_mm` de LecturaClima solo existen en una lectura real, nunca
//    en un agregado sintético de rango (ver climaResumenMensual.ts).
//  - Con periodo: Acumulado del periodo / Promedio diario / Día de mayor
//    lluvia — bajo periodo, `lluvia_24h_mm`/`lluvia_anio_mm` SIEMPRE vienen
//    null (estacionesDesdeResumenRango no los llena, no tiene sentido
//    físico: "últimas 24h" o "ciclo anual de consola" no describen un rango
//    arbitrario elegido en el modal). Mostrar esas columnas ahí daba una
//    tabla en S/D para todas las estaciones (reportado por el usuario
//    2026-09-16) — el bug no era de datos faltantes, era pedirle a la tabla
//    una pregunta que no aplica en ese modo. El acumulado ya lo tiene el
//    resto del informe (mapa/tabla por módulo); "promedio diario" normaliza
//    para comparar periodos de distinta duración, y "día de mayor lluvia"
//    es la señal operativa real: 30mm en un solo día y 30mm repartidos en 30
//    días son el mismo acumulado pero muy distinta infiltración/escorrentía.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import type { DiaMaxLluvia } from './climaResumenMensual';

const nf = (v: number | null | undefined, d = 1) => (v == null ? 'S/D' : v.toFixed(d));

/** Sin periodo: contadores nativos de consola (24h/mes en curso/acum. ciclo
 *  anual), orden fijo (heredado de `ests`, no se reordena por magnitud). */
function tablaPrecipitacionInstante(ests: EstacionConLectura[]): string {
    const filas = ests.map(e => ({
        nombre: e.nombre,
        enLinea: e.enLinea,
        h24: e.lectura?.lluvia_24h_mm ?? null,
        mes: e.lectura?.lluvia_mes_mm ?? null,
        acum: e.lectura?.lluvia_anio_mm ?? null,
    }));

    if (!filas.length) {
        return `<div style="font-size:0.75rem;color:#94a3b8;padding:6px 0">Sin estaciones registradas.</div>`;
    }

    const suma = (k: 'h24' | 'mes' | 'acum') => {
        const vs = filas.map(f => f[k]).filter((v): v is number => v != null);
        return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    };
    const tot24 = suma('h24'), totMes = suma('mes'), totAcum = suma('acum');

    const filasHTML = filas.map(f => `<tr${f.enLinea ? '' : ' style="opacity:0.55"'}>
        <td><b>${f.nombre}</b>${f.enLinea ? '' : ' <small style="color:#94a3b8">(sin reportar)</small>'}</td>
        <td class="geoinf-pp-n">${nf(f.h24, 1)}</td>
        <td class="geoinf-pp-n">${nf(f.mes, 1)}</td>
        <td class="geoinf-pp-n">${nf(f.acum, 1)}</td>
      </tr>`).join('');

    return `<table class="geoinf-pp-tabla">
      <thead><tr>
        <th>Estación</th>
        <th class="geoinf-pp-n">24 h <small>mm</small></th>
        <th class="geoinf-pp-n">Mes <small>mm</small></th>
        <th class="geoinf-pp-n">Acum. temporada <small>mm</small></th>
      </tr></thead>
      <tbody>${filasHTML}</tbody>
      <tfoot><tr>
        <td>Total distrito</td>
        <td class="geoinf-pp-n">${nf(tot24, 1)}</td>
        <td class="geoinf-pp-n">${nf(totMes, 1)}</td>
        <td class="geoinf-pp-n">${nf(totAcum, 1)}</td>
      </tr></tfoot>
    </table>`;
}

/** Con periodo: acumulado del rango, promedio diario (acumulado ÷ días
 *  transcurridos del rango — normaliza para comparar rangos de distinta
 *  duración) y día de mayor lámina dentro del rango (fn_clima_resumen_mensual,
 *  migración 20260916140000_fn_clima_resumen_mensual_dia_max_lluvia). Sin
 *  entrada en `diaMaxLluviaPorId` (o `mm` null) = la estación no tuvo lluvia
 *  >0 en el rango, no "sin dato" — se muestra "0.0" en Acumulado ya lo deja
 *  claro, así que la celda de día de mayor lluvia se lee "—", no "S/D".
 *
 *  "Acumulado del periodo" lee `e.lectura?.lluvia_dia_mm`, que en modo "todo
 *  el histórico" (generarGeoInforme en Clima.tsx) ya viene SUSTITUIDO por el
 *  contador real "acum. temporada" de la consola física, no por el acumulado
 *  reconstruido desde la BD — la consola puede llevar registrando lluvia
 *  desde antes de que la red se diera de alta en SICA-005 (ver comentario en
 *  Clima.tsx: Módulo 3 real = 174.8 mm, reconstruido desde BD = 74.7 mm,
 *  porque la BD solo tiene lecturas desde julio). Esta función no distingue
 *  el origen — solo muestra lo que le llega, la sustitución ya ocurrió antes.
 */
function tablaPrecipitacionPeriodo(
    ests: EstacionConLectura[], diasTranscurridos: number, diaMaxLluviaPorId: Map<string, DiaMaxLluvia>,
    formateaFechaCorta: (iso: string) => string,
    /** true cuando el acumulado es el valor REAL de consola (modo "todo el
     *  histórico" — ver cabecera del archivo y OpcionesGeoInforme en
     *  exportClimaGeoInforme.ts). En ese caso, "promedio diario" y "día de
     *  mayor lluvia" se OCULTAN: se calculan sobre los días que la BD sí
     *  tiene capturados, un rango más corto que el que ahora cubre el
     *  acumulado real — dividir o buscar el pico solo en el tramo capturado,
     *  bajo un acumulado que incluye meses sin ninguna lectura en la BD,
     *  mezclaría dos rangos distintos en la misma fila. */
    soloAcumulado?: boolean,
): string {
    const filas = ests.map(e => {
        const acum = e.lectura?.lluvia_dia_mm ?? null; // ver climaResumenMensual.ts: bajo periodo, lluvia_dia_mm ES el acumulado del rango (o el real de consola, si soloAcumulado)
        const max = diaMaxLluviaPorId.get(e.id);
        return {
            nombre: e.nombre,
            enLinea: e.enLinea,
            acum,
            promedioDiario: !soloAcumulado && acum != null && diasTranscurridos > 0 ? acum / diasTranscurridos : null,
            diaMax: !soloAcumulado && max?.mm != null && max.fecha ? { fecha: max.fecha, mm: max.mm } : null,
        };
    });

    if (!filas.length) {
        return `<div style="font-size:0.75rem;color:#94a3b8;padding:6px 0">Sin estaciones registradas.</div>`;
    }

    const sumaAcum = filas.map(f => f.acum).filter((v): v is number => v != null);
    const totAcum = sumaAcum.length ? sumaAcum.reduce((a, b) => a + b, 0) : null;
    const totPromedioDiario = !soloAcumulado && totAcum != null && diasTranscurridos > 0 ? totAcum / diasTranscurridos : null;
    // "Día de mayor lluvia" del distrito: el máximo entre estaciones, no una suma (sumar máximos de días distintos no tiene sentido físico)
    const diasMaxConDato = filas.map(f => f.diaMax).filter((d): d is { fecha: string; mm: number } => d != null);
    const diaMaxDistrito = diasMaxConDato.length
        ? diasMaxConDato.reduce((a, b) => (b.mm > a.mm ? b : a))
        : null;

    const filasHTML = filas.map(f => `<tr${f.enLinea ? '' : ' style="opacity:0.55"'}>
        <td><b>${f.nombre}</b>${f.enLinea ? '' : ' <small style="color:#94a3b8">(sin reportar)</small>'}</td>
        <td class="geoinf-pp-n">${nf(f.acum, 1)}</td>
        ${soloAcumulado ? '' : `<td class="geoinf-pp-n">${nf(f.promedioDiario, 2)}</td>
        <td class="geoinf-pp-n">${f.diaMax ? `${f.diaMax.mm.toFixed(1)} <small>(${formateaFechaCorta(f.diaMax.fecha)})</small>` : '—'}</td>`}
      </tr>`).join('');

    return `<table class="geoinf-pp-tabla">
      <thead><tr>
        <th>Estación</th>
        <th class="geoinf-pp-n">Acumulado${soloAcumulado ? ' real' : ' del periodo'} <small>mm</small></th>
        ${soloAcumulado ? '' : `<th class="geoinf-pp-n">Promedio diario <small>mm</small></th>
        <th class="geoinf-pp-n">Día de mayor lluvia <small>mm</small></th>`}
      </tr></thead>
      <tbody>${filasHTML}</tbody>
      <tfoot><tr>
        <td>Total distrito</td>
        <td class="geoinf-pp-n">${nf(totAcum, 1)}</td>
        ${soloAcumulado ? '' : `<td class="geoinf-pp-n">${nf(totPromedioDiario, 2)}</td>
        <td class="geoinf-pp-n">${diaMaxDistrito ? `${diaMaxDistrito.mm.toFixed(1)} <small>(${formateaFechaCorta(diaMaxDistrito.fecha)})</small>` : '—'}</td>`}
      </tr></tfoot>
    </table>`;
}

/**
 * Tabla de precipitación por estación. Sin periodo: 24h/mes/acum. temporada
 * (contadores de consola, comportamiento histórico). Con periodo: acumulado
 * del rango/promedio diario/día de mayor lluvia (ver cabecera del archivo).
 * Orden fijo de despliegue (el mismo orden en que llega `ests`, heredado de
 * useClimaEstaciones) — NO se reordena por magnitud de lluvia, para que la
 * tabla no salte de posición estación por estación entre cortes.
 */
export function tablaPrecipitacion(
    ests: EstacionConLectura[],
    periodo?: {
        diasTranscurridos: number; diaMaxLluviaPorId: Map<string, DiaMaxLluvia>; formateaFechaCorta: (iso: string) => string;
        /** ver soloAcumulado en tablaPrecipitacionPeriodo */
        esRealDeConsola?: boolean;
    },
): string {
    return periodo
        ? tablaPrecipitacionPeriodo(ests, periodo.diasTranscurridos, periodo.diaMaxLluviaPorId, periodo.formateaFechaCorta, periodo.esRealDeConsola)
        : tablaPrecipitacionInstante(ests);
}

/** Nota al pie de la tabla — misma redacción que exportClimaInfografia.ts
 *  para el modo instante; el modo periodo usa su propia nota (ver llamador). */
export const NOTA_TABLA_PRECIPITACION = '24 h y mes según contador acumulado de cada consola WeatherLink; '
    + '"acum. temporada" es el contador anual de la consola, no un corte de año calendario. '
    + 'Estaciones sin reportar recientemente se muestran atenuadas.';

export const NOTA_TABLA_PRECIPITACION_PERIODO = 'Acumulado y promedio diario del rango elegido; "día de mayor lluvia" es la lámina '
    + 'más alta registrada en un solo día dentro del periodo — distingue un evento de lluvia fuerte de la misma agua repartida en '
    + 'varios días (relevante para infiltración/escorrentía). Sin entrada: la estación no registró lluvia en el periodo. '
    + 'Estaciones sin reportar recientemente se muestran atenuadas.';

/** "Todo el histórico": el acumulado es el contador REAL de cada consola
 *  física (su ciclo anual), no una suma reconstruida desde las lecturas que
 *  SICA-005 tiene capturadas — puede incluir meses anteriores al alta de la
 *  red. Por eso no se muestran promedio diario ni día de mayor lluvia (ver
 *  soloAcumulado en tablaPrecipitacionPeriodo): calcularlos solo sobre los
 *  días capturados, bajo un acumulado de un rango más largo, mezclaría dos
 *  periodos distintos en la misma fila. */
export const NOTA_TABLA_PRECIPITACION_CONSOLA = 'Acumulado real del ciclo vigente de cada consola física WeatherLink — puede incluir '
    + 'meses anteriores al alta de la estación en esta red, por eso puede superar lo reconstruible desde el historial capturado aquí. '
    + 'Promedio diario y día de mayor lluvia no se muestran en este modo (requieren el desglose día a día, que solo existe desde el alta '
    + 'de cada estación); para verlos, elige un rango de fechas explícito. Estaciones sin reportar recientemente se muestran atenuadas.';
