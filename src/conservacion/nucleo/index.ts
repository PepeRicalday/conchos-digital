/**
 * Núcleo de SICA Conservación: comprobador técnico de programas de conservación (PacOT).
 * TypeScript puro y determinista. Única entrada pública del módulo.
 * Especificación: Conservacion/Skill/diseno/Matriz_Norma_Regla_Prueba.{md,json}.
 */
export { ejecutar, REGLAS_PRIMER_CORTE, REGLAS_CORTE_1B, REGLAS_CORTE_2, REGLAS_CORTE_3, REGLAS_CORTE_4, REGLAS_CORTE_5, REGLAS_IMPLEMENTADAS, TOTAL_REGLAS_MATRIZ, VERSION_MOTOR } from './motor/ejecutar'
export type { EntradaEjecucion, InformeEjecucion } from './motor/ejecutar'
export { normalizarDataJson } from './libro/normalizar'
export { VistaLibro } from './libro/vista'
export { PERFIL_PACOT_2026_27 } from './libro/perfil'
export type { PerfilFormato } from './libro/perfil'
export { resolverParametros, declararParametros, PARAMETROS_POR_DEFECTO } from './parametros/catalogo'
export type { Parametros, DeclaracionParametro } from './parametros/catalogo'
export type { Hallazgo, Resultado, Regla, Severidad, OrigenHallazgo } from './tipos/regla'
export type { LibroNormalizado } from './tipos/libro'
export { calcularHorasEfectivas, calcularNm, maquinasPorUmbral } from './reglas/maq'
export { analizarFilaFrecuencia } from './reglas/dyp'
export { balanceTipo } from './reglas/balance'
export { referenciasDeFormula, esSumaOResta } from './reglas/unidades'
export { terminosDeFormula, clasificarFormulaTotal, compararConjuntos } from './reglas/presupuesto'
export { cadenaPU, jornalCuadrilla } from './reglas/precios'
export type { ApuDeclarado } from './reglas/precios'
export { avancePorcentual, clasificarIndice, indiceSobreDnmacn } from './reglas/seguimiento'
export type { FilaAvance } from './reglas/seguimiento'
export { parsearPK } from './num/pk'
export { dec, aCadena } from './num/decimal'
