// Informe de avance del Tratado de Aguas de 1944 (ciclo 2025-2030): EUA (IBWC) contra México (SICA y CONAGUA/CILA).
// HTML autónomo en tres formatos: PDF carta (con trazabilidad y firmas), infografía PNG y lámina 17×11. Mismas cifras que la pantalla:
// todo sale de tratadoCiclo.ts y las gráficas de tratadoGraficas.ts (una sola fuente).
import {
  cssInforme, documentoHtml, esc, fechaHoraLegible, folioConPartes, hashCorto, pieInforme, bloqueFirmas, tablaTrazabilidad, FUENTE_MARCA,
} from './informeBase';
import { CSS_MEMBRETE, altoMembretePorAncho, membreteDual } from './membreteDual';
import { CSS_COMUN } from './informeCuencaHtml';
import {
  afAGastoM3s, afAMm3, avanceCiclo, brechaOficialVsPublicado, concilia, fechaLargaTratado, fmtAf, lecturaAvance, rangoAnioCiclo,
  resuelvePeriodo, serieAcumuladaPublicada, volumenMensual, volumenPeriodo,
  type AvanceCiclo, type CapturaMx, type Conciliacion, type FilaMes, type PeriodoSel, type VolumenPeriodo, type Periodo,
} from './tratadoCiclo';
import { PALETA_PAPEL, svgAvance, svgBarraAvance, svgMensual } from './tratadoGraficas';
import type { DatosTratado } from '../hooks/useTratadoCiclo';

export type FormatoInformeTratado = 'carta' | 'png' | 'lamina';
export const ANCHO_PNG_TRATADO = 1500;
export const LAMINA_TRATADO_PX = { ancho: 1632, alto: 1056 } as const;

export interface ConfigInformeTratado {
  periodo: PeriodoSel;
  contenido: 'completo' | 'infografia';
  afluentes: boolean;
  mensual: boolean;
  conciliacion: boolean;
  capturas: boolean;
}
export const configTratadoPorDefecto = (): ConfigInformeTratado => ({ periodo: { tipo: 'ciclo' }, contenido: 'completo', afluentes: true, mensual: true, conciliacion: true, capturas: true });

export interface DatosInformeTratado {
  config: ConfigInformeTratado; datos: DatosTratado; hoy: string; emitido: Date;
  per: Periodo; av: AvanceCiclo; vol: VolumenPeriodo; conc: Conciliacion; mensual: FilaMes[];
  capturasPeriodo: CapturaMx[]; brecha: ReturnType<typeof brechaOficialVsPublicado>;
  dominio: { desde: string; hasta: string };
}

export function construirDatosTratado(config: ConfigInformeTratado, datos: DatosTratado, hoy: string, emitido: Date): DatosInformeTratado {
  const per = resuelvePeriodo(datos.ciclo, config.periodo, hoy);
  const av = avanceCiclo(datos.ciclo, datos.cortes);
  const vol = volumenPeriodo(datos.entregas, datos.afluentes, per.desde, per.hasta);
  const dominio = config.periodo.tipo === 'ciclo' ? { desde: datos.ciclo.inicio, hasta: datos.ciclo.fin }
    : config.periodo.tipo === 'anio' ? rangoAnioCiclo(datos.ciclo, config.periodo.anio) : { desde: per.desde, hasta: per.hasta };
  return {
    config, datos, hoy, emitido, per, av, vol, conc: concilia(vol, datos.sutron, datos.capturas, datos.entregas),
    mensual: volumenMensual(datos.entregas, per.desde, per.hasta),
    capturasPeriodo: datos.capturas.filter((c) => !c.anulada && c.desde >= per.desde && c.hasta <= per.hasta),
    brecha: brechaOficialVsPublicado(datos.entregas, datos.ciclo, av.corte), dominio,
  };
}

