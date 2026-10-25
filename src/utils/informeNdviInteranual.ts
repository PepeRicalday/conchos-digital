/**
 * informeNdviInteranual — modelo PURO (sin red, sin DOM, sin HTML) de la comparación ENTRE AÑOS del informe técnico de NDVI.
 * Entra la serie v2 (ndvi_modulo_mensual_v2: SCL + mediana) y el informe anual de superficie/volumen (ACUM_INF);
 * sale lo que el informe imprime: pico y media por año y módulo, banda típica, lectura en palabras, cruce con superficie/volumen.
 * S/D = null (nunca 0): un año sin NDVI (2020) o sin informe de superficie/volumen (2025, 2026) queda S/D con aviso.
 * Los renglones atípicos de ACUM_INF se cuentan y se avisan; no se corrigen ni se ocultan.
 */
import { MODULOS_SRL_IDS, COLOR_MODULO_SRL } from './modulosSRL';
import { media } from './estadisticaBasica';
import { pesosSuperficie, promedioConBase, type BasePromedio } from './ndviPromedio';
import { MIN_ANIOS_REFERENCIA } from './informeNdviAnalisis';
import {
    MESES_TEMPORADA, MIN_MESES_ANIO_COMPLETO, anioDeMes, aniosDisponibles, climatologiaMensual, cruceAnual, lecturaAnio, resumenAnio, serieAnio,
    type ClimatologiaMes, type CruceAnio, type FilaNdviV2, type FilaSupVol, type LecturaAnio, type ResumenAnio,
} from './ndviInteranual';

export interface DatosInteranual { ndvi: FilaNdviV2[]; supVol: FilaSupVol[]; errorSupVol?: boolean }

/** Años a comparar (el último es el de interés), módulos y base del promedio SRL. */
export interface ConfigInteranual { anios: number[]; modulos: number[]; base: BasePromedio }

export interface ModuloInteranual {
    numero: number;
    nombre: string;
    color: string;
    resumenes: ResumenAnio[];
    series: { anio: number; vals: (number | null)[] }[];
    clim: ClimatologiaMes[];
    lectura: LecturaAnio;
    cruce: CruceAnio[];
}

export interface ModeloInteranual {
    anios: number[];
    base: BasePromedio;
    anioFoco: number;
    modulos: ModuloInteranual[];
    /** Pico NDVI medio de los módulos con dato por año, con la base elegida (null = ningún módulo con dato). */
    picoSrlPorAnio: { anio: number; pico: number | null; n: number }[];
    /** Pico medio SRL del año de interés menos el promedio del pico medio de los otros años (null: temporada incompleta o menos de 3 años de referencia). */
    anomaliaPicoSrl: { abs: number; n: number } | null;
    /** Media de temporada (mar–sep) de los módulos con dato por año, con la base elegida; `n` = módulos que aportan. */
    mediaSrlPorAnio: { anio: number; media: number | null; n: number }[];
    /** Años elegidos sin NDVI / sin informe de superficie y volumen (derivados de los datos, no escritos a mano). */
    aniosSinNdvi: number[];
    aniosSinSupVol: number[];
    /** NDVI medio mensual de los módulos con dato, por año (para la gráfica general). */
    serieSrl: { anio: number; vals: (number | null)[] }[];
    conteo: { arriba: number; abajo: number; similar: number; sd: number };
    mayorAlza: { modulo: number; abs: number } | null;
    mayorBaja: { modulo: number; abs: number } | null;
    avisos: string[];
}

/** Años que tienen NDVI en la serie (cualquier módulo), ascendentes; los que ofrece el modal. */
export function aniosConNdvi(ndvi: FilaNdviV2[]): number[] {
    const s = new Set<number>();
    for (const m of MODULOS_SRL_IDS) for (const a of aniosDisponibles(ndvi, m)) s.add(a);
    return [...s].sort((a, b) => a - b);
}

/** Años con informe de superficie/volumen (cualquier módulo). */
export function aniosConSupVol(supVol: FilaSupVol[]): number[] {
    return [...new Set(supVol.map((s) => s.anio))].sort((a, b) => a - b);
}

