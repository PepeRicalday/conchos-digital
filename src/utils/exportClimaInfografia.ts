// ═══════════════════════════════════════════════════════════════════════════
// INFOGRAFÍA DE CLIMA ACTUAL — SICA-005 · Centro de Inteligencia Agroclimática
// ---------------------------------------------------------------------------
// Pieza de lectura RÁPIDA: indicadores KPI y plano activo del distrito, sobre
// lienzo azul institucional. Es deliberadamente distinta al informe técnico
// (exportClimaReport.ts): aquí no hay metodología, tablas horarias ni series
// largas; el objetivo es que un jefe de zona entienda el estado en 10 segundos.
//
// Reglas heredadas del módulo y respetadas aquí:
//   · Cielo y lluvia son variables SEPARADAS. Sin fuente de nubosidad se rotula
//     "no determinado" — nunca un icono solar de relleno.
//   · Un índice sin datos vale null y se muestra "S/D", nunca 0.
//   · Todo color va acompañado de etiqueta textual (legible en CVD e impresión).
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura, LecturaClima } from '../hooks/useClimaEstaciones';
import { clasificaCielo, PROCEDENCIA_LABEL } from './cielo';
import { calculaIndices, entradasDesdeEstaciones } from './indicesAgro';
import { mapaSVG, predice24h, assetToDataURI, extensionMapa } from './exportClimaReport';
import { construyeFondoSatelital, type FondoSatelital } from './mapaSatelital';

/** Paleta institucional de la infografía (azul marino SICA + verdes de estado). */
const T = {
    marino: '#0d2847',
    marinoAlt: '#123a63',
    lienzo: '#eef2f6',
    panel: '#ffffff',
    borde: '#d5dee7',
    tinta: '#0f2138',
    tintaSec: '#5b7186',
    verde: '#22a447',
    verdeClaro: '#7ed957',
    ambar: '#e0a015',
    rojo: '#d64545',
    azul: '#2a78d6',
};

const nf = (v: number | null | undefined, d = 1) => (v == null ? 'S/D' : v.toFixed(d));

/** Cultivos de referencia del distrito con su Kc en la etapa vigente. */
const CULTIVOS: { nombre: string; kc: number }[] = [
    { nombre: 'Nogal (brotación)', kc: 0.85 },
    { nombre: 'Alfalfa', kc: 0.95 },
    { nombre: 'Maíz', kc: 0.70 },
    { nombre: 'Chile', kc: 0.80 },
];

/**
 * Variación respecto a la media de los días previos, para que el KPI diga si la
 * condición MEJORA o EMPEORA y no solo cuánto vale hoy. Devuelve '' cuando no
 * hay historial suficiente: una flecha inventada es peor que ninguna.
 *
 * `sentido` indica qué significa subir: en ETₒ subir es más demanda (tensa la
 * operación) y en HR subir es más humedad ambiental (la alivia). Sin esto, la
 * flecha sería ambigua — verde arriba no significa lo mismo en cada indicador.
 */
function delta(
    actual: number | null, previos: (number | null)[],
    unidad: string, sentido: 'subir_tensa' | 'subir_alivia' = 'subir_tensa',
    dec = 1,
): string {
    const vs = previos.filter((v): v is number => v != null);
    if (actual == null || vs.length < 2) return '';
    const media = vs.reduce((a, b) => a + b, 0) / vs.length;
    const d = actual - media;
    // Umbral de ruido: variaciones < 3 % de la media no se señalan como tendencia.
    if (Math.abs(d) < Math.abs(media) * 0.03) {
        return `<span class="dlt dlt-igual">＝ estable vs. 7 d</span>`;
    }
    const sube = d > 0;
    const tensa = sentido === 'subir_tensa' ? sube : !sube;
    return `<span class="dlt ${tensa ? 'dlt-mal' : 'dlt-bien'}">`
        + `${sube ? '▲' : '▼'} ${Math.abs(d).toFixed(dec)}${unidad} vs. 7 d</span>`;
}

// ── Tarjeta KPI de la banda superior ────────────────────────────────────────
function kpi(icono: string, titulo: string, valor: string, unidad: string,
             pie: string, colorPie: string, tendencia = ''): string {
    return `<div class="kpi">
      <div class="kpi-h">${icono}<span>${titulo}</span></div>
      <div class="kpi-v">${valor}<i>${unidad}</i></div>
      <div class="kpi-p" style="color:${colorPie}">${pie}</div>
      ${tendencia ? `<div class="kpi-d">${tendencia}</div>` : ''}
    </div>`;
}

// ── Anillo de índice agroclimático (0-100) ──────────────────────────────────
function anillo(valor: number | null, clave: string, nombre: string,
                etiqueta: string, color: string, implicacion = ''): string {
    const r = 40, c = 2 * Math.PI * r;
    const arco = valor != null
        ? `<circle cx="52" cy="52" r="${r}" fill="none" stroke="${color}" stroke-width="11"
                   stroke-linecap="round" stroke-dasharray="${(c * valor / 100).toFixed(1)} ${c.toFixed(1)}"
                   transform="rotate(-90 52 52)"/>` : '';
    const centro = valor != null
        ? `<text x="52" y="55" text-anchor="middle" font-size="27" font-weight="700" fill="${T.tinta}" font-family="system-ui">${valor}</text>
           <text x="52" y="70" text-anchor="middle" font-size="10" fill="${T.tintaSec}" font-family="system-ui">/100</text>`
        : `<text x="52" y="58" text-anchor="middle" font-size="17" font-weight="700" fill="${T.tintaSec}" font-family="system-ui">S/D</text>`;
    return `<div class="idx">
      <div class="idx-k">${clave}</div>
      <div class="idx-n">${nombre}</div>
      <svg viewBox="0 0 104 104" width="104" height="104" role="img" aria-label="${clave}: ${valor ?? 'sin dato'} de 100">
        <circle cx="52" cy="52" r="${r}" fill="none" stroke="#dde5ec" stroke-width="11"/>
        ${arco}${centro}
      </svg>
      <div class="idx-e" style="color:${color}">${etiqueta}</div>
      ${implicacion ? `<div class="idx-imp">${implicacion}</div>` : ''}
    </div>`;
}