const SD = '<span class="sd">S/D</span>';
const n1 = (v: number | null, d = 1) => (v == null ? SD : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const af0 = (v: number | null) => (v == null ? SD : fmtAf(v));
const sg = (v: number | null, d = 0) => (v == null ? SD : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);

export function folioTratado(d: DatosInformeTratado): string {
  return folioConPartes('TRATADO-1944', [d.per.clave.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 14)], d.emitido);
}
export function huellaTratado(d: DatosInformeTratado): string {
  return hashCorto(JSON.stringify({ p: d.per.clave, a: d.av.acumuladoAf, c: d.av.corte?.fecha, v: d.vol.totalAf, k: d.capturasPeriodo.map((c) => c.id) }));
}

interface Opciones { formato: FormatoInformeTratado; logoSrl: string; logoSica: string; emitido: Date }

function membrete(o: Opciones, d: DatosInformeTratado, alto?: number): string {
  return membreteDual({
    logoSrl: o.logoSrl, logoSica: o.logoSica, titulo: alto ? '' : 'Tratado de Aguas de 1944 · avance del ciclo 2025-2030',
    meta: alto ? undefined : [{ k: 'Periodo', v: d.per.etiqueta }, { k: 'Corte oficial', v: d.av.corte ? fechaLargaTratado(d.av.corte.fecha) : 'S/D' }, { k: 'Folio', v: folioTratado(d) }], alto,
  });
}

