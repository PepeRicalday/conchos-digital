/**
 * informeNdviDatos — modelo de datos PURO del informe institucional de NDVI (sin red, sin DOM, sin HTML).
 * Entra la serie mensual de ndvi_modulo_historico, el contexto ya cargado (volumen, contornos, logos) y, opcionalmente, la
 * configuración de filtros (periodo, módulos, base del promedio…); sale un objeto con todo lo que el informe necesita.
 * S/D = null (nunca 0); un módulo SIN fila del mes de referencia queda S/D con aviso: jamás se rellena con el dato de un
 * mes anterior. Los cambios (Δ, tendencia) se calculan contra el mes inmediato anterior de TODA la serie, no solo del periodo.
 */
import { calcICV, calcIHR, calcIEHP, NDVI_PISO, NDVI_TECHO, NDVI_UMBRAL_ACTIVO } from './indicesSrl';
import { MODULOS_SRL_IDS, COLOR_MODULO_SRL } from './modulosSRL';
import { claseNdvi, CLASES_NDVI, type ClaseNdvi } from './ndviRampa';
import { folioInforme } from './informeBase';
import { configPorDefecto, filtrarFilas, mesesDisponibles, type BasePromedio, type ConfigInformeNdvi } from './informeNdviConfig';
import { construirAnalisis, type ResultadoAnalisis } from './informeNdviAnalisis';

export interface FilaNdviInforme {
    numero_modulo: number;
    nombre_modulo: string;
    /** 'AAAA-MM' (o 'AAAA-MM-DD'): se usa solo el mes. */
    mes: string;
    ndvi_medio: number;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    delta_ndvi: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    ventana_desde?: string | null;
    ventana_hasta?: string | null;
    nubosidad_max_pct?: number | null;
}

export interface ContextoInforme {
    /** Volumen entregado acumulado del ciclo por módulo (hm³). Vacío = no disponible. */
    volumenPorModulo: Map<number, number>;
    volumenMesParcial: boolean;
    /** Falló la consulta de volumen (distinto de "no hay volumen cargado"). */
    volumenConError?: boolean;
    /** ¿Hay contornos reales para dibujar el plano? */
    contornosDisponibles: boolean;
    logoSrlOk: boolean;
    ahora: Date;
    emisor: string | null;
    version: string;
}

export interface AvisoInforme { nivel: 'warn' | 'info'; texto: string }

export interface ModuloInforme {
    numero: number;
    nombre: string;
    color: string;
    /** false = no hay fila del mes de referencia para este módulo → todo S/D. */
    tieneDatoDelMes: boolean;
    ndvi: number | null;
    /** Cambio contra el mes anterior de la serie completa (recalculado, no la columna guardada). */
    delta: number | null;
    kc: number | null;
    superficieHa: number | null;
    clase: ClaseNdvi | null;
    icv: number | null;
    icvEtiqueta: string;
    ihr: number | null;
    iehp: number | null;
    /** Series alineadas a `meses` (null = sin fila ese mes). */
    serieNdvi: (number | null)[];
    serieIcv: (number | null)[];
    serieIhr: (number | null)[];
}

export interface InformeNdvi {
    folio: string;
    emitidoEn: Date;
    emisor: string;
    version: string;
    config: ConfigInformeNdvi;
    /** Meses del periodo elegido. */
    meses: string[];
    mesReferencia: string | null;
    /** Mes inmediato anterior al de referencia en toda la serie (puede quedar fuera del periodo). */
    mesAnterior: string | null;
    modulos: ModuloInforme[];
    basePromedio: BasePromedio;
    /** Promedio según la base elegida (la cifra principal del informe). */
    promedio: number | null;
    promedioSimple: number | null;
    /** Ponderado por superficie_ha. */
    promedioPonderado: number | null;
    promedioIcv: number | null;
    promedioIhr: number | null;
    mejor: ModuloInforme | null;
    peor: ModuloInforme | null;
    /** Promedio (base elegida) del mes de referencia menos el del mes anterior; null si falta alguno. */
    tendencia: number | null;
    distribucion: { clase: ClaseNdvi; modulos: number[] }[];
    /** Promedio (base elegida) por mes del periodo. */
    promedioPorMes: (number | null)[];
    ventana: { desde: string | null; hasta: string | null };
    nubosidadMaxPct: number | null;
    volumenMesParcial: boolean;
    avisos: AvisoInforme[];
    /** Tendencia o comparación según el modo elegido (null en modo resumen). */
    analisis: ResultadoAnalisis | null;
    /** Parámetros reales del cálculo (se imprimen en la metodología: no se escriben a mano). */
    parametros: { ndviPiso: number; ndviTecho: number; umbralActivo: number };
}

