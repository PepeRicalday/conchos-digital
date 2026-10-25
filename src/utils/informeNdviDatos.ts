/**
 * informeNdviDatos — modelo de datos PURO del informe técnico integrado de NDVI (sin red, sin DOM, sin HTML).
 * Entra la serie mensual v2 (ndvi_modulo_mensual_v2: mediana con máscara de nubes SCL; `ndvi_medio` de la fila = esa mediana), el contexto ya cargado (volumen,
 * superficie/volumen anual, contornos, logos, errores de consulta) y la configuración de alcance; sale un objeto con todo lo que el informe necesita.
 * S/D = null (nunca 0); un módulo SIN fila del mes de referencia queda S/D con aviso: jamás se rellena con el dato de un
 * mes anterior. Los cambios (Δ, tendencia) se calculan contra el mes inmediato anterior de TODA la serie, no solo del periodo.
 * La base del promedio (simple/ponderado) que elige el usuario se aplica a TODO promedio SRL del documento.
 */
import { calcICV, calcIHR, calcIEHP, NDVI_PISO, NDVI_TECHO, NDVI_UMBRAL_ACTIVO } from './indicesSrl';
import { MODULOS_SRL_IDS, COLOR_MODULO_SRL } from './modulosSRL';
import { claseNdvi, CLASES_NDVI, type ClaseNdvi } from './ndviRampa';
import { folioConPartes, hashCorto, mesLegible, nombreArchivoConPartes, ultimoDiaIncluido } from './informeBase';
import { media } from './estadisticaBasica';
import { esMesConfiable, type FilaSupVol } from './ndviInteranual';
import { METODO_NDVI_V2, mesAnteriorCalendario, mesesContinuos } from './ndviSerie';
import { promedioConBase, promedioPonderado, type BasePromedio } from './ndviPromedio';
import {
    aniosDeFilas, aniosDeReferencia, codigoAlcance, codigoPeriodo, configPorDefecto, filtrarFilas, huellaConfig, mesesDisponibles, type ConfigInformeNdvi,
} from './informeNdviConfig';
import { aFilasV2, construirAnalisis, type AnalisisIntegrado } from './informeNdviAnalisis';
import { construirInteranual, type ModeloInteranual } from './informeNdviInteranual';
import { construirResumen, type ResumenEjecutivo } from './informeNdviResumen';

export { promedioPonderado } from './ndviPromedio';

/** Versión de la plantilla del documento (se imprime en la trazabilidad; súbela cuando cambie la estructura). */
export const VERSION_PLANTILLA_NDVI = 'ndvi-integrado-1';

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
    /** Calidad del mes (serie v2): pasos de satélite limpios y fracción de píxeles válidos. Opcionales: sin ellos no se marca baja confianza. */
    n_escenas?: number | null;
    pct_pixeles_validos?: number | null;
}

/** Una consulta que falló al armar el informe: se imprime en la calidad del dato y en la trazabilidad, nunca se traga. */
export interface ErrorConsulta { fuente: string; mensaje: string; consecuencia: string }

export interface ContextoInforme {
    /** Volumen entregado acumulado del ciclo por módulo (hm³). Vacío = no disponible. */
    volumenPorModulo: Map<number, number>;
    volumenMesParcial: boolean;
    /** Falló la consulta de volumen (distinto de "no hay volumen cargado"). */
    volumenConError?: boolean;
    /** ¿Se consultó el volumen? (solo si algún indicador impreso lo usa). Sin consulta no se avisa de volumen faltante. */
    volumenSolicitado?: boolean;
    /** Superficie y volumen anual (ACUM_INF); solo se consulta si el anexo lo pide. */
    supVol?: FilaSupVol[];
    errorSupVol?: boolean;
    /** Consultas fallidas (volumen, superficie/volumen anual…). */
    erroresConsulta?: ErrorConsulta[];
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
    /** Superficie del polígono del módulo (ha); NO es la superficie regada del informe ACUM_INF. */
    superficieHa: number | null;
    clase: ClaseNdvi | null;
    icv: number | null;
    icvEtiqueta: string;
    ihr: number | null;
    /** IHR = 0 es el piso del índice (con NDVI bajo la desviación iguala o supera a la mediana), no riego heterogéneo. */
    ihrEnPiso: boolean;
    iehp: number | null;
    /** El mes de referencia del módulo tiene pocos pasos de satélite limpios o pocos píxeles válidos. */
    pocoConfiable: boolean;
    /** Pasos de satélite limpios y fracción 0–1 de píxeles válidos del mes de referencia (null = S/D); van en el pie del plano. */
    nEscenas: number | null;
    pctValidos: number | null;
    /** Series alineadas a `meses` (null = sin fila ese mes). */
    serieNdvi: (number | null)[];
    serieIcv: (number | null)[];
    serieIhr: (number | null)[];
}