// ── Bloques ──────────────────────────────────────────────────────────────────────────────────────────────
const kpi = (et: string, v: string, s: string, cls = '') => `<div class="kpi ${cls}"><div class="et">${esc(et)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;

function titular(d: DatosInformeTratado, conTitulo = true): string {
  return `<div class="titulo">${conTitulo ? '<h1>Tratado de Aguas de 1944 · avance del ciclo 2025-2030</h1>' : ''}<p>${esc(lecturaAvance(d.av))} Ciclo del 25 de octubre de 2025 al 24 de octubre de 2030 · dato provisional del IBWC.</p></div>`;
}

function kpisOficiales(d: DatosInformeTratado): string {
  const { av, datos } = d;
  const estado = av.estado === 'adelante' ? 'por delante de la meta lineal' : av.estado === 'atrasado' ? 'por debajo de la meta lineal' : av.estado === 'en_meta' ? 'en la meta lineal' : '';
  return `<div class="kpis">${[
    kpi('Entregado en el ciclo (IBWC)', av.acumuladoAf != null ? `${fmtAf(av.acumuladoAf)}<small> AF</small>` : SD, av.acumuladoMm3 != null ? `${n1(av.acumuladoMm3)} Mm³ · ${av.pctCompromiso?.toFixed(1)} % de ${fmtAf(datos.ciclo.compromisoAf)} AF` : 'sin corte oficial'),
    kpi('Contra la meta lineal', av.difLinealAf != null ? `${sg(av.difLinealAf)}<small> AF</small>` : SD, av.metaLinealAf != null ? `${esc(estado)} · meta al corte ${fmtAf(av.metaLinealAf)} AF · año ${av.anio ?? '—'} de 5` : 'S/D'),
    kpi('Falta para el compromiso', av.faltanteAf != null ? `${fmtAf(av.faltanteAf)}<small> AF</small>` : SD, av.ritmoRequeridoAfDia != null ? `${fmtAf(av.ritmoRequeridoAfDia * 7)} AF por semana (${n1(av.ritmoRequeridoM3s, 2)} m³/s medios) durante ${fmtAf(av.diasRestantes ?? 0)} días` : 'S/D'),
    kpi('Deuda del ciclo anterior', av.deudaRemanenteAf != null ? `${fmtAf(av.deudaRemanenteAf)}<small> AF</small>` : SD, datos.ciclo.deudaPreviaAf != null ? `cerró 2020-2025 con ${fmtAf(datos.ciclo.deudaPreviaAf)} AF de déficit (${n1(afAMm3(datos.ciclo.deudaPreviaAf))} Mm³)` : 'S/D'),
  ].join('')}</div>`;
}

function barra(d: DatosInformeTratado): string {
  const meta = d.av.metaLinealAf != null ? (d.av.metaLinealAf / d.datos.ciclo.compromisoAf) * 100 : null;
  return `<div class="barra"><span class="barra-et">Avance del compromiso</span><span class="barra-svg">${svgBarraAvance(d.av.pctCompromiso, meta, PALETA_PAPEL, 520)}</span><span class="barra-v">${d.av.pctCompromiso != null ? `${d.av.pctCompromiso.toFixed(1)} %` : SD}<small>marca roja = meta lineal</small></span></div>`;
}

function graficaAvance(d: DatosInformeTratado, ancho = 760, alto = 330): string {
  const publicada = serieAcumuladaPublicada(d.datos.entregas, d.datos.ciclo.inicio, d.hoy);
  const svg = svgAvance({ ciclo: d.datos.ciclo, dominioDesde: d.dominio.desde, dominioHasta: d.dominio.hasta, publicada, cortes: d.datos.cortes, paleta: PALETA_PAPEL, mostrarDeuda: d.config.periodo.tipo === 'ciclo', hoy: d.hoy, ancho, alto });
  const ley = [
    ['oficial', 'Acumulado oficial IBWC (corte semanal)'], ['pub', 'Suma de las series publicadas (con huecos)'], ['meta', 'Meta lineal (350,000 AF por año)'],
    ...(d.config.periodo.tipo === 'ciclo' ? [['deuda', 'Meta lineal con la deuda 2020-2025']] : []),
  ].map(([k, t]) => `<li><i class="ley ley-${k}"></i>${esc(t)}</li>`).join('');
  const b = d.brecha;
  const nota = b ? `<p class="aviso"><b>Por qué hay dos curvas:</b> al ${esc(fechaLargaTratado(d.av.corte!.fecha))} el IBWC reporta ${fmtAf(b.oficialAf)} AF, pero las series públicas de los seis afluentes suman ${fmtAf(b.publicadoAf)} AF (${b.pct.toFixed(0)} % menos): tienen días sin dato (S/D) y el corte oficial incluye «otras fuentes aceptadas». La cifra oficial es la del compromiso; la otra sirve para ver qué afluente y qué mes aportan.</p>` : '';
  return `<section class="bloque"><h2>Avance acumulado contra la meta</h2><div class="graf">${svg}</div><ul class="leyenda-g">${ley}</ul>${nota}</section>`;
}

function kpisPeriodo(d: DatosInformeTratado): string {
  const { vol, per } = d;
  const conchos = vol.afluentes.find((a) => a.clave === 'conchos');
  const gasto = vol.totalAf > 0 ? afAGastoM3s(vol.totalAf, vol.diasPeriodo) : null;
  const mayor = [...vol.afluentes].filter((a) => a.af != null).sort((a, b) => (b.af ?? 0) - (a.af ?? 0))[0];
  return `<div class="kpis">${[
    kpi('Volumen del periodo (6 afluentes)', vol.totalAf > 0 ? `${n1(vol.totalMm3)}<small> Mm³</small>` : SD, vol.totalAf > 0 ? `${fmtAf(vol.totalAf)} AF${vol.cotaInferior ? ' · cota inferior (hay días sin dato)' : ''}` : 'sin datos en el periodo'),
    kpi('Gasto medio equivalente', gasto != null ? `${n1(gasto, 1)}<small> m³/s</small>` : SD, `${vol.diasPeriodo} días · ${esc(per.etiqueta)}`),
    kpi('Aporte del Río Conchos', conchos?.af != null && vol.totalAf > 0 ? `${((conchos.af / vol.totalAf) * 100).toFixed(0)}<small> %</small>` : SD, conchos?.mm3 != null ? `${n1(conchos.mm3, 1)} Mm³ en Ojinaga (08373000)` : 'S/D'),
    kpi('Afluente con más volumen', mayor ? esc(mayor.nombre.replace(/^R[ií]o /, '')) : SD, mayor?.mm3 != null ? `${n1(mayor.mm3, 1)} Mm³ · ${fmtAf(mayor.af!)} AF` : 'S/D', 'kpi-txt'),
  ].join('')}</div>`;
}

function bloqueAfluentes(d: DatosInformeTratado, ancho = 760, alto = 260): string {
  const { vol, datos } = d;
  const filas = vol.afluentes.map((a, k) => `<tr><th scope="row"><i class="sw" style="background:${PALETA_PAPEL.afluentes[k % 6]}"></i>${esc(a.nombre)} <small>${esc(a.estacion)}</small></th>
