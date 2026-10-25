/**
 * informeNdviResumen — lógica PURA de la hoja 1 del informe técnico de NDVI: titular real del periodo con su cautela,
 * hallazgos con cifra, estado del distrito por clase de vigor, "qué revisar" con criterio explícito (nunca causal) y la
 * tabla de conciliación de las cifras del "NDVI de la SRL" (mes, media del periodo, habitual, pico medio).
 * Todo umbral sale de constantes (CLASES_NDVI, UMBRAL_SIN_CAMBIO…); ninguna frase afirma causas; S/D nunca es 0.
 */
import { fmt } from './formato';
import { media } from './estadisticaBasica';
import { mesLegible } from './informeBase';
import { CLASES_NDVI } from './ndviRampa';
import { UMBRAL_SIN_CAMBIO } from './ndviInteranual';
import { CAUTELA_TITULAR, titularDeAnomalias } from './ndviGrafica';
import { textoReferencia, type TendenciaModulo } from './informeNdviAnalisis';
import { etiquetaPeriodo } from './informeNdviConfig';
import { definicionNdviSrl, rotuloBase } from './ndviPromedio';
import type { InformeNdvi } from './informeNdviDatos';

/** Debajo de este NDVI el módulo cae en "Vigor bajo" o menos: es el inicio de la clase "Vigor medio". */
export const UMBRAL_REVISION_VIGOR = (CLASES_NDVI.find((c) => c.clave === 'medio') ?? CLASES_NDVI[2]).desde;

/** Un grupo de módulos que cumplen el mismo criterio de revisión. */
export interface ItemRevisar { modulos: number[]; criterio: string; cifras: string }

export interface FilaConciliacion { etiqueta: string; valor: number | null; nota: string }

export interface ResumenEjecutivo {
    titular: string;
    /** Cautela que va SIEMPRE pegada al titular (en cualquier sección que lo repita). */
    cautela: string;
    hallazgos: string[];
    /** Estado del distrito por clase de vigor en una frase ("3 de 6 módulos en Vigor medio (M2, M3, M5); …"). */
    estado: string;
    revisar: ItemRevisar[];
    criteriosRevision: string;
    accionRevisar: string;
    /** Definición única y rotulada de "NDVI de la SRL" para todo el informe. */
    definicionSrl: string;
    conciliacion: FilaConciliacion[];
}

type Entrada = Omit<InformeNdvi, 'resumen'>;

/** Un valor que redondea a cero va sin signo («0.000»): «+0.000» sugiere un aumento que no existe. */
const signo = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? (0).toFixed(d) : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);
/** 'M1', 'M1 y M2', 'M1, M2 y M3'. */
export const listaModulos = (n: number[]): string => {
    const m = n.map((x) => `M${x}`);
    return m.length <= 1 ? m.join('') : `${m.slice(0, -1).join(', ')} y ${m[m.length - 1]}`;
};

function frasePatron(srl: TendenciaModulo | undefined): string | null {
    const m = srl?.evolucion.media;
    if (!m || m.patron === 'insuficiente') return null;
    if (m.patron === 'sin-patron') return `Año tras año (${m.n} temporadas completas): sin patrón claro; la media de temporada del promedio SRL no sube ni baja de forma sostenida.`;
    return `Año tras año (${m.n} temporadas completas): la media de temporada del promedio SRL ha ido ${m.patron === 'sube' ? 'subiendo' : 'bajando'} (${signo(m.sen as number, 3)} por año); descripción, no causa.`;
}