/** Punto de semáforo con etiqueta (color SIEMPRE acompañado de texto). */
function foco(texto: string, color: string): string {
    return `<div class="foco"><span class="dot" style="background:${color}"></span>${texto}</div>`;
}

// ── Mini-serie de tendencia (sparkline con ejes) para el panel de 7 días ────
function sparkline(
    titulo: string, pts: { dia: string; v: number | null }[], color: string, dec = 1,
): string {
    const val = pts.filter(p => p.v != null) as { dia: string; v: number }[];
    if (val.length < 2) {
        return `<div class="spark"><div class="spark-t">${titulo}</div>
                <div class="spark-sd">Sin datos suficientes</div></div>`;
    }
    const W = 240, H = 96, ML = 30, MR = 8, MT = 10, MB = 20;
    const iw = W - ML - MR, ih = H - MT - MB;
    const vs = val.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }            // serie plana: evita división por cero
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    const x = (i: number) => ML + (i / (val.length - 1)) * iw;
    const y = (v: number) => MT + ih - ((v - lo) / (hi - lo)) * ih;

    const grid = [lo, (lo + hi) / 2, hi].map(v =>
        `<line x1="${ML}" y1="${y(v).toFixed(1)}" x2="${W - MR}" y2="${y(v).toFixed(1)}" stroke="#e6ecf2" stroke-width="1"/>
         <text x="${ML - 4}" y="${(y(v) + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="${T.tintaSec}" font-family="system-ui">${v.toFixed(dec === 0 ? 0 : 1)}</text>`).join('');
    const linea = val.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const puntos = val.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" fill="${color}"/>`).join('');
    const ejeX = val.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="8" text-anchor="middle" fill="${T.tintaSec}" font-family="system-ui">${p.dia}</text>`).join('');

    return `<div class="spark">
      <div class="spark-t">${titulo}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${titulo}">
        ${grid}
        <path d="${linea}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${puntos}${ejeX}
      </svg>
    </div>`;
}

/** Fila del panel hidrológico: concepto, estado y foco de color. */
function filaHidro(icono: string, titulo: string, estado: string, color: string): string {
    return `<div class="hidro-f">
      <div class="hidro-i">${icono}</div>
      <div class="hidro-t"><b>${titulo}</b><span>${estado}</span></div>
      <span class="dot" style="background:${color}"></span>
    </div>`;
}

/**
 * Serie diaria de los últimos 7 días para las tendencias.
 * `historial` es opcional: si la vista no lo suministra, el panel se rotula
 * "sin datos suficientes" en vez de dibujar una línea inventada.
 */
export interface DiaHistorico {
    fecha: string;            // YYYY-MM-DD
    eto: number | null;
    temp: number | null;
    hr: number | null;
    viento: number | null;
}

/** Agrupa lecturas crudas en promedios diarios (últimos 7 días). */
export function agrupaPorDia(lecturas: LecturaClima[]): DiaHistorico[] {
    const porDia = new Map<string, LecturaClima[]>();
    for (const l of lecturas) {
        const d = (l.fecha ?? l.ts ?? '').slice(0, 10);
        if (!d) continue;
        const arr = porDia.get(d);
        if (arr) arr.push(l); else porDia.set(d, [l]);
    }
    const media = (ls: LecturaClima[], k: keyof LecturaClima) => {
        const vs = ls.map(l => l[k]).filter((v): v is number => typeof v === 'number');
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    return [...porDia.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-7)
        .map(([fecha, ls]) => ({
            fecha,
            // ETₒ es un ACUMULADO diario: el valor representativo del día es el
            // máximo alcanzado, no el promedio de los cortes parciales.
            eto: (() => {
                const vs = ls.map(l => l.eto_mm ?? l.et_dia_mm).filter((v): v is number => v != null);
                return vs.length ? Math.max(...vs) : null;
            })(),
            temp: media(ls, 'temp_c'),
            hr: media(ls, 'hum_rel_pct'),
            viento: media(ls, 'viento_ms'),
        }));
}

async function buildHTML(
    ests: EstacionConLectura[], historial: DiaHistorico[], fondo: FondoSatelital | null,
): Promise<string> {
    const [logoSRL, logoSICA] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
    ]);

    const ahora = new Date();
    const fechaLarga = ahora.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    const hora = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

    // ── Agregados del distrito ──────────────────────────────────────────────
    const conLectura = ests.filter(e => e.lectura);
    const enLinea = ests.filter(e => e.enLinea);
    const temps = conLectura.map(e => e.lectura!.temp_c).filter((v): v is number => v != null);
    const hums = conLectura.map(e => e.lectura!.hum_rel_pct).filter((v): v is number => v != null);
    const vientos = conLectura.map(e => e.lectura!.viento_ms).filter((v): v is number => v != null);
    const etos = enLinea.map(e => e.lectura?.eto_mm).filter((v): v is number => v != null);
    const gdds = ests.map(e => e.lectura?.gdd).filter((v): v is number => v != null);

    const tProm = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const tMax = temps.length ? Math.max(...temps) : null;
    const hrProm = hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null;
    const vMax = vientos.length ? Math.max(...vientos) : null;
    const etoMed = etos.length ? etos.reduce((a, b) => a + b, 0) / etos.length : null;
    const gddProm = gdds.length ? gdds.reduce((a, b) => a + b, 0) / gdds.length : null;
    const lluviaObs = ests.reduce((a, e) => a + (e.lectura?.lluvia_dia_mm ?? 0), 0);

    // ETₒ TOTAL prevista para hoy: es la magnitud que dimensiona la lámina de
    // riego. El acumulado del corte (etoMed) subestima en proporción a las horas
    // de sol que faltan, por lo que solo se usa como respaldo.
    const etoDiario = (() => {
        const hoyLocal = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
        const sumas = ests.map(e => e.pronosticoSerie
            .filter(p => p.fecha_local === hoyLocal && p.eto_fc_mm != null)
            .reduce((a, p) => a + (p.eto_fc_mm ?? 0), 0)).filter(v => v > 0);
        return sumas.length ? sumas.reduce((a, b) => a + b, 0) / sumas.length : null;
    })();
    const ETO = etoDiario ?? etoMed;

    // Cielo del distrito: promedio SOLO de estaciones con fuente de nubosidad.
    const cobs = ests.map(e => e.cielo.coberturaPct).filter((v): v is number => v != null);
    const cobMedia = cobs.length ? cobs.reduce((a, b) => a + b, 0) / cobs.length : null;
    const cieloDist = cobMedia != null ? clasificaCielo(cobMedia) : null;
    const procedencias = [...new Set(ests.filter(e => e.cielo.coberturaPct != null)
        .map(e => PROCEDENCIA_LABEL[e.cielo.procedencia]))].join(' · ');

    const preds = ests.filter(e => e.enLinea && e.lectura).map(predice24h);
    const indices = calculaIndices(entradasDesdeEstaciones(ests, etoDiario));
    const idr = indices.find(i => i.clave === 'IDR');

    // ── Clasificaciones para los pies de KPI ────────────────────────────────
    const clasETo = ETO == null ? { txt: 'Sin dato', col: T.tintaSec }
        : ETO < 2 ? { txt: 'Muy Baja', col: T.verde }
        : ETO < 4 ? { txt: 'Baja', col: T.verde }
        : ETO < 6 ? { txt: 'Moderada', col: T.ambar }
        : ETO < 8 ? { txt: 'Alta', col: T.ambar } : { txt: 'Muy Alta', col: T.rojo };
    const clasHR = hrProm == null ? { txt: 'Sin dato', col: T.tintaSec }
        : hrProm >= 70 ? { txt: 'Alta humedad', col: T.verde }
        : hrProm >= 40 ? { txt: 'Normal', col: T.verde } : { txt: 'Ambiente seco', col: T.ambar };
    const clasTemp = tProm == null ? { txt: 'Sin dato', col: T.tintaSec }
        : tProm > 32 ? { txt: 'Caluroso', col: T.rojo }
        : tProm > 26 ? { txt: 'Cálido', col: T.ambar } : { txt: 'Normal', col: T.verde };
    const clasViento = vMax == null ? { txt: 'Sin dato', col: T.tintaSec }
        : vMax > 6 ? { txt: 'Restrictivo', col: T.rojo }
        : vMax > 5 ? { txt: 'Precaución', col: T.ambar } : { txt: 'Operable', col: T.verde };
    const clasGDD = gddProm == null ? { txt: 'Sin dato', col: T.tintaSec } : { txt: 'Normal', col: T.verde };

    // ── Semáforo operativo y estado general ─────────────────────────────────
    const demanda = ETO == null ? { txt: 'Demanda sin determinar', col: '#94a3b8' }
        : ETO >= 7 ? { txt: 'Demanda Muy Alta', col: T.rojo }
        : ETO >= 5 ? { txt: 'Demanda Alta', col: T.ambar }
        : ETO >= 3 ? { txt: 'Demanda Moderada', col: T.verdeClaro }
        : { txt: 'Demanda Baja', col: T.verdeClaro };
    const riesgo = (vMax != null && vMax > 6) || (tMax != null && tMax > 38)
        ? { txt: 'Riesgo Climático Alto', col: T.rojo }
        : (vMax != null && vMax > 5) || (tMax != null && tMax > 34)
        ? { txt: 'Riesgo Climático Moderado', col: T.ambar }
        : { txt: 'Riesgo Climático Bajo', col: T.verdeClaro };
    const canales = enLinea.length === ests.length
        ? { txt: 'Operación de Canales Normal', col: T.verdeClaro }
        : { txt: 'Cobertura de red incompleta', col: T.ambar };
    const estadoGral = (demanda.col === T.rojo || riesgo.col === T.rojo)
        ? { txt: 'OPERACIÓN CON VIGILANCIA', col: T.ambar }
        : { txt: 'OPERACIÓN NORMAL', col: T.verdeClaro };

    // ── Lámina bruta por cultivo (eficiencia 70 % en riego rodado) ──────────
    const laminas = CULTIVOS.map(c => ({
        nombre: c.nombre,
        // mm/día → m³/ha·día (1 mm sobre 1 ha = 10 m³)
        m3: ETO != null ? ((ETO * c.kc) / 0.7) * 10 : null,
    }));

    // ── Análisis ejecutivo: cuatro lecturas derivadas de los datos ──────────
    const ejec = [
        {
            ico: '💧', tit: 'DEMANDA ATMOSFÉRICA', val: clasETo.txt, col: clasETo.col,
            txt: `ETₒ media: ${nf(ETO, 2)} mm.<br><br>` + (ETO != null && ETO < 4
                ? 'No se esperan incrementos importantes en consumo.'
                : 'Ajustar turnos a la demanda del cultivo.'),
        },
        {
            ico: '☁️', tit: 'BALANCE HÍDRICO',
            val: lluviaObs > 0 ? `${lluviaObs.toFixed(1)} mm` : 'Sin lluvia',
            col: lluviaObs > 0 ? T.azul : T.azul,
            txt: lluviaObs > 0
                ? 'La precipitación aporta al balance y reduce la lámina a reponer.'
                : 'Toda la demanda dependerá del suministro del canal.',
        },
        {
            ico: '🌡️', tit: 'CONDICIÓN AMBIENTAL',
            val: (tMax != null && tMax > 38) ? 'Estrés' : 'Estable',
            col: (tMax != null && tMax > 38) ? T.rojo : T.verde,
            txt: `${clasTemp.txt === 'Normal' ? 'Temperaturas normales' : `Ambiente ${clasTemp.txt.toLowerCase()}`}, `
                + `${clasHR.txt.toLowerCase()}.<br>${(tMax != null && tMax > 38) ? 'Vigilar estrés hídrico.' : 'Sin estrés atmosférico.'}`,
        },
        {
            ico: '🛡️', tit: 'RIESGO OPERATIVO', val: riesgo.txt.replace('Riesgo Climático ', ''), col: riesgo.col,
            txt: riesgo.col === T.verdeClaro
                ? 'No existen condiciones para modificar las entregas programadas.'
                : 'Revisar turnos de aspersión y horarios de riego.',
        },
    ];

    // ── Recomendaciones operativas ──────────────────────────────────────────
    const recos: string[] = [];
    if (ETO != null && ETO < 4) {
        recos.push('Mantener programa de riego actual.');
        recos.push('No incrementar entregas.');
    } else if (ETO != null) {
        recos.push(`Reponer ≈ ${((ETO * 0.85) / 0.7).toFixed(1)} mm/día; priorizar turnos nocturnos.`);
    }
    if (vMax != null && vMax > 5) recos.push('Posponer riego por aspersión hasta que el viento baje de 5 m/s.');
    recos.push('Revisar humedad del suelo antes del siguiente turno.');
    recos.push('Continuar monitoreo de estaciones.');

    // ── Alertas ─────────────────────────────────────────────────────────────
    const alertas: string[] = [];
    if (tMax != null && tMax > 38) alertas.push('Estrés térmico severo.');
    if (vMax != null && vMax > 6) alertas.push('Viento restrictivo para aspersión.');
    if (lluviaObs > 10) alertas.push('Precipitación significativa: evaluar cierre de tomas.');
    if (enLinea.length < ests.length) alertas.push(`${ests.length - enLinea.length} estación(es) sin reportar.`);
    if (cobs.length === 0) alertas.push('Sin fuente de nubosidad: cielo no determinado.');

    // ── Bloques HTML ────────────────────────────────────────────────────────
    // Serie previa (excluye hoy) para comparar el corte contra su propia semana.
    const prev = historial.slice(0, -1);
    const kpis = [
        kpi('📡', 'ESTACIONES', `${enLinea.length}/${ests.length}`, '', 'Operativas',
            enLinea.length === ests.length ? T.verde : T.ambar),
        kpi('💧', 'ETₒ DISTRITAL', nf(ETO, 2), 'mm/día', clasETo.txt, clasETo.col,
            delta(ETO, prev.map(d => d.eto), ' mm', 'subir_tensa', 2)),
        kpi('🌱', 'GDD MEDIO', nf(gddProm, 0), '°C·día', clasGDD.txt, clasGDD.col),
        kpi('🌧️', 'LLUVIA TOTAL', nf(lluviaObs, 1), 'mm', lluviaObs > 0 ? 'Con registro' : 'Sin lluvia', T.azul),
        kpi('💦', 'HR PROMEDIO', hrProm == null ? 'S/D' : `${hrProm.toFixed(0)}%`, '', clasHR.txt, clasHR.col,
            delta(hrProm, prev.map(d => d.hr), ' pp', 'subir_alivia', 0)),
        kpi('🌡️', 'TEMP. PROMEDIO', nf(tProm, 1), '°C', clasTemp.txt, clasTemp.col,
            delta(tProm, prev.map(d => d.temp), ' °C', 'subir_tensa', 1)),
        kpi('💨', 'VIENTO MÁXIMO', nf(vMax, 1), 'm/s', clasViento.txt, clasViento.col,
            delta(vMax, prev.map(d => d.viento), ' m/s', 'subir_tensa', 1)),
    ].join('');

    // La `implicacion` traduce el número a una consecuencia operativa ("Priorizar
    // turnos nocturnos"). Es lo que un gerente necesita del índice: sin ella,
    // obliga a conocer de memoria la escala de cada indicador.
    const anillos = indices.map(i => anillo(
        i.valor,
        i.clave === 'ICA' ? 'ICA-005' : i.clave,
        i.nombre, i.etiqueta, i.color, i.implicacion,
    )).join('');

    const ejecHTML = ejec.map(b => `<div class="ej">
        <div class="ej-i">${b.ico}</div>
        <div class="ej-t">${b.tit}</div>
        <div class="ej-v" style="color:${b.col}">${b.val}</div>
        <div class="ej-x">${b.txt}</div>
      </div>`).join('');

    const predHTML = preds.map(p => `<div class="pr">
        <div class="pr-n">${p.estacion}</div>
        <div class="pr-i">${p.icono || '<span class="pr-nd">?</span>'}</div>
        <div class="pr-t">${p.tMinEsp != null ? p.tMinEsp + '°' : '—'} / <b>${p.tMaxEsp != null ? p.tMaxEsp + '°' : '—'}</b></div>
        <div class="pr-l">💧 ${p.pLluvia != null ? p.pLluvia + '%' : 'S/D'}</div>
        <div class="pr-e">ETₒ esp.<br><b>${p.etoEsp != null ? p.etoEsp.toFixed(1) + ' mm' : 'S/D'}</b></div>
        <div class="pr-s">${p.cielo.coberturaPct != null ? p.etiqueta : 'Cielo no determinado'}</div>
      </div>`).join('');

    // Barra proporcional: deja ver de un vistazo qué cultivo tira más del agua,
    // que es la comparación que se hace al repartir el turno.
    const m3Max = Math.max(...laminas.map(l => l.m3 ?? 0), 1);
    const laminasHTML = laminas.map(l => `<tr>
        <td>${l.nombre}</td>
        <td class="lam-b"><span style="width:${((l.m3 ?? 0) / m3Max * 100).toFixed(0)}%"></span></td>
        <td><b>${l.m3 != null ? l.m3.toFixed(1) : 'S/D'}</b> m³</td>
      </tr>`).join('');

    // Barra de nivel de demanda: usa el IDR (0-100), no un porcentaje inventado.
    const nivelPct = idr?.valor ?? null;
    const N = 14, llenos = nivelPct != null ? Math.round((nivelPct / 100) * N) : 0;
    const barra = Array.from({ length: N }, (_, i) =>
        `<span class="seg" style="background:${i < llenos ? (idr?.color ?? T.verde) : '#dde5ec'}"></span>`).join('');

    const dias = historial.map(d => ({
        dia: d.fecha.slice(8, 10),
        eto: d.eto, temp: d.temp, hr: d.hr, viento: d.viento,
    }));
    const sparks = [
        sparkline('ETₒ (mm/día)', dias.map(d => ({ dia: d.dia, v: d.eto })), T.verde),
        sparkline('TEMPERATURA (°C)', dias.map(d => ({ dia: d.dia, v: d.temp })), '#e8642c', 0),
        sparkline('HUMEDAD RELATIVA (%)', dias.map(d => ({ dia: d.dia, v: d.hr })), T.azul, 0),
        sparkline('VIENTO (m/s)', dias.map(d => ({ dia: d.dia, v: d.viento })), '#8b5cf6'),
    ].join('');

    // ── Confianza del corte ─────────────────────────────────────────────────
    // Un tablero gerencial debe declarar CUÁNTO se puede confiar en lo que
    // muestra. Se combinan tres cosas medibles: frescura del dato (QA/QC),
    // cobertura de la red y disponibilidad del modelo de pronóstico.
    const estFrescas = ests.filter(e => e.calidad.usableComoActual).length;
    const conPronostico = ests.filter(e => e.pronosticoSerie.length > 0).length;
    const edades = ests.map(e => e.calidad.edadMin).filter((v): v is number => v != null);
    const edadMax = edades.length ? Math.max(...edades) : null;
    const confianzaPct = ests.length
        ? Math.round(100 * (0.5 * (estFrescas / ests.length)
                          + 0.3 * (enLinea.length / ests.length)
                          + 0.2 * (conPronostico / ests.length)))
        : 0;
    const confianza = confianzaPct >= 85 ? { txt: 'ALTA', col: T.verde }
        : confianzaPct >= 60 ? { txt: 'MEDIA', col: T.ambar }
        : { txt: 'BAJA', col: T.rojo };
    const confDetalle = [
        `${estFrescas}/${ests.length} estaciones con dato vigente`,
        `${conPronostico}/${ests.length} con pronóstico sincronizado`,
        edadMax != null ? `antigüedad máx. ${edadMax.toFixed(0)} min` : 'antigüedad no determinada',
    ].join(' · ');

    // ── Estado hidrológico ──────────────────────────────────────────────────
    // Derivado SOLO de lo que la red de clima observa. El estado de presas y
    // escurrimientos no lo mide una estación meteorológica: se declara "sin
    // dato de la red" en lugar de afirmar "operación normal" sin evidencia.
    const lluviaPrevMax = Math.max(0, ...preds.map(p => p.lluviaMm ?? 0));
    const hidro = [
        filaHidro('🌊', 'Canal Principal Conchos', 'Sin dato de la red de clima', '#b9c6d3'),
        filaHidro('🏞️', 'Presas', 'Sin dato de la red de clima', '#b9c6d3'),
        filaHidro('🌧️', 'Lluvias',
            lluviaObs > 0 ? `${lluviaObs.toFixed(1)} mm observados hoy` : 'Sin registro en 24 h',
            lluviaObs > 0 ? T.azul : '#b9c6d3'),
        filaHidro('⚠️', 'Riesgo de avenidas',
            lluviaObs > 20 || lluviaPrevMax > 20 ? 'Vigilar: lámina significativa'
                : lluviaObs > 0 || lluviaPrevMax > 5 ? 'Bajo' : 'Nulo',
            lluviaObs > 20 || lluviaPrevMax > 20 ? T.ambar : T.verde),
    ].join('');

    const plano = mapaSVG(ests, preds, fondo);

    const cieloBanda = cieloDist
        ? `<b>${cieloDist.icono} ${cieloDist.etiqueta} · ${cobMedia!.toFixed(0)} % de cobertura</b>
           <span>Promedio de ${cobs.length} estación(es) con fuente de nubosidad — ${procedencias}</span>`
        : `<b style="color:${T.tintaSec}">Condición del cielo no determinada</b>
           <span>Ninguna estación aporta fuente de nubosidad en este corte. La ausencia de lluvia no describe el estado del cielo.</span>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SICA-005 · Estado Operativo del Distrito · ${fechaLarga}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:${T.marino};color:${T.tinta};
       font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:16px}
  .wrap{max-width:1060px;margin:0 auto}
  .card{background:${T.panel};border-radius:10px;padding:14px 16px}
  h2{font-size:0.72rem;letter-spacing:0.06em;color:#fff;background:${T.marinoAlt};
     display:inline-block;padding:6px 14px;border-radius:8px 8px 0 0;margin:0;font-weight:700}
  .sec{background:${T.panel};border-radius:0 10px 10px 10px;padding:14px 16px;margin-bottom:14px}

  /* ── Cabecera ───────────────────────────────────────────── */
  header{display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap}
  /* Los logos institucionales NO se recortan en redondo: el de la SRL es
     apaisado (399x348) y lleva "DELICIAS" en el borde inferior, que un recorte
     circular decapitaba. Se respeta su proporción con width:auto y solo se
     redondea levemente la placa blanca que los aloja. */
  header img{height:62px;width:auto;background:#fff;border-radius:6px;padding:5px 7px;
             box-shadow:0 1px 4px rgba(0,0,0,0.25)}
  .h-tit{flex:1;min-width:260px;color:#fff}
  .h-tit h1{margin:0;font-size:1.55rem;font-weight:800;letter-spacing:-0.01em}
  .h-tit h1 span{font-weight:400;opacity:0.92}
  .h-sub{color:${T.verdeClaro};font-size:1.02rem;font-weight:700;margin-top:2px}
  .h-sub2{color:#c3d3e2;font-size:0.84rem;margin-top:2px}
  .h-fecha{color:#fff;text-align:right;font-size:0.95rem;font-weight:700}
  .h-fecha small{display:block;font-weight:400;opacity:0.8;font-size:0.8rem;margin-top:2px}
  /* El detalle va también impreso en el pie: el atributo title solo existe al
     pasar el ratón, y esta pieza se imprime y se proyecta. */
  .conf{color:#c3d3e2;font-size:0.7rem;text-align:right;margin-top:6px}
  .estado{display:inline-flex;align-items:center;gap:7px;border:2px solid ${estadoGral.col};
          color:${estadoGral.col};border-radius:20px;padding:6px 15px;font-size:0.76rem;
          font-weight:700;margin-top:9px;letter-spacing:0.04em}

  /* ── KPIs ───────────────────────────────────────────────── */
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:0;
        background:${T.panel};border-radius:10px;padding:6px;margin-bottom:14px}
  .kpi{padding:11px 10px;text-align:center;border-right:1px solid ${T.borde}}
  .kpi:last-child{border-right:none}
  .kpi-h{display:flex;align-items:center;justify-content:center;gap:5px;
         font-size:0.6rem;font-weight:700;color:${T.tintaSec};letter-spacing:0.05em}
  .kpi-v{font-size:1.85rem;font-weight:800;margin-top:5px;line-height:1.1;
         font-variant-numeric:tabular-nums;color:${T.tinta}}
  .kpi-v i{font-size:0.62rem;font-style:normal;font-weight:600;color:${T.tintaSec};margin-left:3px}
  .kpi-p{font-size:0.68rem;font-weight:700;margin-top:3px}
  .kpi-d{margin-top:4px}
  .dlt{font-size:0.57rem;font-weight:700;padding:2px 6px;border-radius:9px;white-space:nowrap}
  /* Rojo/verde por CONSECUENCIA operativa, no por dirección: subir la ETₒ tensa
     la operación, subir la HR la alivia. Siempre acompañado de cifra y texto. */
  .dlt-mal{background:#fdeaea;color:#b32020}
  .dlt-bien{background:#e8f6ec;color:#137a33}
  .dlt-igual{background:#eef2f6;color:${T.tintaSec}}

  /* ── Semáforo ───────────────────────────────────────────── */
  .semaforo{display:flex;gap:34px;flex-wrap:wrap;align-items:center}
  .foco{display:flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:600}
  .dot{width:11px;height:11px;border-radius:50%;display:inline-block;flex:none}

  /* ── Rejilla principal ──────────────────────────────────── */
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  .cols3{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:14px;align-items:start}
  @media (max-width:820px){.cols,.cols3{grid-template-columns:1fr}}

  /* ── Índices ────────────────────────────────────────────── */
  .idxs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center}
  .idx-k{font-size:0.86rem;font-weight:800;color:${T.marino}}
  .idx-n{font-size:0.6rem;color:${T.tintaSec};line-height:1.3;min-height:2.2em;margin-top:2px}
  .idx-e{font-size:0.72rem;font-weight:700;margin-top:2px}
  .idx-imp{font-size:0.6rem;color:${T.tintaSec};margin-top:3px;line-height:1.35;
           border-top:1px solid #eef2f6;padding-top:4px}

  /* ── Análisis ejecutivo ─────────────────────────────────── */
  .ejec{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .ej{padding:4px 9px;border-right:1px solid ${T.borde};text-align:center}
  .ej:last-child{border-right:none}
  .ej-i{font-size:1.5rem}
  .ej-t{font-size:0.55rem;font-weight:800;color:${T.tintaSec};letter-spacing:0.04em;margin-top:4px;line-height:1.3}
  .ej-v{font-size:1.02rem;font-weight:800;margin:5px 0}
  .ej-x{font-size:0.63rem;color:${T.tintaSec};line-height:1.45}

  /* ── Demanda de riego ───────────────────────────────────── */
  .dem{display:grid;grid-template-columns:1fr 1.15fr;gap:14px;align-items:start}
  .dem-lbl{font-size:0.58rem;font-weight:700;color:${T.tintaSec};letter-spacing:0.05em}
  .dem-niv{font-size:1.3rem;font-weight:800;color:${idr?.color ?? T.verde};margin:2px 0 8px}
  .barra{display:flex;gap:2px;margin-bottom:8px}
  .seg{flex:1;height:15px;border-radius:2px}
  .dem-pct{font-size:1.45rem;font-weight:800;text-align:center}
  .dem-pie{font-size:0.6rem;color:${T.tintaSec};text-align:center;line-height:1.4}
  table{width:100%;border-collapse:collapse;font-size:0.72rem}
  td{padding:5px 4px;border-bottom:1px solid #eef2f6}
  td:last-child{text-align:right;color:${T.verde};white-space:nowrap}
  .lam-b{width:44%;padding:5px 8px}
  .lam-b span{display:block;height:8px;border-radius:4px;background:${T.verde};opacity:0.55;min-width:2px}

  /* ── Pronóstico 24 h ────────────────────────────────────── */
  .preds{display:grid;grid-template-columns:repeat(4,1fr);gap:0;text-align:center}
  .pr{padding:4px 6px;border-right:1px solid ${T.borde}}
  .pr:last-child{border-right:none}
  .pr-n{font-size:0.75rem;font-weight:800}
  .pr-i{font-size:1.9rem;line-height:1.3}
  .pr-nd{font-size:1.1rem;color:${T.tintaSec};font-weight:700}
  .pr-t{font-size:0.82rem;font-weight:600}
  .pr-l{font-size:0.72rem;color:${T.azul};margin-top:3px}
  .pr-e{font-size:0.63rem;color:${T.tintaSec};margin-top:4px;line-height:1.4}
  .pr-s{font-size:0.58rem;color:${T.tintaSec};margin-top:4px}

  /* ── Tendencias ─────────────────────────────────────────── */
  .sparks{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .spark-t{font-size:0.6rem;font-weight:700;color:${T.tintaSec};letter-spacing:0.04em}
  .spark-sd{font-size:0.65rem;color:${T.tintaSec};padding:22px 0;text-align:center}

  /* ── Hidrológico / alertas / recomendaciones ────────────── */
  .hidro-f{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid #eef2f6}
  .hidro-f:last-child{border-bottom:none}
  .hidro-i{font-size:1.15rem;width:22px;text-align:center}
  .hidro-t{flex:1;line-height:1.35}
  .hidro-t b{display:block;font-size:0.73rem}
  .hidro-t span{font-size:0.63rem;color:${T.tintaSec}}
  .alerta{display:flex;gap:12px;align-items:flex-start}
  .alerta-i{font-size:1.9rem;line-height:1}
  .alerta-x{font-size:0.75rem;line-height:1.6}
  .recos{list-style:none;padding:0;margin:0;font-size:0.73rem;line-height:1.85}
  .recos li::before{content:'✓ ';color:${T.verde};font-weight:800}

  /* ── Mapa y pie ─────────────────────────────────────────── */
  /* El plano conserva su proporción real; se acota en alto para que la columna
     izquierda no crezca por debajo de la derecha y deje un hueco. */
  .plano svg{display:block;border-radius:8px;max-height:620px;width:auto;margin:0 auto}
  .plano-pie{font-size:0.6rem;color:${T.tintaSec};margin-top:7px;line-height:1.45}
  footer{display:flex;gap:26px;flex-wrap:wrap;justify-content:space-between;
         color:#c3d3e2;font-size:0.68rem;padding:12px 4px 4px;line-height:1.5}
  footer b{color:#fff;display:block;font-weight:600}
  .nota{color:#93a9bd;font-size:0.62rem;padding:0 4px 6px;line-height:1.5}
  @media print{body{padding:0}}
</style></head><body><div class="wrap">

<header>
  ${logoSRL ? `<img src="${logoSRL}" alt="SRL Unidad Conchos">` : ''}
  ${logoSICA ? `<img src="${logoSICA}" alt="SICA-005" style="border-radius:8px">` : ''}
  <div class="h-tit">
    <h1>SICA-005 <span>| CENTRO DE INTELIGENCIA AGROCLIMÁTICA</span></h1>
    <div class="h-sub">SRL Unidad Conchos – Distrito de Riego 005</div>
    <div class="h-sub2">Estado Operativo del Distrito</div>
  </div>
  <div>
    <div class="h-fecha">🗓️ ${fechaLarga}<small>${hora} hrs</small></div>
    <div class="estado"><span class="dot" style="background:${estadoGral.col}"></span>${estadoGral.txt}</div>
    <div class="conf" title="${confDetalle}">
      Confianza del dato: <b style="color:${confianza.col}">${confianza.txt} · ${confianzaPct}%</b>
    </div>
  </div>
</header>

<div class="kpis">${kpis}</div>

<h2>SEMÁFORO OPERATIVO DEL DISTRITO</h2>
<div class="sec semaforo">
  ${foco(demanda.txt, demanda.col)}
  ${foco(riesgo.txt, riesgo.col)}
  ${foco(canales.txt, canales.col)}
</div>

<div class="cols">
  <div>
    <h2>MAPA DEL DISTRITO Y ESTACIONES</h2>
    <div class="sec plano">
      ${plano || `<div style="color:${T.tintaSec};font-size:0.78rem">Sin estaciones georreferenciadas.</div>`}
      <div class="plano-pie">Contornos de los 6 módulos SRL (M1-M5, M12) sobre el Canal Principal Conchos (K0→K104) y el río Conchos.
      El marcador de cada estación lleva el icono de nubosidad prevista a 24 h; «?» indica que no hay fuente de nubosidad.</div>
    </div>
  </div>
  <div>
    <h2>ÍNDICES AGROCLIMÁTICOS DEL DISTRITO</h2>
    <div class="sec"><div class="idxs">${anillos}</div></div>

    <h2>ANÁLISIS EJECUTIVO</h2>
    <div class="sec"><div class="ejec">${ejecHTML}</div></div>

    <h2>CONDICIÓN DEL CIELO</h2>
    <div class="sec" style="font-size:0.8rem;line-height:1.5;margin-bottom:0">
      ${cieloBanda.replace('<span>', '<span style="display:block;font-size:0.63rem;color:' + T.tintaSec + ';margin-top:3px">')}
    </div>
  </div>
</div>

<div class="cols">
  <div>
    <h2>DEMANDA DE RIEGO <small style="font-weight:400;opacity:0.85">(LÁMINA BRUTA)</small></h2>
    <div class="sec">
      <div class="dem">
        <div>
          <div class="dem-lbl">NIVEL ACTUAL</div>
          <div class="dem-niv">${idr?.etiqueta ?? 'S/D'}</div>
          <div class="barra">${barra}</div>
          <div class="dem-pct" style="color:${idr?.color ?? T.tintaSec}">${nivelPct != null ? nivelPct + '%' : 'S/D'}</div>
          <div class="dem-pie">del índice de demanda de riego (IDR)</div>
        </div>
        <div>
          <div class="dem-lbl">LÁMINA BRUTA REQUERIDA</div>
          <div style="font-size:0.6rem;color:${T.tintaSec};margin-bottom:5px">(equivalente m³/ha·día)</div>
          <table>${laminasHTML}</table>
        </div>
      </div>
    </div>
  </div>
  <div>
    <h2>PRONÓSTICO A 24 HORAS POR ESTACIÓN</h2>
    <div class="sec"><div class="preds">${predHTML || '<div style="font-size:0.75rem;color:' + T.tintaSec + '">Sin estaciones en línea.</div>'}</div></div>
  </div>
</div>

<div class="cols3">
  <div>
    <h2>TENDENCIAS <small style="font-weight:400;opacity:0.85">(ÚLTIMOS 7 DÍAS)</small></h2>
    <div class="sec">
      <div class="sparks">${sparks}</div>
      <div style="font-size:0.58rem;color:${T.tintaSec};margin-top:7px">* Datos horarios promediados por día; ETₒ como acumulado diario máximo.</div>
    </div>
  </div>
  <div>
    <h2>ESTADO HIDROLÓGICO</h2>
    <div class="sec">${hidro}</div>
  </div>
  <div>
    <h2>ALERTAS</h2>
    <div class="sec">
      <div class="alerta">
        <div class="alerta-i">${alertas.length ? '⚠️' : '✅'}</div>
        <div class="alerta-x">${alertas.length
            ? alertas.join('<br>')
            : `Sin alertas.<br>${lluviaObs > 0 ? `Lluvia ${lluviaObs.toFixed(1)} mm.` : 'Sin lluvia.'}<br>${demanda.txt}.<br>Operación estable.`}</div>
      </div>
    </div>

    <h2>RECOMENDACIONES OPERATIVAS</h2>
    <div class="sec"><ul class="recos">${recos.map(r => `<li>${r}</li>`).join('')}</ul></div>
  </div>
</div>

<div class="nota">
  <b style="color:#fff">Alcance de esta pieza.</b> Infografía de consulta rápida: presenta indicadores agregados, no la metodología.
  Cielo y probabilidad de lluvia son variables independientes y se leen por separado; un índice sin datos se muestra como «S/D», nunca como cero.
  No modifique entregas por el icono meteorológico: decida con ETₒ validada, humedad de suelo y demanda programada.<br>
  <b style="color:#fff">Trazabilidad del corte.</b> Confianza ${confianzaPct} % — ${confDetalle}.
  Las variaciones «vs. 7 d» comparan contra la media de los días previos, no contra el día anterior.
</div>

<footer>
  <div>🧭 <b>Índice Agroclimático SICA</b>Modelo FAO-56 Penman-Monteith</div>
  <div>📡 <b>WeatherLink Davis</b>Actualización cada 15 minutos</div>
  <div>📍 <b>Distrito de Riego 005</b>SRL Unidad Conchos</div>
</footer>

</div></body></html>`;
}

/**
 * Genera la infografía de clima actual y la descarga como HTML autónomo.
 * `historial` (promedios diarios de 7 días) es OPCIONAL: sin él, el panel de
 * tendencias se rotula "sin datos suficientes" en vez de dibujar una línea falsa.
 */
export async function exportClimaInfografia(
    ests: EstacionConLectura[], historial: DiaHistorico[] = [],
): Promise<void> {
    // Fondo satelital con realce geomorfológico. Es opcional por diseño: sin red
    // (o si el navegador bloquea el canvas por CORS) devuelve null y el plano cae
    // al fondo vectorial, en vez de dejar la infografía sin mapa.
    const ext = extensionMapa(ests);
    const fondo = ext
        ? await construyeFondoSatelital(ext.minLon, ext.maxLon, ext.minLat, ext.maxLat)
        : null;
    const html = await buildHTML(ests, historial, fondo);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `infografia-clima-conchos-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