<td class="n">${n1(a.mm3, 2)}</td><td class="n">${af0(a.af)}</td><td class="n">${a.af != null && vol.totalAf > 0 ? `${((a.af / vol.totalAf) * 100).toFixed(1)} %` : SD}</td><td class="n">${a.dias} de ${a.diasPeriodo}</td></tr>`).join('');
  const total = `<tr class="tot"><th scope="row">Total (series publicadas)</th><td class="n">${vol.totalAf > 0 ? n1(vol.totalMm3, 2) : SD}</td><td class="n">${vol.totalAf > 0 ? fmtAf(vol.totalAf) : SD}</td><td class="n">${vol.totalAf > 0 ? '100 %' : SD}</td><td class="n"></td></tr>`;
  const leyenda = datos.afluentes.map((a, k) => `<li><i class="sw" style="background:${PALETA_PAPEL.afluentes[k % 6]}"></i>${esc(a.nombre)}</li>`).join('');
  return `${d.config.mensual ? `<section class="bloque"><h2>Volumen mensual por afluente <small>· ${esc(d.per.etiqueta)}</small></h2><div class="graf">${svgMensual({ filas: d.mensual, afluentes: datos.afluentes, paleta: PALETA_PAPEL, ancho, alto })}</div><ul class="leyenda-g">${leyenda}</ul></section>` : ''}
${d.config.afluentes ? `<section class="bloque"><h2>Desglose por afluente <small>· ${esc(d.per.etiqueta)}</small></h2><table class="cifras"><thead><tr><th>Afluente</th><th class="n">Mm³</th><th class="n">Acre-pies</th><th class="n">% del total</th><th class="n">Días con dato</th></tr></thead><tbody>${filas}${total}</tbody></table></section>` : ''}`;
}

function bloqueConciliacion(d: DatosInformeTratado): string {
  const { conc } = d;
  const filas = conc.fuentes.map((f) => `<tr><th scope="row">${esc(f.nombre)}<br><small>${esc(f.nota)}</small></th><td class="n">${n1(f.mm3, 2)}</td><td class="n">${af0(f.af)}</td><td class="n">${f.cobertura == null ? '—' : `${f.cobertura.toFixed(0)} %`}</td></tr>`).join('');
  const aviso = !conc.sicaConfiable && conc.razonSicaIbwc != null
    ? `<p class="aviso"><b>El Sutron de Ojinaga no es confiable para gasto:</b> mide ${conc.razonSicaIbwc.toFixed(1)} veces lo que el aforo oficial del IBWC en los mismos días. No se corrige ni se oculta: se presenta como brecha hasta calibrar su curva de gasto.</p>` : '';
  return `<section class="bloque"><h2>Conciliación: EUA contra México <small>· ${esc(d.per.etiqueta)}</small></h2>
<table class="cifras"><thead><tr><th>Fuente</th><th class="n">Mm³</th><th class="n">Acre-pies</th><th class="n">Cobertura</th></tr></thead><tbody>${filas}</tbody></table>
<ul class="concl"><li>Río Conchos medido por SICA frente al IBWC: <b>${conc.razonSicaIbwc != null ? `${conc.razonSicaIbwc.toFixed(1)}×` : SD}</b>${conc.difSicaIbwcMm3 != null ? ` (${sg(conc.difSicaIbwcMm3, 1)} Mm³)` : ''}${conc.diasComunesSica > 0 ? `, comparado solo en los ${conc.diasComunesSica} días con dato de ambos` : ' (sin días con dato de ambos)'}.</li>
<li>Cifra oficial de CONAGUA frente a la suma publicada por el IBWC: <b>${conc.difConaguaIbwcMm3 != null ? `${sg(conc.difConaguaIbwcMm3, 1)} Mm³ (${sg(conc.difConaguaIbwcPct, 1)} %)` : 'S/D · falta capturarla'}</b>.</li></ul>${aviso}</section>`;
}

function bloqueCapturas(d: DatosInformeTratado): string {
  if (!d.capturasPeriodo.length) return `<section class="bloque"><h2>Cifras oficiales de México (CONAGUA / CILA)</h2><p class="sd">Sin cifras oficiales capturadas dentro del periodo (S/D).</p></section>`;
  const filas = d.capturasPeriodo.map((c) => `<tr><th scope="row">${esc(c.desde)} a ${esc(c.hasta)}</th><td class="n">${n1(c.mm3, 2)}</td><td class="n">${fmtAf(c.mm3 * 810.7132)}</td><td>${esc(c.fuente)}${c.comentario ? `<br><small>${esc(c.comentario)}</small>` : ''}</td><td>${esc(c.autor ?? 'S/D')}</td></tr>`).join('');
  return `<section class="bloque"><h2>Cifras oficiales de México (CONAGUA / CILA)</h2><table class="cifras"><thead><tr><th>Periodo</th><th class="n">Mm³</th><th class="n">Acre-pies</th><th>Fuente</th><th>Capturó</th></tr></thead><tbody>${filas}</tbody></table></section>`;
}

function notas(d: DatosInformeTratado): string {
  return `<section class="notas"><h3>Cómo se lee y qué límites tiene</h3><ul>