export interface Trazabilidad {
    folio: string;
    /** Hash corto de la configuración (periodo, módulos, años, base, secciones…): misma configuración, mismo hash. */
    hashConfig: string;
    metodo: string;
    plantilla: string;
    /** 'AAAA-MM-DD' del último día cubierto por los datos del mes de referencia ("datos al"); null si la fila no trae ventana. */
    corteDatos: string | null;
    alcance: 'RESUMEN' | 'COMPLETO' | 'PARCIAL';
    periodoCodigo: string;
    nombreArchivo: string;
    /** El mes de referencia es el mes en curso: su cifra puede estar incompleta. */
    mesEnCurso: boolean;
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
    /** Ponderado por la superficie del polígono. */
    promedioPonderado: number | null;
    promedioIcv: number | null;
    /** Promedio del IHR SIN los módulos en el piso del índice (se cuentan aparte en `nIhrEnPiso`). */
    promedioIhr: number | null;
    nIhrEnPiso: number;
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
    erroresConsulta: ErrorConsulta[];
    /** La serie cargada abarca más de un año calendario (si no, las comparaciones son dentro de un solo ciclo). */
    variosAnios: boolean;
    /** Tendencia, contraste y comparaciones entre módulos (siempre se calcula la tendencia: alimenta el resumen ejecutivo). */
    analisis: AnalisisIntegrado;
    /** Comparación entre años (≥ 2 años de referencia); null si no hay con qué comparar. */
    interanual: ModeloInteranual | null;
    /** Titular, hallazgos, qué revisar y conciliación de cifras de la hoja 1. */
    resumen: ResumenEjecutivo;
    traza: Trazabilidad;
    /** Parámetros reales del cálculo (se imprimen en la metodología: no se escriben a mano). */
    parametros: { ndviPiso: number; ndviTecho: number; umbralActivo: number };
}

const mesDe = (m: string) => (m ?? '').slice(0, 7);

export const promedioSimple = media;