export function construirInteranual(datos: DatosInteranual, cfg: ConfigInteranual): ModeloInteranual {
    const anios = [...new Set(cfg.anios)].sort((a, b) => a - b);
    if (anios.length < 1) throw new Error('El informe interanual necesita al menos un año elegido.');
    const anioFoco = anios[anios.length - 1];
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    // Todo se calcula solo con los años elegidos: la banda y el promedio "de los otros años" son de esa selección.
    const ndvi = datos.ndvi.filter((f) => anios.includes(anioDeMes(f.mes)));
    const supVol = datos.supVol.filter((s) => anios.includes(s.anio));
    const pesos = pesosSuperficie(ndvi.map((f) => ({ numero_modulo: f.numero_modulo, mes: f.mes, superficie_ha: f.superficie_ha })));
    const promSrl = (vals: { n: number; v: number | null }[]) => promedioConBase(cfg.base, vals.map((x) => ({ valor: x.v, peso: pesos.get(x.n) ?? null })));

    const modulos: ModuloInteranual[] = ids.map((numero) => ({
        numero, nombre: `Módulo ${numero}`, color: COLOR_MODULO_SRL[numero] ?? '#64748b',
        resumenes: anios.map((a) => resumenAnio(ndvi, numero, a)),
        series: anios.map((a) => ({ anio: a, vals: serieAnio(ndvi, numero, a) })),
        clim: climatologiaMensual(ndvi, numero, anioFoco),
        lectura: lecturaAnio(ndvi, numero, anioFoco),
        cruce: anios.map((a) => cruceAnual(ndvi, supVol, numero, a)),
    }));

    const picoSrlPorAnio = anios.map((a, i) => {
        const picos = modulos.map((m) => ({ n: m.numero, v: m.resumenes[i].pico })).filter((x) => x.v != null);
        return { anio: a, pico: promSrl(picos), n: picos.length };
    });
    const mediaSrlPorAnio = anios.map((a, i) => {
        const medias = modulos.map((m) => ({ n: m.numero, v: m.resumenes[i].media })).filter((x) => x.v != null);
        return { anio: a, media: promSrl(medias), n: medias.length };
    });
    const serieSrl = anios.map((a, i) => ({ anio: a, vals: MESES_TEMPORADA.map((_, k) => promSrl(modulos.map((m) => ({ n: m.numero, v: m.series[i].vals[k] })))) }));

    const iFoco = anios.length - 1;
    const conPico = modulos.filter((m) => m.resumenes[iFoco].pico != null);
    const focoCompleto = conPico.length > 0 && conPico.every((m) => m.resumenes[iFoco].mesesConDato >= MIN_MESES_ANIO_COMPLETO);
    const picosOtros = picoSrlPorAnio.slice(0, iFoco).map((p) => p.pico).filter((v): v is number => v != null);
    const picoFoco = picoSrlPorAnio[iFoco]?.pico ?? null;
    const anomaliaPicoSrl = focoCompleto && picoFoco != null && picosOtros.length >= MIN_ANIOS_REFERENCIA ? { abs: picoFoco - (media(picosOtros) as number), n: picosOtros.length } : null;

    const conteo = { arriba: 0, abajo: 0, similar: 0, sd: 0 };
    for (const m of modulos) {
        const d = m.lectura.direccion;
        if (d === 'arriba') conteo.arriba++; else if (d === 'abajo') conteo.abajo++; else if (d === 'similar') conteo.similar++; else conteo.sd++;
    }
    const conAn = modulos.filter((m) => m.lectura.anomalia).map((m) => ({ modulo: m.numero, abs: (m.lectura.anomalia as { abs: number }).abs }));
    const ordenados = [...conAn].sort((a, b) => b.abs - a.abs);

    const avisos: string[] = [];
    const sinNdvi = anios.filter((a) => !modulos.some((m) => m.resumenes[anios.indexOf(a)].pico != null));
    for (const a of sinNdvi) avisos.push(`${a} no tiene NDVI (la serie de satélite inicia en marzo de 2021): aparece como S/D.`);
    const sinSup = anios.filter((a) => !supVol.some((s) => s.anio === a && ids.includes(s.numero_modulo)));
    const aniosSinSupVol = datos.errorSupVol ? [...anios] : sinSup;
    if (datos.errorSupVol) avisos.push('No se pudo consultar el informe de superficie y volumen: esa sección aparece como S/D.');
    else if (sinSup.length) avisos.push(`Sin informe de superficie y volumen para ${sinSup.join(', ')}: aparece como S/D, no como cero.`);
    const atip = modulos.reduce((n, m) => n + m.cruce.reduce((s, c) => s + c.atipicos, 0), 0);
    if (atip > 0) avisos.push(`${atip} ${atip === 1 ? 'renglón del informe de superficie y volumen tiene' : 'renglones del informe de superficie y volumen tienen'} captura atípica en la fuente: se suman tal cual y se marcan con ⚠.`);
    for (const m of modulos) {
        for (const r of m.resumenes) if (r.pocoConfiables.length) avisos.push(`${m.nombre}, ${r.anio}: pocas observaciones limpias en ${r.pocoConfiables.join(', ')}.`);
    }
    if (anios.length === 2) avisos.push('Con solo dos años no hay banda típica (se necesitan al menos tres): la comparación es directa, año contra año.');
    if (modulos.length && modulos.every((m) => m.resumenes.every((r) => r.mesesConDato === 0))) avisos.push('Ninguno de los años elegidos tiene lecturas de NDVI.');

    return {
        anios, base: cfg.base, anioFoco, anomaliaPicoSrl, modulos, picoSrlPorAnio, mediaSrlPorAnio, aniosSinNdvi: sinNdvi, aniosSinSupVol, serieSrl, conteo,
        mayorAlza: ordenados.length && ordenados[0].abs > 0 ? ordenados[0] : null,
        mayorBaja: ordenados.length && ordenados[ordenados.length - 1].abs < 0 ? ordenados[ordenados.length - 1] : null,
        avisos,
    };
}