export function construirResumen(d: Entrada): ResumenEjecutivo {
    const cfg = d.config;
    if (!d.mesReferencia) {
        // Sin ninguna lectura en el periodo no hay nada que resumir: nada de cifras ni de módulos "sin dato en S/D".
        return {
            titular: 'No hay datos de NDVI suficientes para este corte.', cautela: CAUTELA_TITULAR, hallazgos: [], estado: 'Sin módulos con dato.', revisar: [],
            criteriosRevision: '', accionRevisar: '', definicionSrl: definicionNdviSrl(d.basePromedio, d.modulos.length), conciliacion: [],
        };
    }
    const refTxt = d.mesReferencia ? mesLegible(d.mesReferencia) : 'S/D';
    const periodoTxt = etiquetaPeriodo(cfg);
    const tend = d.analisis.tendencias;
    const srl = tend.find((t) => t.id === 'srl') ?? (tend.length === 1 ? tend[0] : undefined);
    const porModulo = tend.filter((t) => t.id !== 'srl');
    const conDato = d.modulos.filter((m) => m.ndvi != null);
    const varios = d.modulos.length > 1;
    const rotulo = rotuloBase(d.basePromedio);

    // ── Titular real del periodo (la anomalía contra lo habitual), con su cautela pegada
    const t = titularDeAnomalias(`Periodo ${periodoTxt}`, 0, porModulo.map((x) => x.anomalia), { promedioAbs: srl?.anomalia.mediaAbs ?? null, base: d.basePromedio });
    const clasePromedio = d.promedio != null ? CLASES_NDVI.find((c) => (d.promedio as number) >= c.desde && (d.promedio as number) < c.hasta) : null;
    const titular = t
        ? `${t.texto}.`
        : d.promedio != null
            ? `En ${refTxt} el NDVI ${varios ? 'de la SRL' : 'del módulo'} fue ${fmt(d.promedio, 2)}${clasePromedio ? ` (${clasePromedio.etiqueta.toLowerCase()})`: ''}; no hay años de referencia suficientes para decir si es habitual.`
            : 'No hay datos de NDVI suficientes para este corte.';

    // ── Hallazgos con cifra (3 a 5)
    const hallazgos: string[] = [];
    if (d.promedio != null) {
        const cambio = d.tendencia != null && d.mesAnterior ? `, ${Math.abs(d.tendencia) < 0.0005 ? 'sin cambio' : signo(d.tendencia, 3)} frente a ${mesLegible(d.mesAnterior)}` : '';
        hallazgos.push(`${varios ? `NDVI de la SRL (promedio ${rotulo}, ${conDato.length} de ${d.modulos.length} módulos con dato)` : 'NDVI del módulo'} en ${refTxt}: ${fmt(d.promedio, 2)}${clasePromedio ? ` (${clasePromedio.etiqueta.toLowerCase()})` : ''}${cambio}.`);
    }
    const a = srl?.anomalia;
    if (a && a.mediaAbs != null && a.mediaValor != null && a.mediaRef != null) {
        const ref = textoReferencia(a);
        hallazgos.push(`Frente a lo habitual de los mismos meses: ${fmt(a.mediaValor, 2)} contra ${fmt(a.mediaRef, 2)} (${signo(a.mediaAbs, 3)}${a.pct != null ? `, ${signo(a.pct, 1)} %` : ''}); ${a.mesesArriba} meses por encima, ${a.mesesAbajo} por debajo y ${a.mesesSimilar} en línea de ${a.nConRef}. Lectura descriptiva, ${ref}.`);
    }
    if (varios && d.mejor && d.peor) hallazgos.push(`Mayor vigor en ${refTxt}: ${d.mejor.nombre} (${fmt(d.mejor.ndvi, 2)}); menor vigor: ${d.peor.nombre} (${fmt(d.peor.ndvi, 2)}).`);
    const c = d.analisis.contraste;
    if (c && c.promA != null && c.promB != null && c.delta != null) {
        const extremo = c.mayorDescenso ? ` Mayor descenso: ${c.mayorDescenso.nombre} (${signo(c.mayorDescenso.delta as number, 3)}).` : c.mayorAumento ? ` Mayor aumento: ${c.mayorAumento.nombre} (${signo(c.mayorAumento.delta as number, 3)}).` : '';
        hallazgos.push(`Contra el mismo periodo de ${c.anioA}: ${fmt(c.promB, 2)} contra ${fmt(c.promA, 2)}, diferencia B − A ${Math.abs(c.delta) < UMBRAL_SIN_CAMBIO ? `${signo(c.delta, 3)} (dentro de la variación normal entre años, menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)})` : signo(c.delta, 3)}.${extremo}`);
    }
    const sin = d.modulos.filter((m) => !m.tieneDatoDelMes);
    const pocos = d.modulos.filter((m) => m.pocoConfiable);
    // Un problema de calidad del dato pesa más que el patrón año a año: se coloca antes para que el recorte a 5 no lo pierda.
    if (sin.length || pocos.length) {
        hallazgos.push(`Calidad del dato: ${conDato.length} de ${d.modulos.length} módulos con dato en ${refTxt}${sin.length ? ` (sin dato: ${listaModulos(sin.map((m) => m.numero))})` : ''}${pocos.length ? `; con pocas observaciones limpias: ${listaModulos(pocos.map((m) => m.numero))}` : ''}.`);
    }
    const patron = frasePatron(srl);
    if (patron) hallazgos.push(patron);
    if (!sin.length && !pocos.length && hallazgos.length < 3 && d.modulos.length) {
        hallazgos.push(`Calidad del dato: los ${d.modulos.length} módulos tienen dato en ${refTxt} con observaciones limpias suficientes.`);
    }

    // ── Estado del distrito por clase de vigor
    const partes = d.distribucion.filter((x) => x.modulos.length).map((x) => `${x.modulos.length} de ${conDato.length} ${x.modulos.length === 1 && conDato.length === 1 ? 'módulo' : 'módulos'} en ${x.clase.etiqueta} (${x.modulos.map((n) => `M${n}`).join(', ')})`);
    const estado = partes.length ? `${refTxt}: ${partes.join('; ')}${sin.length ? `; sin dato: ${sin.map((m) => `M${m.numero}`).join(', ')}` : ''}.` : `${refTxt}: sin módulos con dato.`;

    // ── Qué revisar: criterios explícitos, agrupados; describe qué se observa, nunca por qué
    const grupos = new Map<string, { modulos: number[]; cifras: string[] }>();
    const meter = (clave: string, n: number, cifra: string) => { const g = grupos.get(clave) ?? { modulos: [], cifras: [] }; g.modulos.push(n); g.cifras.push(cifra); grupos.set(clave, g); };
    for (const m of d.modulos) {
        if (!m.tieneDatoDelMes) { meter(`Sin dato en ${refTxt}`, m.numero, ''); continue; }
        const an = tend.find((x) => x.id === m.numero)?.anomalia;
        const bajoHabitual = an?.direccion === 'abajo' && an.mediaAbs != null;
        const bajoVigor = m.ndvi != null && m.ndvi < UMBRAL_REVISION_VIGOR;
        const dif = bajoHabitual ? signo(an!.mediaAbs as number, 3) : '';
        if (bajoVigor && bajoHabitual) meter('vigor bajo y por debajo de lo habitual', m.numero, `NDVI ${fmt(m.ndvi, 2)}, ${dif}`);
        else if (bajoHabitual) meter(an!.fueraDeLoHabitual ? 'por debajo de lo habitual y más lejos de lo que varían los otros años entre sí' : 'por debajo de lo habitual', m.numero, `${dif}`);
        else if (bajoVigor) meter(an?.direccion == null ? 'vigor bajo, sin referencia suficiente para compararlo con lo habitual' : 'vigor bajo, aunque no por debajo de lo habitual de sus meses', m.numero, `NDVI ${fmt(m.ndvi, 2)}`);
    }
    const orden = ['vigor bajo y por debajo de lo habitual', 'por debajo de lo habitual y más lejos de lo que varían los otros años entre sí', 'por debajo de lo habitual'];
    const claves = [...grupos.keys()].sort((x, y) => { const ix = orden.indexOf(x), iy = orden.indexOf(y); return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy); });
    const revisar: ItemRevisar[] = claves.map((k) => {
        const g = grupos.get(k) as { modulos: number[]; cifras: string[] };
        return { modulos: g.modulos, criterio: k, cifras: g.modulos.map((n, i) => (g.cifras[i] ? `M${n}: ${g.cifras[i]}` : `M${n}`)).join(' · ') };
    });

    const criteriosRevision = `Criterios: se marca un módulo cuando su NDVI del mes queda bajo ${UMBRAL_REVISION_VIGOR.toFixed(2)} (clase «${CLASES_NDVI[1].etiqueta}» o inferior), cuando su periodo queda ${UMBRAL_SIN_CAMBIO.toFixed(2)} o más por debajo de lo habitual de otros años, o cuando no tiene dato del mes.`;
    const accionRevisar = 'Acción sugerida: contrastar con la verificación de campo del módulo (superficie sembrada, etapa del cultivo y programa de riego) y repetir la lectura con la siguiente imagen. La cifra por sí sola no indica la causa.';

    // ── Conciliación del NDVI de la SRL: mismas palabras, una fila por cifra que aparece en el documento
    const enPeriodo = d.promedioPorMes.filter((v): v is number => v != null);
    const conciliacion: FilaConciliacion[] = [];
    conciliacion.push({ etiqueta: `Mes de referencia (${refTxt})`, valor: d.promedio, nota: 'Promedio SRL de los módulos con dato de ese mes.' });
    if (d.meses.length > 1) conciliacion.push({ etiqueta: `Media del periodo (${periodoTxt})`, valor: media(d.promedioPorMes), nota: `Media de los ${enPeriodo.length} meses con dato del promedio SRL mensual.` });
    if (a && a.mediaRef != null && a.mediaValor != null) {
        if (a.nConRef < a.nPeriodo || (d.meses.length > 1 && Math.abs((a.mediaValor) - (media(d.promedioPorMes) ?? a.mediaValor)) > 0.0005)) {
            conciliacion.push({ etiqueta: 'Media del periodo en los meses comparables', valor: a.mediaValor, nota: `Solo los ${a.nConRef} meses que tienen años de referencia suficientes.` });
        }
        conciliacion.push({ etiqueta: 'Habitual (mismos meses, otros años)', valor: a.mediaRef, nota: `${textoReferencia(a)}; promedio de la referencia de cada mes.` });
        if (a.mediaAbs != null) conciliacion.push({ etiqueta: 'Diferencia contra lo habitual', valor: a.mediaAbs, nota: 'Media del periodo en los meses comparables menos lo habitual.' });
    }
    const foco = d.interanual?.picoSrlPorAnio.find((p) => p.anio === d.interanual?.anioFoco);
    if (foco && foco.pico != null) conciliacion.push({ etiqueta: `Pico medio ${foco.anio} (temporada)`, valor: foco.pico, nota: `Media del mes de mayor NDVI de cada módulo (${foco.n} de ${d.modulos.length}); no es el mayor valor del promedio mensual.` });

    return { titular, cautela: CAUTELA_TITULAR, hallazgos: hallazgos.slice(0, 5), estado, revisar, criteriosRevision, accionRevisar, definicionSrl: definicionNdviSrl(d.basePromedio, d.modulos.length), conciliacion };
}