export function construirDatosNdvi(filas: FilaNdviInforme[], ctx: ContextoInforme, config?: ConfigInformeNdvi): InformeNdvi {
    const todosMeses = mesesDisponibles(filas);
    const cfg = config ?? configPorDefecto(todosMeses);
    const filasPeriodo = filtrarFilas(filas, cfg);
    // Eje mensual CONTINUO del primer al último mes con dato del periodo: un mes sin fila queda como hueco (S/D), no se comprime.
    const mesesConDato = mesesDisponibles(filasPeriodo);
    const meses = mesesConDato.length ? mesesContinuos(mesesConDato[0], mesesConDato[mesesConDato.length - 1]) : [];
    const mesReferencia = meses[meses.length - 1] ?? null;
    // Mes calendario inmediato anterior (si no tiene filas, el cambio queda S/D: no se salta a un mes más lejano).
    const prev = mesReferencia ? mesAnteriorCalendario(mesReferencia) : null;
    const mesAnterior = prev && todosMeses.includes(prev) ? prev : null;
    const idsModulos = MODULOS_SRL_IDS.filter((n) => cfg.modulos.includes(n));

    // El índice usa TODAS las filas (el mes anterior puede caer fuera del periodo); el periodo solo acota las series.
    const porModuloMes = new Map<string, FilaNdviInforme>();
    for (const f of filas) porModuloMes.set(`${f.numero_modulo}|${mesDe(f.mes)}`, f);
    const filaDe = (m: number, mes: string | null) => (mes ? porModuloMes.get(`${m}|${mes}`) : undefined);

    const promMes = (mes: string | null): number | null => {
        if (!mes) return null;
        return promedioConBase(cfg.basePromedio, idsModulos.map((n) => { const x = filaDe(n, mes); return { valor: x?.ndvi_medio ?? null, peso: x?.superficie_ha ?? null }; }));
    };

    const avisos: AvisoInforme[] = [];
    const refTxt = mesReferencia ? mesLegible(mesReferencia) : 'S/D';
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
        const ihr = calcIHR(entrada).valor;
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
            ihr, ihrEnPiso: ihr === 0,
            iehp: iehp.valor,
            pocoConfiable: !!f && !esMesConfiable({ n_escenas: f.n_escenas ?? null, pct_pixeles_validos: f.pct_pixeles_validos ?? null }),
            nEscenas: f?.n_escenas ?? null, pctValidos: f?.pct_pixeles_validos ?? null,
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
    const corteDatos = ultimoDiaIncluido(hasta);
    const hoyMes = `${ctx.ahora.getFullYear()}-${String(ctx.ahora.getMonth() + 1).padStart(2, '0')}`;
    const mesEnCurso = !!mesReferencia && mesReferencia >= hoyMes;

    if (!mesReferencia) avisos.push({ nivel: 'warn', texto: 'No hay datos de NDVI en el periodo y los módulos elegidos: el informe no puede mostrar cifras.' });
    for (const m of sinDato) {
        if (mesReferencia) avisos.push({ nivel: 'warn', texto: `El ${m.nombre} no tiene dato de NDVI en ${refTxt}: se muestra S/D (no se usa un mes anterior).` });
    }
    const poco = modulos.filter((m) => m.pocoConfiable);
    if (poco.length) avisos.push({ nivel: 'info', texto: `${poco.map((m) => `M${m.numero}`).join(', ')}: pocas observaciones limpias del satélite en ${refTxt}; la cifra se muestra, pero con menos respaldo.` });
    if (mesEnCurso) avisos.push({ nivel: 'warn', texto: `${refTxt} es el mes en curso: su cifra puede estar incompleta y cambiar al cerrar el mes.` });
    if (!ctx.logoSrlOk) avisos.push({ nivel: 'info', texto: 'No se pudo cargar el logotipo institucional al generar el informe.' });
    if (!ctx.contornosDisponibles) avisos.push({ nivel: 'warn', texto: 'No se pudieron cargar los contornos de los módulos: el plano general no se dibujó.' });
    const errores = ctx.erroresConsulta ?? [];
    for (const e of errores) avisos.push({ nivel: 'warn', texto: `No se pudo consultar ${e.fuente}${e.mensaje ? ` (${e.mensaje})` : ''}: ${e.consecuencia}` });
    if (ctx.volumenConError && !errores.some((e) => /volumen/i.test(e.fuente))) avisos.push({ nivel: 'warn', texto: 'No se pudo consultar el volumen entregado: el IEHP aparece como S/D.' });
    else if (ctx.volumenSolicitado !== false && !ctx.volumenConError && ctx.volumenPorModulo.size === 0 && mesReferencia && cfg.indicadores.includes('iehp')) avisos.push({ nivel: 'info', texto: 'No hay volumen entregado cargado para el ciclo: el IEHP aparece como S/D.' });
    if (ctx.volumenMesParcial) avisos.push({ nivel: 'warn', texto: `El volumen del mes de referencia (${refTxt}) es parcial: el IEHP de este corte no es comparable con meses completos.` });

    const aniosRef = aniosDeReferencia(cfg, aniosDeFilas(filas));
    const interanual = aniosRef.length >= 2
        ? construirInteranual({ ndvi: aFilasV2(filas), supVol: ctx.supVol ?? [], errorSupVol: !!ctx.errorSupVol }, { anios: aniosRef, modulos: idsModulos, base: cfg.basePromedio })
        : null;
    const analisis = construirAnalisis(filas, cfg, meses);

    const ahora = ctx.ahora;
    const alcance = codigoAlcance(cfg);
    const periodoCodigo = codigoPeriodo(cfg);
    const hashConfig = hashCorto(huellaConfig(cfg));
    // Variante = 6 primeros caracteres del hash de configuración: dos informes del mismo periodo y alcance pero con otra configuración
    // (con/sin imagen satelital, con/sin relieve, otros indicadores…) generados el mismo minuto NO comparten folio ni nombre de archivo;
    // la misma configuración sí (el hash no depende de la hora ni de los datos).
    const variante = hashConfig.slice(0, 6);
    const traza: Trazabilidad = {
        folio: folioConPartes('NDVI', [periodoCodigo, alcance, variante], ahora),
        hashConfig,
        metodo: METODO_NDVI_V2, plantilla: VERSION_PLANTILLA_NDVI, corteDatos, alcance, periodoCodigo,
        nombreArchivo: nombreArchivoConPartes('informe-ndvi-conchos', [periodoCodigo, alcance, variante], ahora),
        mesEnCurso,
    };

    const base: Omit<InformeNdvi, 'resumen'> = {
        folio: traza.folio,
        emitidoEn: ahora,
        emisor: ctx.emisor?.trim() || 'SICA 005',
        version: ctx.version,
        config: cfg,
        meses, mesReferencia, mesAnterior, modulos,
        basePromedio: cfg.basePromedio,
        promedio: promActual,
        promedioSimple: promSimple,
        promedioPonderado: promPond,
        promedioIcv: promedioSimple(modulos.map((m) => m.icv)),
        // Un IHR de 0 es el piso del índice: no entra al promedio (promediarlo arrastra la cifra sin medir homogeneidad).
        promedioIhr: promedioSimple(modulos.filter((m) => !m.ihrEnPiso).map((m) => m.ihr)),
        nIhrEnPiso: modulos.filter((m) => m.ihrEnPiso).length,
        mejor: ordenados[0] ?? null,
        peor: ordenados.length > 1 ? ordenados[ordenados.length - 1] : null,
        tendencia: promActual != null && promAnterior != null ? promActual - promAnterior : null,
        distribucion,
        promedioPorMes: meses.map((mes) => promMes(mes)),
        ventana: { desde, hasta },
        nubosidadMaxPct: nub.length ? Math.max(...nub) : null,
        volumenMesParcial: ctx.volumenMesParcial,
        avisos, erroresConsulta: errores,
        variosAnios: aniosDeFilas(filas).length > 1,
        analisis, interanual, traza,
        parametros: { ndviPiso: NDVI_PISO, ndviTecho: NDVI_TECHO, umbralActivo: NDVI_UMBRAL_ACTIVO },
    };
    return { ...base, resumen: construirResumen(base) };
}