const mesDe = (m: string) => (m ?? '').slice(0, 7);

export function promedioSimple(valores: (number | null | undefined)[]): number | null {
    const v = valores.filter((x): x is number => x != null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Promedio ponderado por superficie; ignora módulos sin valor o sin superficie. */
export function promedioPonderado(pares: { valor: number | null; peso: number | null }[]): number | null {
    let num = 0, den = 0;
    for (const p of pares) {
        if (p.valor == null || p.peso == null || !(p.peso > 0)) continue;
        num += p.valor * p.peso; den += p.peso;
    }
    return den > 0 ? num / den : null;
}

export function construirDatosNdvi(filas: FilaNdviInforme[], ctx: ContextoInforme, config?: ConfigInformeNdvi): InformeNdvi {
    const todosMeses = mesesDisponibles(filas);
    const cfg = config ?? configPorDefecto(todosMeses);
    const filasPeriodo = filtrarFilas(filas, cfg);
    const meses = mesesDisponibles(filasPeriodo);
    const mesReferencia = meses[meses.length - 1] ?? null;
    const idxRef = mesReferencia ? todosMeses.indexOf(mesReferencia) : -1;
    const mesAnterior = idxRef > 0 ? todosMeses[idxRef - 1] : null;
    const idsModulos = MODULOS_SRL_IDS.filter((n) => cfg.modulos.includes(n));

    // El índice usa TODAS las filas (el mes anterior puede caer fuera del periodo); el periodo solo acota las series.
    const porModuloMes = new Map<string, FilaNdviInforme>();
    for (const f of filas) porModuloMes.set(`${f.numero_modulo}|${mesDe(f.mes)}`, f);
    const filaDe = (m: number, mes: string | null) => (mes ? porModuloMes.get(`${m}|${mes}`) : undefined);

    const promMes = (mes: string | null): number | null => {
        if (!mes) return null;
        const f = idsModulos.map((n) => filaDe(n, mes));
        return cfg.basePromedio === 'ponderado'
            ? promedioPonderado(f.map((x) => ({ valor: x?.ndvi_medio ?? null, peso: x?.superficie_ha ?? null })))
            : promedioSimple(f.map((x) => x?.ndvi_medio ?? null));
    };

    const avisos: AvisoInforme[] = [];
    const modulos: ModuloInforme[] = idsModulos.map((numero) => {
        const f = filaDe(numero, mesReferencia);
        const previa = filaDe(numero, mesAnterior);
        const nombre = f?.nombre_modulo ?? `Módulo ${numero}`;
        const entrada = {
            numeroModulo: numero, nombreModulo: nombre,
            ndviMedio: f?.ndvi_medio ?? null, ndviDesv: f?.ndvi_desv ?? null,
            fraccionCoberturaActiva: f?.fraccion_cobertura_activa ?? null, superficieHa: f?.superficie_ha ?? null,
            volumenAcumuladoHm3: ctx.volumenPorModulo.get(numero) ?? null,
        };
        const icv = calcICV(entrada);
        const iehp = calcIEHP(entrada);
        const serie = (fn: (x: FilaNdviInforme) => number | null) =>
            meses.map((mes) => { const g = filaDe(numero, mes); return g ? fn(g) : null; });
        const desdeFila = (g: FilaNdviInforme) => ({
            numeroModulo: g.numero_modulo, nombreModulo: g.nombre_modulo, ndviMedio: g.ndvi_medio, ndviDesv: g.ndvi_desv,
            fraccionCoberturaActiva: g.fraccion_cobertura_activa, superficieHa: g.superficie_ha, volumenAcumuladoHm3: null,
        });
        return {
            numero, nombre, color: COLOR_MODULO_SRL[numero] ?? '#64748b',
            tieneDatoDelMes: !!f,
            ndvi: f?.ndvi_medio ?? null,
            delta: f && previa ? f.ndvi_medio - previa.ndvi_medio : null,
            kc: f?.kc_estimado ?? null,
            superficieHa: f?.superficie_ha ?? null,
            clase: claseNdvi(f?.ndvi_medio ?? null),
            icv: icv.valor, icvEtiqueta: icv.etiqueta,
            ihr: calcIHR(entrada).valor,
            iehp: iehp.valor,
            serieNdvi: serie((g) => g.ndvi_medio),
            serieIcv: serie((g) => calcICV(desdeFila(g)).valor),
            serieIhr: serie((g) => calcIHR(desdeFila(g)).valor),
        };
    });

    const conDato = modulos.filter((m) => m.ndvi != null);
    const sinDato = modulos.filter((m) => !m.tieneDatoDelMes);
    const ordenados = [...conDato].sort((a, b) => (b.ndvi as number) - (a.ndvi as number));

    const promSimple = promedioSimple(modulos.map((m) => m.ndvi));
    const promPond = promedioPonderado(modulos.map((m) => ({ valor: m.ndvi, peso: m.superficieHa })));
    const promActual = cfg.basePromedio === 'ponderado' ? promPond : promSimple;
    const promAnterior = promMes(mesAnterior);

    // Distribución por clase (solo módulos con dato; S/D no pertenece a ninguna clase).
    const distribucion = CLASES_NDVI.map((clase) => ({ clase, modulos: conDato.filter((m) => m.clase?.clave === clase.clave).map((m) => m.numero) }));

    // Calidad del dato del mes de referencia.
    const filasRef = idsModulos.map((n) => filaDe(n, mesReferencia)).filter((f): f is FilaNdviInforme => !!f);
    const nub = filasRef.map((f) => f.nubosidad_max_pct).filter((x): x is number => x != null);
    const desde = filasRef.map((f) => f.ventana_desde).filter((x): x is string => !!x).sort()[0] ?? null;
    const hasta = filasRef.map((f) => f.ventana_hasta).filter((x): x is string => !!x).sort().slice(-1)[0] ?? null;

    if (!mesReferencia) avisos.push({ nivel: 'warn', texto: 'No hay datos de NDVI en el periodo y los módulos elegidos: el informe no puede mostrar cifras.' });
    for (const m of sinDato) {
        if (mesReferencia) avisos.push({ nivel: 'warn', texto: `El ${m.nombre} no tiene dato de NDVI en ${mesReferencia}: se muestra S/D (no se usa un mes anterior).` });
    }
    if (!ctx.logoSrlOk) avisos.push({ nivel: 'info', texto: 'No se pudo cargar el logotipo institucional al generar el informe.' });
    if (!ctx.contornosDisponibles) avisos.push({ nivel: 'warn', texto: 'No se pudieron cargar los contornos de los módulos: el plano general no se dibujó.' });
    if (ctx.volumenConError) avisos.push({ nivel: 'warn', texto: 'No se pudo consultar el volumen entregado: el IEHP aparece como S/D.' });
    else if (ctx.volumenPorModulo.size === 0 && mesReferencia) avisos.push({ nivel: 'info', texto: 'No hay volumen entregado cargado para el ciclo: el IEHP aparece como S/D.' });
    if (ctx.volumenMesParcial) avisos.push({ nivel: 'warn', texto: `El volumen del mes de referencia (${mesReferencia}) es parcial: el IEHP de este corte no es comparable con meses completos.` });

    return {
        folio: folioInforme('NDVI', ctx.ahora),
        emitidoEn: ctx.ahora,
        emisor: ctx.emisor?.trim() || 'SICA 005',
        version: ctx.version,
        config: cfg,
        meses, mesReferencia, mesAnterior, modulos,
        basePromedio: cfg.basePromedio,
        promedio: promActual,
        promedioSimple: promSimple,
        promedioPonderado: promPond,
        promedioIcv: promedioSimple(modulos.map((m) => m.icv)),
        promedioIhr: promedioSimple(modulos.map((m) => m.ihr)),
        mejor: ordenados[0] ?? null,
        peor: ordenados.length > 1 ? ordenados[ordenados.length - 1] : null,
        tendencia: promActual != null && promAnterior != null ? promActual - promAnterior : null,
        distribucion,
        promedioPorMes: meses.map((mes) => promMes(mes)),
        ventana: { desde, hasta },
        nubosidadMaxPct: nub.length ? Math.max(...nub) : null,
        volumenMesParcial: ctx.volumenMesParcial,
        avisos,
        analisis: construirAnalisis(filas, cfg, meses),
        parametros: { ndviPiso: NDVI_PISO, ndviTecho: NDVI_TECHO, umbralActivo: NDVI_UMBRAL_ACTIVO },
    };
}
