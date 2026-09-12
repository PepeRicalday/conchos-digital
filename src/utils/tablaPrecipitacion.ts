// ═══════════════════════════════════════════════════════════════════════════
// Tabla de precipitación por estación (24h / mes / acum. temporada) —
// SICA-005
// ---------------------------------------------------------------------------
// Extraída de exportClimaInfografia.ts (tablaPrecipitacion original) a un
// módulo compartido para reusarla en el Informe Geoclimático sin arrastrar
// la cadena de imports de la infografía (que sí depende de Supabase vía
// exportClimaReport.ts) — mismo motivo que assetToDataURI.ts/nombreMes.ts:
// mantener exportClimaGeoInforme.ts probable fuera de la UI.
//
// `lluvia_anio_mm` es el contador que WeatherLink reinicia por ciclo anual de
// la consola (no necesariamente enero) — se rotula "Acum. temporada", nunca
// "Acum. anual", para no prometer un corte calendario que la fuente no
// garantiza. Cada celda usa nf(): sin lectura de esa estación es "S/D",
// nunca "0.0" — una estación caída no es lo mismo que una estación seca.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';

const nf = (v: number | null | undefined, d = 1) => (v == null ? 'S/D' : v.toFixed(d));

/**
 * Tabla de precipitación por estación: 24 h, mes en curso y acumulado de
 * temporada, con fila de Total distrito. Orden fijo de despliegue (el mismo
 * orden en que llega `ests`, heredado de useClimaEstaciones) — NO se
 * reordena por magnitud de lluvia, para que la tabla no salte de posición
 * estación por estación entre cortes.
 */
export function tablaPrecipitacion(ests: EstacionConLectura[]): string {
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

/** Nota al pie de la tabla — misma redacción que exportClimaInfografia.ts,
 *  para que el mismo dato se explique igual en ambos documentos. */
export const NOTA_TABLA_PRECIPITACION = '24 h y mes según contador acumulado de cada consola WeatherLink; '
    + '"acum. temporada" es el contador anual de la consola, no un corte de año calendario. '
    + 'Estaciones sin reportar recientemente se muestran atenuadas.';