<li><b>El compromiso:</b> el Tratado de 1944 obliga a México a entregar a EUA, en promedio, 350,000 acre-pies al año en ciclos de cinco años (1,750,000 AF = 2,158.6 Mm³), de seis afluentes del Bravo: Conchos, San Diego, San Rodrigo, Escondido, Salado y Arroyo Las Vacas. El ciclo vigente corre del 25 de octubre de 2025 al 24 de octubre de 2030 (fecha oficial del IBWC).</li>
<li><b>Cifra oficial:</b> el acumulado del compromiso es el corte semanal del IBWC («Current_Cycle.pdf»), que incluye «otras fuentes aceptadas». Las series diarias de los seis afluentes son provisionales y traen días sin dato (S/D): su suma queda por debajo del corte y se usa para el desglose, no como cifra del compromiso.</li>
<li><b>Meta lineal:</b> 350,000 AF por año repartidos parejo en los 1,826 días del ciclo. No es el calendario real de escurrimientos; la línea con deuda suma además el déficit del ciclo anterior (${fmtAf(d.datos.ciclo.deudaPreviaAf ?? 0)} AF). El ritmo requerido y la proyección son tendencia lineal, no pronóstico.</li>
<li><b>México:</b> «SICA» es la medición propia del Sutron de Ojinaga (GOES) y «CONAGUA/CILA» la cifra oficial capturada por el usuario con su fuente. El Sutron no es confiable para gasto mientras su curva no se calibre. S/D nunca se cuenta como cero.</li>
<li><b>Datos:</b> USIBWC Water Data (datos provisionales sujetos a revisión). Sincronización automática tres veces al día; ${d.datos.ultimaSync ? `última corrida ${d.datos.ultimaSync.ok ? 'correcta' : 'con error'} el ${esc(fechaHoraLegible(new Date(d.datos.ultimaSync.en)))}` : 'sin registro de corrida'}.</li></ul></section>`;
}

function filasTrazabilidad(d: DatosInformeTratado): { k: string; v: string }[] {
  return [
    { k: 'Folio', v: folioTratado(d) },
    { k: 'Emitido', v: fechaHoraLegible(d.emitido) },
    { k: 'Periodo', v: `${d.per.etiqueta} (${d.per.desde} a ${d.per.hasta})` },
    { k: 'Ciclo', v: `${d.datos.ciclo.nombre}: ${d.datos.ciclo.inicio} a ${d.datos.ciclo.fin}` },
    { k: 'Corte oficial IBWC', v: d.av.corte ? `${fechaLargaTratado(d.av.corte.fecha)}: ${fmtAf(d.av.corte.acumuladoAf)} AF` : 'S/D' },
    { k: 'Fuentes', v: 'USIBWC Water Data (Discharge Total.Preliminary-Daily-Volume-TCM) y Current_Cycle.pdf; Sutron Ojinaga (GOES, SICA); capturas de CONAGUA/CILA' },
    { k: 'Conversión', v: '1 acre-pie = 1,233.4818 m³; 1 Mm³ = 810.71 AF' },
    { k: 'Huella de la configuración', v: huellaTratado(d) },
    { k: 'Clasificación', v: 'Dato provisional · seguimiento operativo, no es el dictamen de la CILA' },
  ];
}

// ── Estilos ──────────────────────────────────────────────────────────────────────────────────────────────
const CSS_TRATADO = `
.titulo{margin:4px 0 6px}
.titulo h1{font:800 1.9em/1.1 ${FUENTE_MARCA};color:#0B3170;margin:0}
.titulo p{margin:3px 0 0;color:#3d4650;max-width:62em}
.kpi.kpi-txt .v{font-size:1.2em;line-height:1.25}
.barra{display:grid;grid-template-columns:auto minmax(120px,1fr) auto;gap:10px;align-items:center;margin:0 0 14px}
.barra-et{font-size:.74em;letter-spacing:.06em;text-transform:uppercase;color:#57606a;font-weight:700}
.barra-v{font:800 1.15em ${FUENTE_MARCA};color:#0B3170;white-space:nowrap}
.barra-v small{display:block;font:400 .62em "Segoe UI",Arial,sans-serif;color:#57606a}
.graf{margin:2px 0 4px}.graf svg{display:block;width:100%;height:auto}
.leyenda-g{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;margin:4px 0 8px;padding:0;font-size:.8em;color:#3d4650}
.leyenda-g li{display:inline-flex;align-items:center;gap:6px}
.ley{display:inline-block;width:26px;height:0;border-top:3px solid}
.ley-oficial{border-color:#111827}.ley-pub{border-color:#0f766e;border-top-style:dotted}.ley-meta{border-color:#b91c1c}.ley-deuda{border-color:#2563eb;border-top-style:dashed}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
table.cifras tr.tot th,table.cifras tr.tot td{font-weight:800;border-top:2px solid #0B3170}
table.cifras th small{font-weight:400;color:#57606a}
.concl{margin:8px 0 0;padding-left:18px;font-size:.92em}
.inst{margin:8px 0 0;font-size:.8em;line-height:1.35;color:#3d4650;border-top:1px solid #D8E2EC;padding-top:6px}
.dos{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.firmas{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:26px}
.firma .linea{border-bottom:1px solid #1f2328;height:34px;margin-bottom:4px}.firma b{display:block;font-size:.92em}.firma span{font-size:.78em;color:#57606a}
table.traza{width:100%;border-collapse:collapse;font-size:.85em}
table.traza th{text-align:left;width:30%;padding:3px 6px;border-bottom:1px solid #DCE3EA;color:#57606a;font-weight:600;vertical-align:top}
table.traza td{padding:3px 6px;border-bottom:1px solid #DCE3EA}
`;
const CSS_CARTA = `${CSS_COMUN}${CSS_TRATADO}
.pagina{font-size:9.5pt}
.titulo h1{font-size:19pt}
.kpi .v{font-size:15pt}.kpi .s{font-size:7.2pt}
.kpi.kpi-txt .v{font-size:12pt}
`;
const CSS_INFO = (ancho: number, alto: number | null) => `
*{box-sizing:border-box}
html,body{margin:0;background:#F4F8FC}
body{width:${ancho}px;${alto ? `height:${alto}px;overflow:hidden;` : ''}font:${alto ? 14 : 17}px/1.4 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1B2733;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.hoja{width:${ancho}px;${alto ? `height:${alto}px;padding:14px 32px 10px;` : 'padding:24px 44px 20px;'}background:#F4F8FC;display:flex;flex-direction:column}
.pie-inf{margin-top:auto;padding-top:8px;border-top:2px solid #0A7FDB;display:flex;justify-content:space-between;gap:16px;font-size:.74em;color:#57606a;text-transform:uppercase;letter-spacing:.05em}
${CSS_COMUN}${CSS_TRATADO}
`;

const LINEA_INST = `<p class="inst">Cifra oficial: corte semanal del IBWC (Current_Cycle.pdf); series diarias provisionales con días sin dato (S/D). Meta lineal = 350,000 AF por año. «SICA» es la medición propia del Sutron de Ojinaga; «CONAGUA/CILA», la cifra oficial capturada. Seguimiento operativo, no es el dictamen de la CILA.</p>`;

// ── Formatos ─────────────────────────────────────────────────────────────────────────────────────────────
function infografia(d: DatosInformeTratado, o: Opciones): string {
  const lam = o.formato === 'lamina';
  const ancho = lam ? LAMINA_TRATADO_PX.ancho : ANCHO_PNG_TRATADO;
  const cabecera = membrete(o, d, lam ? 76 : altoMembretePorAncho(ancho));
  const pie = `<div class="pie-inf"><span>Folio ${esc(folioTratado(d))}</span><span>SRL Unidad Conchos · Delicias · SICA 005</span><span>Fuente: USIBWC Water Data (provisional) · emitido ${esc(fechaHoraLegible(o.emitido))}</span></div>`;
  const aflu = d.config.mensual || d.config.afluentes ? bloqueAfluentes(d, 760, lam ? 230 : 260) : '';
  const conc = d.config.conciliacion ? bloqueConciliacion(d) : '';
  const inst = LINEA_INST;
  const cuerpo = lam
    ? `${kpisOficiales(d)}<div class="dos"><div>${graficaAvance(d, 760, 300)}${barra(d)}</div><div>${aflu}</div></div>${conc}${inst}`
    : `${kpisOficiales(d)}${barra(d)}${graficaAvance(d, 900, 360)}${kpisPeriodo(d)}${aflu}${conc}${d.config.capturas ? bloqueCapturas(d) : ''}${inst}`;
  return `<div class="hoja${lam ? ' lam' : ''}">${cabecera}${titular(d)}${cuerpo}${pie}</div>`;
}

function carta(d: DatosInformeTratado, o: Opciones): string {
  const paginas: { cuerpo: string }[] = [];
  paginas.push({ cuerpo: `${titular(d, false)}${kpisOficiales(d)}${barra(d)}${graficaAvance(d)}` });
  if (d.config.mensual || d.config.afluentes) paginas.push({ cuerpo: `${kpisPeriodo(d)}${bloqueAfluentes(d)}` });
  const solo = d.config.contenido === 'infografia'; // sin notas metodológicas, trazabilidad ni firmas: queda la línea institucional mínima
  const ultima = [
    d.config.conciliacion ? bloqueConciliacion(d) : '', d.config.capturas ? bloqueCapturas(d) : '',
    ...(solo ? [LINEA_INST] : [notas(d), `<section class="bloque"><h2>Trazabilidad</h2>${tablaTrazabilidad(filasTrazabilidad(d))}</section>`, `<section class="bloque"><h2>Firmas</h2>${bloqueFirmas()}</section>`]),
  ].join('');
  paginas.push({ cuerpo: ultima });
  const total = paginas.length;
  return paginas.map((p, i) => `<section class="pagina">${membrete(o, d)}<div class="cuerpo">${p.cuerpo}</div>${pieInforme(`Folio ${folioTratado(d)}`, i + 1, total)}</section>`).join('\n');
}

/** HTML autónomo del informe en el formato pedido. */
export function htmlInformeTratado(d: DatosInformeTratado, o: Opciones): string {
  const titulo = `Tratado de Aguas de 1944 · ${d.per.etiqueta}`;
  const metas = { 'sica:folio': folioTratado(d) };
  if (o.formato === 'carta') return documentoHtml({ titulo, css: `${cssInforme({ formato: 'letter' })}${CSS_CARTA}`, cuerpo: carta(d, o), metas });
  const lam = o.formato === 'lamina';
  const css = `${CSS_MEMBRETE}${CSS_INFO(lam ? LAMINA_TRATADO_PX.ancho : ANCHO_PNG_TRATADO, lam ? LAMINA_TRATADO_PX.alto : null)}${lam ? '@page{size:17in 11in;margin:0}' : ''}`;
  return documentoHtml({ titulo, css, cuerpo: infografia(d, o), metas }).replace(/<button class="btn-imprimir[\s\S]*?<\/button>/, '');
}

