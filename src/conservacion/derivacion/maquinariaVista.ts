/**
 * Balance de maquinaria como vista pura (sin React): concilia, por tipo de máquina, lo que el libro dice necesitar (B Maq, renglones),
 * lo que declara en su balance (B Maq, tabla) y lo que inventaría (IM01); y concilia cada concepto contra la necesidad de 3DN.
 * Nada se corrige: cada diferencia sale con la cifra del libro, la de referencia y la base del juicio. «Atípico» es candidato a
 * revisión; «no cuadra» es una contradicción aritmética del propio libro. Ninguna etiqueta dice «correcto».
 * Las cifras ausentes son S/D (null), nunca cero; solo las celdas de conteo en blanco del balance se leen como 0 para derivar
 * faltante y sobrante, igual que MAQ-006. Una celda con texto donde va un número no se interpreta: esa fila no se compara.
 */
import { dec } from '../nucleo/num/decimal'
import { balanceTipo } from '../nucleo/reglas/balance'
import { calcularHorasEfectivas } from '../nucleo/reglas/maq'
import { quitaAcentos } from './vistas'
import type { BaseJuicio } from '../verificacion/tipos'
import type { EstadoCanonico } from '../vocabulario'
import type { BloqueMaquinaria, Cifra, FilaBalanceMaquinaria, LibroDerivado, MaquinariaLibro, RenglonMaquinaria, UnidadMaquinaria } from './tipos'
import { TIPOS_MAQUINA } from './maquinaria'

/** Manual de Conservación 2026 §6.3 paso 10 (p. 73): se justifica adquirir cuando la fracción de máquina supera 0.5 (1.56 → 2; 1.46 → 1). */
export const UMBRAL_ADQUISICION = 0.5
/**
 * Referencia del Manual §6.3 paso 5, nota (p. 72): 1,400 h en conservación normal. El Anexo 5 §3.1 paso 5 (nota) fija 1,200 y el Manual §6.3.2
 * lo usa en su ejemplo (p. 76): es una discrepancia entre fuentes, el Manual prevalece. El comprobador lee las horas que declara cada renglón.
 */
export const HORAS_DISPONIBLES = 1400
/** Primera versión del extractor que lee el balance de maquinaria: un libro anterior no trae el campo. */
export const EXTRACTOR_CON_MAQUINARIA = 9
const TOL_CIFRA = 0.0051
const TOL_REL_CONCEPTO = 0.005

const F_BALANCE = 'Manual 2026 §6.3 (pp. 72-74): procedimiento y formato 4 del balance'
const F_EXISTENTES = 'Manual 2026 §6.3 paso 7 (p. 72) · Anexo 5 §3.1 paso 7: las existentes salen del inventario IM-01'
const F_ESTADOS = 'Manual 2026 §6.3 paso 9 (p. 73) · Anexo 5 §3.1 paso 9 · Anexo 4 IM-01 cols. 18-21: estado mecánico de cada máquina'
const F_IM01 = 'Anexo 4 formato IM-01: col. 2 (número económico), col. 22 (horas trabajadas) · Manual §4.3.1'
const F_IMPLEMENTO = 'Anexo 4 IM-01 col. 11 (implementos de la unidad básica) · criterio del comprobador (maquinaria-precios.md)'
const F_HM = 'Manual 2026 §6.3 paso 4 (p. 72) y §6.3.2 (p. 75): Hm = Vo/Rm · Anexo 4 §3'
const F_NM = 'Manual 2026 §6.3 paso 5 (p. 72): Nm = HE necesarias ÷ HE disponibles (§6.3.2, p. 75, la escribe He/(Ht·Eo))'
const F_3DN = 'Manual 2026 §6.3 paso 1 (p. 72) y Anexo 5 §3.1 paso 1: las cantidades anuales salen del DNMACN. La norma no fija cómo se reparte un concepto entre varias máquinas (criterio MAQ-013 del comprobador)'

/**
 * Filas que trae impreso el formato 4 (Manual p. 74). Se leen «Equipo de nivelación de tierras» como «Tractor agrícola con equipo de nivelación» y
 * «Equipo de transporte de maquinaria» como «Tractor camión 5a rueda con cama baja»: equivalencias del comprobador, no escritas en la norma.
 */
const TIPOS_FORMATO_4: ReadonlySet<string> = new Set([
  'Excavadoras', 'Draga', 'Retroexcavadora/cargadora', 'Tractor sobre oruga', 'Motoconformadora', 'Tractor agrícola con equipo ligero',
  'Tractor agrícola con equipo de nivelación', 'Camión volteo', 'Tractor camión 5a rueda con cama baja',
])

export type CodigoHallazgo =
  | 'nm_vs_renglones' | 'tipo_sin_fila' | 'existentes_vs_inventario' | 'estados_vs_inventario' | 'condicion_no_suma' | 'faltante_sobrante'
  | 'adquisicion_suma' | 'total_columna' | 'horas_renglon' | 'nm_renglon' | 'concepto_vs_3dn'
  | 'inv_lectura' | 'inv_sin_horas' | 'inv_sin_economico' | 'inv_accesorio' | 'inv_tipo' | 'inv_estado'

export type EstadoHallazgo = Extract<EstadoCanonico, 'discrepa' | 'atipico' | 'informativo'>

export interface HallazgoMaq {
  readonly id: string
  readonly codigo: CodigoHallazgo
  /** Tipo de máquina canónico al que se refiere; null si es del conjunto (totales) o de un concepto. */
  readonly tipoMaquina: string | null
  readonly titulo: string
  readonly detalle: string
  /** Cifras ya redactadas: la del libro y la de referencia. */
  readonly enLibro: string | null
  readonly referencia: string | null
  readonly etiquetas: readonly [string, string]
  readonly unidad: string
  readonly relativa: number | null
  readonly absoluta: number | null
  readonly estado: EstadoHallazgo
  readonly base: BaseJuicio
  readonly fuente: string
  readonly refs: readonly string[]
}

export interface FilaTipoMaq {
  readonly tipo: string
  readonly renglones: number
  /** Σ de «número de máquinas» de los renglones de ese tipo; null si ningún renglón trae cifra. */
  readonly necesariasRenglones: number | null
  readonly necesariasLibro: number | null
  readonly existentesLibro: number | null
  /** null si IM01 no se pudo leer (S/D, no «cero unidades»). */
  readonly existentesInventario: number | null
  readonly invBuenoRegular: number | null
  readonly invMalo: number | null
  readonly invBaja: number | null
  readonly invSinEstado: number
  readonly libroBuenoRegular: number | null
  readonly libroMalo: number | null
  readonly libroBaja: number | null
  readonly faltanteLibro: number | null
  readonly sobranteLibro: number | null
  /** Con el umbral de 0.5 y las existentes del libro; null si no hay necesidad. */
  readonly requeridas: number | null
  readonly faltanteCalculado: number | null
  readonly sobranteCalculado: number | null
  readonly porFaltante: number | null
  readonly porSustituir: number | null
  readonly adquirir: number | null
  /** Unidades del inventario ÷ necesidad: razón de unidades, no acredita suficiencia de horas ni condición del parque. null sin necesidad o sin inventario. */
  readonly cobertura: number | null
  readonly horasNecesarias: number | null
  /** 'no_evaluable': no se pudo comparar (fila con texto, IM01 sin leer o sin necesidad); no es lo mismo que «sin diferencia detectada». */
  readonly estado: EstadoHallazgo | 'coherente' | 'no_evaluable'
  readonly motivoNoEvaluable: string | null
  readonly hallazgos: readonly HallazgoMaq[]
}

export type ModoConcepto = 'reparto' | 'completa' | 'difiere' | 'sin_equivalente' | 'sin_cifra'

export interface ConceptoMaq {
  readonly clave: string
  readonly bloque: BloqueMaquinaria | null
  readonly concepto: string
  readonly unidad: string | null
  readonly renglones: readonly RenglonMaquinaria[]
  /** Σ de la cantidad anual de los renglones de B Maq. */
  readonly anualBMaq: number | null
  /** Necesidad anual de 3DN del concepto equivalente; null si no hay equivalente o no trae cifra. */
  readonly anual3dn: number | null
  readonly concepto3dn: string | null
  readonly ref3dn: string | null
  readonly modo: ModoConcepto
  readonly razon: number | null
  readonly estado: EstadoHallazgo | 'coherente' | 'no_evaluable'
}

export interface ResumenMaq {
  readonly tipos: number
  readonly tiposConDiferencia: number
  readonly necesariasLibro: number | null
  readonly necesariasRenglones: number | null
  readonly existentesLibro: number | null
  readonly existentesInventario: number | null
  readonly faltanteLibro: number | null
  readonly sobranteLibro: number | null
  readonly unidades: number
  readonly accesorios: number
  readonly hallazgos: number
  readonly discrepancias: number
  readonly atipicos: number
  readonly informativos: number
}

export interface VistaMaquinaria {
  readonly tipos: readonly FilaTipoMaq[]
  readonly conceptos: readonly ConceptoMaq[]
  readonly hallazgos: readonly HallazgoMaq[]
  readonly inventario: readonly UnidadMaquinaria[]
  readonly inventarioLeido: boolean
  /** false si no se localizó ni un renglón ni una fila del balance: sin lectura no hay «coherente» ni «sin diferencias». */
  readonly balanceLeido: boolean
  readonly resumen: ResumenMaq
  readonly avisos: readonly string[]
}

const num = (c: Cifra): number | null => (c.valor === null ? null : Number(c.valor))
const o0 = (c: Cifra): number => num(c) ?? 0
const conTexto = (c: Cifra): boolean => c.texto !== undefined && c.valor === null
const nfmt = (x: number): string => String(Number(x.toFixed(3)))
const relativa = (obs: number, ref: number): number | null => (ref === 0 ? null : Math.abs((obs - ref) / ref))
const dif = (a: number, b: number): boolean => Math.abs(a - b) > TOL_CIFRA

const PESO_ESTADO: Readonly<Record<EstadoHallazgo, number>> = { discrepa: 0, atipico: 1, informativo: 2 }

/* ───────────────────────── necesidad de 3DN por concepto de B Maq ───────────────────────── */

interface Equivalencia { readonly bmaq: RegExp; readonly tresDN: RegExp }
// «acuáticas» va antes que «terrestres» o «deshierbe»: un concepto que dice ambas cosas es de plantas acuáticas.
const EQUIVALENCIAS: Readonly<Partial<Record<BloqueMaquinaria, readonly Equivalencia[]>>> = {
  distribucion: [
    { bmaq: /acuaticas/, tresDN: /plantas acuaticas/ }, { bmaq: /^(deshierbe y limpia|limpia y deshierbe)/, tresDN: /plantas terrestres/ },
    { bmaq: /^desazolve/, tresDN: /^desazolve$/ }, { bmaq: /^terracerias/, tresDN: /^terracerias/ },
  ],
  drenaje: [
    { bmaq: /acuaticas/, tresDN: /plantas acuaticas/ }, { bmaq: /deshierbe/, tresDN: /plantas terrestres/ },
    { bmaq: /^desazolve/, tresDN: /^desazolve$/ }, { bmaq: /^terracerias/, tresDN: /^terracerias/ },
  ],
  caminos: [
    { bmaq: /plantas terrestres/, tresDN: /plantas terrestres/ }, { bmaq: /^conformacion/, tresDN: /^conformacion/ }, { bmaq: /^rastreo/, tresDN: /^rastreo/ },
    // Lectura del comprobador: en caminos se toma la terracería de 3DN como la conservación de cunetas de B Maq; el Formato 4 y el PO-2 traen cada uno una sola
    // de las dos y no las equiparan expresamente. El bacheo se toma como la reposición de revestimiento.
    { bmaq: /cunetas/, tresDN: /^terracerias/ }, { bmaq: /^bacheo/, tresDN: /reposicion revestimiento/ },
  ],
}

const BLOQUE_3DN: Readonly<Partial<Record<BloqueMaquinaria, RegExp>>> = { distribucion: /^red de distribucion/, drenaje: /^red de drenaje/, caminos: /^red de caminos/ }

function equivalente3dn(libro: LibroDerivado, bloque: BloqueMaquinaria | null, concepto: string): { anual: number | null; concepto: string; ref: string; unidad3dn: string | null; lectura: boolean } | null {
  if (bloque === null) return null
  const eq = EQUIVALENCIAS[bloque]?.find((e) => e.bmaq.test(quitaAcentos(concepto)))
  const reBloque = BLOQUE_3DN[bloque]
  if (eq === undefined || reBloque === undefined) return null
  const n = libro.necesidades.find((x) => reBloque.test(quitaAcentos(x.bloque)) && eq.tresDN.test(quitaAcentos(x.concepto)))
  return n === undefined ? null : { anual: num(n.necesidadAnual), concepto: n.concepto, ref: n.necesidadAnual.ref, unidad3dn: n.unidadTrabajo, lectura: /cunetas|^bacheo/.test(quitaAcentos(concepto)) }
}

const NOTA_SIN_EQUIVALENTE: Readonly<Record<BloqueMaquinaria, string>> = {
  bombeo: 'Plantas de bombeo: 3DN las cuenta por pieza, no por horas de máquina.',
  distribucion: 'Sin concepto equivalente en 3DN.', drenaje: 'Sin concepto equivalente en 3DN.', caminos: 'Sin concepto equivalente en 3DN.',
  parcelario: 'Mejoramiento parcelario: no forma parte de las necesidades de 3DN.',
}
export const notaSinEquivalente = (b: BloqueMaquinaria | null): string => (b === null ? 'Sin concepto equivalente en 3DN.' : NOTA_SIN_EQUIVALENTE[b])

/** Concepto de 3DN para el texto de una diferencia; si la equivalencia es del comprobador lo dice, con las unidades de cada lado. */
function etiqueta3dn(eq: { concepto: string; unidad3dn: string | null; lectura: boolean }, r: RenglonMaquinaria): string {
  return eq.lectura ? `${eq.concepto}»; equivalencia del comprobador, no de la norma: B Maq trae «${r.unidad ?? 'S/D'}» y 3DN rotula «${eq.unidad3dn ?? 'S/D'}` : eq.concepto
}

function hallazgoConcepto(clave: string, primero: RenglonMaquinaria, rs: readonly RenglonMaquinaria[], eqConcepto: string, ref3dn: string, extra: Pick<HallazgoMaq, 'titulo' | 'detalle' | 'enLibro' | 'referencia' | 'relativa' | 'absoluta' | 'estado'>): HallazgoMaq {
  return {
    id: `concepto:${primero.fila}:${clave}`, codigo: 'concepto_vs_3dn', tipoMaquina: null, etiquetas: ['B Maq', '3DN'], unidad: primero.unidad ?? '', base: 'integridad', fuente: F_3DN,
    refs: [...rs.map((r) => `B Maq!F${r.fila}`), ref3dn], ...extra, detalle: `${extra.detalle} (concepto de 3DN: «${eqConcepto}»)`,
  }
}

function conciliarConceptos(libro: LibroDerivado, m: MaquinariaLibro, hallazgos: HallazgoMaq[]): ConceptoMaq[] {
  const grupos = new Map<string, RenglonMaquinaria[]>()
  // Dos tablas del libro con el mismo concepto en el mismo bloque se juntan: se declara en el detalle de la diferencia.
  for (const r of m.renglones) {
    const clave = `${r.bloque ?? '-'}|${quitaAcentos(r.concepto ?? '')}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), r])
  }
  const salida: ConceptoMaq[] = []
  for (const [clave, rs] of grupos) {
    const primero = rs[0]!
    const concepto = primero.concepto ?? 'Sin concepto'
    const conAnual = rs.map((r) => num(r.anual)).filter((x): x is number => x !== null)
    const anualBMaq = conAnual.length === 0 ? null : conAnual.reduce((a, b) => a + b, 0)
    const eq = equivalente3dn(libro, primero.bloque, concepto)
    let modo: ModoConcepto = 'sin_equivalente'
    let razon: number | null = null
    let estado: ConceptoMaq['estado'] = 'no_evaluable'
    if (eq !== null) {
      modo = 'sin_cifra'
      const n3 = eq.anual
      if (n3 !== null && anualBMaq !== null) {
        if (n3 === 0) {
          // 3DN no necesita nada de este concepto y B Maq le programa máquinas: es la contradicción más fuerte de la conciliación.
          if (anualBMaq !== 0) {
            modo = 'difiere'; estado = 'atipico'
            hallazgos.push(hallazgoConcepto(clave, primero, rs, etiqueta3dn(eq, primero), eq.ref, {
              titulo: `${concepto}: B Maq programa máquinas y 3DN no tiene necesidad`,
              detalle: 'La necesidad anual de 3DN es 0 y la suma de la cantidad anual de B Maq no lo es. Puede ser un concepto que 3DN no contó o un renglón de más en B Maq',
              enLibro: nfmt(anualBMaq), referencia: '0', relativa: null, absoluta: anualBMaq, estado: 'atipico',
            }))
          } else { modo = 'reparto'; estado = 'coherente' }
        } else {
          razon = anualBMaq / n3
          const cerca = (x: number): boolean => Math.abs(x - n3) <= TOL_REL_CONCEPTO * Math.abs(n3)
          if (cerca(anualBMaq)) { modo = 'reparto'; estado = 'coherente' } else if (conAnual.length >= 2 && conAnual.every(cerca)) {
            modo = 'completa'
            // Cada equipo con la cantidad completa solo es explicable si hacen procesos distintos (cargar, acarrear, extender); dos del mismo tipo huelen a duplicado.
            const tipos = rs.map((r) => r.tipoCanonico ?? r.tipo)
            const repetido = new Set(tipos).size < tipos.length
            estado = repetido ? 'atipico' : 'informativo'
            if (repetido) {
              hallazgos.push(hallazgoConcepto(clave, primero, rs, etiqueta3dn(eq, primero), eq.ref, {
                titulo: `${concepto}: dos renglones del mismo tipo de máquina traen la cantidad completa`,
                detalle: 'Cada renglón trae la necesidad completa de 3DN y hay más de uno del mismo tipo de máquina: puede ser una cantidad contada dos veces',
                enLibro: nfmt(anualBMaq), referencia: nfmt(n3), relativa: relativa(anualBMaq, n3), absoluta: Math.abs(anualBMaq - n3), estado: 'atipico',
              }))
            }
          } else {
            modo = 'difiere'; estado = 'atipico'
            hallazgos.push(hallazgoConcepto(clave, primero, rs, etiqueta3dn(eq, primero), eq.ref, {
              titulo: `${concepto}: la cantidad de B Maq no coincide con la necesidad de 3DN`,
              detalle: `La suma de la cantidad anual de ${rs.length === 1 ? 'su renglón' : `sus ${rs.length} renglones`} en B Maq es ${nfmt(razon)} veces la necesidad anual de 3DN. `
                + 'Puede ser un reparto que no cierra, un equipo cuya cantidad se contó dos veces o una cantidad distinta a propósito: revisar con el libro',
              enLibro: nfmt(anualBMaq), referencia: nfmt(n3), relativa: relativa(anualBMaq, n3), absoluta: Math.abs(anualBMaq - n3), estado: 'atipico',
            }))
          }
        }
      }
    }
    salida.push({
      clave, bloque: primero.bloque, concepto, unidad: primero.unidad, renglones: rs, anualBMaq, anual3dn: eq?.anual ?? null,
      concepto3dn: eq?.concepto ?? null, ref3dn: eq?.ref ?? null, modo, razon, estado,
    })
  }
  return salida
}

/* ───────────────────────── renglones: horas y máquinas ───────────────────────── */

function revisarRenglones(m: MaquinariaLibro, hallazgos: HallazgoMaq[]): void {
  const partidas = m.renglones.flatMap((r) => {
    const anual = num(r.anual), rend = num(r.rendimiento)
    return anual === null || rend === null ? [] : [{ r, p: { id: String(r.fila), cantidad: dec(anual), rendimiento: dec(rend), capturada: r.horas.valor === null ? null : dec(r.horas.valor) } }]
  })
  const { filas } = calcularHorasEfectivas(partidas.map((x) => x.p), { tipo: 'mitad_arriba', decimales: 0 })
  filas.forEach((f, i) => {
    const r = partidas[i]!.r
    if (f.exacta === null || f.capturada === null) return
    const d = f.capturada.minus(f.exacta).abs().toNumber()
    if (d <= 0.01) return
    const grande = d >= 1
    const como = f.reproducidaPor === 'truncado' ? 'truncando a entero' : f.reproducidaPor === 'redondeo' ? 'redondeando a entero' : 'sin una regla de redondeo identificable'
    hallazgos.push({
      id: `horas:${r.fila}`, codigo: 'horas_renglon', tipoMaquina: r.tipoCanonico,
      titulo: `${r.concepto ?? 'Renglón'} · ${r.tipoCanonico ?? r.tipo}: horas distintas de cantidad ÷ rendimiento`,
      detalle: grande ? 'Las horas capturadas se apartan en una hora o más de dividir la cantidad anual entre el rendimiento (el umbral de una hora es criterio del comprobador).' : `La cifra capturada se obtiene ${como}; no cambia la conclusión, pero conviene declarar la regla de redondeo.`,
      enLibro: nfmt(f.capturada.toNumber()), referencia: nfmt(f.exacta.toNumber()), etiquetas: ['En el libro', 'Cantidad ÷ rendimiento'], unidad: 'h',
      relativa: relativa(f.capturada.toNumber(), f.exacta.toNumber()), absoluta: d, estado: grande ? 'discrepa' : 'informativo', base: 'norma', fuente: F_HM,
      refs: [`B Maq!I${r.fila}`],
    })
  })
  for (const r of m.renglones) {
    const h = num(r.horas), hd = num(r.horasDisponibles), nm = num(r.maquinas)
    if (h === null || hd === null || hd === 0 || nm === null) continue
    const esperado = h / hd
    if (!dif(nm, Number(esperado.toFixed(2))) && !dif(nm, esperado)) continue
    // Si el libro aplicó una eficiencia operativa entre 0.5 y 1 (Nm = He/(Ht·Eo), §6.3.2), la cuenta es una lectura admisible de la norma.
    const eo = nm === 0 ? null : esperado / nm
    const conEo = eo !== null && eo >= 0.5 && eo < 1
    hallazgos.push({
      id: `nm:${r.fila}`, codigo: 'nm_renglon', tipoMaquina: r.tipoCanonico,
      titulo: `${r.concepto ?? 'Renglón'} · ${r.tipoCanonico ?? r.tipo}: máquinas distintas de horas ÷ horas disponibles`,
      detalle: conEo
        ? `La diferencia equivale a una eficiencia operativa de ${nfmt(eo)}: Nm = He/(Ht·Eo) (§6.3.2) es una lectura admisible (el rango 0.5-1 es criterio del comprobador; el Manual no fija Eo); declarar cuál usa el libro.`
        : 'El número de máquinas del renglón no es horas necesarias entre horas disponibles (§6.3 paso 5).',
      enLibro: nfmt(nm), referencia: nfmt(esperado), etiquetas: ['En el libro', 'Horas ÷ disponibles'], unidad: 'máquinas', relativa: relativa(nm, esperado), absoluta: Math.abs(nm - esperado),
      estado: conEo ? 'atipico' : 'discrepa', base: 'norma', fuente: F_NM, refs: [`B Maq!K${r.fila}`],
    })
  }
}

/* ───────────────────────── tipos: balance contra renglones e inventario ───────────────────────── */

interface Conteo { total: number; buenoRegular: number; malo: number; baja: number; sinEstado: number }

function contarInventario(inventario: readonly UnidadMaquinaria[]): Map<string, Conteo> {
  const mapa = new Map<string, Conteo>()
  for (const u of inventario) {
    if (u.accesorio || u.tipoCanonico === null) continue
    const c = mapa.get(u.tipoCanonico) ?? { total: 0, buenoRegular: 0, malo: 0, baja: 0, sinEstado: 0 }
    c.total++
    if (u.estado === 'bueno' || u.estado === 'regular') c.buenoRegular++
    else if (u.estado === 'malo') c.malo++
    else if (u.estado === 'baja') c.baja++
    else c.sinEstado++
    mapa.set(u.tipoCanonico, c)
  }
  return mapa
}

const CELDAS: ReadonlyArray<keyof FilaBalanceMaquinaria> = ['necesarias', 'existentes', 'faltante', 'sobrante', 'buenoRegular', 'malo', 'baja', 'rehabilitacion', 'disposicion', 'porFaltante', 'porSustituir', 'suma']
const hayDatos = (b: FilaBalanceMaquinaria): boolean => CELDAS.some((k) => (b[k] as Cifra).valor !== null || conTexto(b[k] as Cifra))
const filaConTexto = (b: FilaBalanceMaquinaria): boolean => CELDAS.some((k) => conTexto(b[k] as Cifra))

function hallazgoTipo(tipo: string, h: Omit<HallazgoMaq, 'tipoMaquina' | 'id'> & { sufijo: string }): HallazgoMaq {
  const { sufijo, ...resto } = h
  return { ...resto, id: `${h.codigo}:${tipo}:${sufijo}`, tipoMaquina: tipo }
}

function revisarTipo(
  tipo: string, b: FilaBalanceMaquinaria | undefined, rs: readonly RenglonMaquinaria[], inv: Conteo | undefined, inventarioLeido: boolean,
): FilaTipoMaq {
  const hallazgos: HallazgoMaq[] = []
  const conK = rs.map((r) => num(r.maquinas)).filter((x): x is number => x !== null)
  const necRen = conK.length === 0 ? null : conK.reduce((a, c) => a + c, 0)
  const horas = rs.map((r) => num(r.horas)).filter((x): x is number => x !== null)
  const horasNecesarias = horas.length === 0 ? null : horas.reduce((a, c) => a + c, 0)
  const refB = (col: string): string => (b === undefined ? '' : `B Maq!${col}${b.fila}`)
  const nec = b === undefined ? null : num(b.necesarias)
  const existentesLibro = b === undefined ? null : num(b.existentes)
  const invTotal = inventarioLeido ? (inv?.total ?? 0) : null
  const necesidad = nec ?? necRen
  // Una celda con texto donde va un número no se interpreta: la fila no se compara (el aviso ya dice qué celda es).
  const comparable = b !== undefined && !filaConTexto(b)

  if (b === undefined && (rs.length > 0 || (inv?.total ?? 0) > 0)) {
    const impreso = TIPOS_FORMATO_4.has(tipo)
    hallazgos.push(hallazgoTipo(tipo, {
      sufijo: 'sin_fila', codigo: 'tipo_sin_fila', titulo: `${tipo}: ${rs.length > 0 ? 'tiene necesidad' : 'tiene unidades en el inventario'} pero no tiene fila en el balance`,
      detalle: `${rs.length > 0 ? 'Hay renglones de necesidad de este tipo' : 'IM01 lista unidades de este tipo'} y la tabla de balance no lo trae: no se contabiliza en el balance. `
        + (impreso ? '' : 'Su tipo no figura entre las 9 filas impresas del formato 4 (Manual p. 74); el formato no indica cómo añadir filas: el libro pudo haberla agregado (criterio del comprobador).'),
      enLibro: null, referencia: necRen === null ? (inv === undefined ? null : nfmt(inv.total)) : nfmt(necRen), etiquetas: ['En el balance', rs.length > 0 ? 'Σ renglones' : 'En IM01'], unidad: rs.length > 0 ? 'máquinas' : 'unidades',
      relativa: null, absoluta: necRen ?? inv?.total ?? null, estado: impreso && rs.length > 0 ? 'discrepa' : 'atipico', base: 'integridad', fuente: F_BALANCE, refs: rs.map((r) => `B Maq!K${r.fila}`),
    }))
  }
  if (comparable && nec !== null && necRen !== null && dif(nec, necRen)) {
    hallazgos.push(hallazgoTipo(tipo, {
      sufijo: 'nm', codigo: 'nm_vs_renglones', titulo: `${tipo}: máquinas necesarias del balance distintas de la suma de sus renglones`,
      detalle: 'El balance debería traer la suma de las máquinas necesarias de todos los renglones de este tipo (§6.3 paso 6).',
      enLibro: nfmt(nec), referencia: nfmt(necRen), etiquetas: ['En el balance', 'Suma de renglones'], unidad: 'máquinas', relativa: relativa(nec, necRen), absoluta: Math.abs(nec - necRen),
      estado: 'discrepa', base: 'integridad', fuente: F_BALANCE, refs: [refB('B'), ...rs.map((r) => `B Maq!K${r.fila}`)],
    }))
  }

  let requeridas: number | null = null, faltanteCalculado: number | null = null, sobranteCalculado: number | null = null
  const libroBR = b === undefined ? null : num(b.buenoRegular), libroMalo = b === undefined ? null : num(b.malo), libroBaja = b === undefined ? null : num(b.baja)
  const faltanteLibro = b === undefined ? null : num(b.faltante), sobranteLibro = b === undefined ? null : num(b.sobrante)
  if (comparable && nec !== null) {
    const ex = o0(b.existentes)
    // El Manual dice «aproximación a dos décimas» (pasos 5-6) y su ejemplo 1.56/1.46 usa dos decimales: lectura del comprobador, 1.504 se lee 1.50.
    const bt = balanceTipo({ nm: dec(nec).toDecimalPlaces(2), existentes: ex, buenoRegular: o0(b.buenoRegular), malo: o0(b.malo), baja: o0(b.baja), umbral: dec(UMBRAL_ADQUISICION) })
    requeridas = bt.requeridas; faltanteCalculado = bt.faltante; sobranteCalculado = bt.sobrante
    const fl = o0(b.faltante), sl = o0(b.sobrante)
    const blanco = (c: Cifra): string => (c.valor === null ? ' (celda en blanco, se lee 0)' : '')
    const textoDif = `Con necesidad ${nfmt(nec)} se requieren ${bt.requeridas} máquina${bt.requeridas === 1 ? '' : 's'} (umbral de ${UMBRAL_ADQUISICION}) y el libro cuenta ${ex} existente${ex === 1 ? '' : 's'}${blanco(b.existentes)}`
    if (fl !== bt.faltante) {
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'faltante', codigo: 'faltante_sobrante', titulo: `${tipo}: faltante del libro distinto del que resulta con el umbral de ${UMBRAL_ADQUISICION}`,
        detalle: `${textoDif}: faltan ${bt.faltante}${blanco(b.faltante)}. Lectura del comprobador (MAQ-006; el Manual aplica el umbral a la adquisición): la fracción es capacidad y no acredita suficiencia de horas. Acreditar la causa (horas faltantes, sustitución) o revisar el criterio.`,
        enLibro: nfmt(fl), referencia: nfmt(bt.faltante), etiquetas: ['Faltante en el libro', 'Faltante con el umbral'], unidad: 'máquinas', relativa: relativa(fl, bt.faltante), absoluta: Math.abs(fl - bt.faltante),
        estado: 'atipico', base: 'referencia_tecnica', fuente: F_BALANCE, refs: [refB('B'), refB('D')],
      }))
    }
    if (sl !== bt.sobrante) {
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'sobrante', codigo: 'faltante_sobrante', titulo: `${tipo}: sobrante del libro distinto del que resulta con el umbral de ${UMBRAL_ADQUISICION}`,
        detalle: `${textoDif}: sobran ${bt.sobrante}${blanco(b.sobrante)}. El Manual cuenta las existentes sin importar su modalidad de adquisición (§6.3 paso 7); la condición se asienta aparte (paso 9). Que un sobrante en mal estado no sea capacidad disponible es criterio del comprobador, no del Manual.`,
        enLibro: nfmt(sl), referencia: nfmt(bt.sobrante), etiquetas: ['Sobrante en el libro', 'Sobrante con el umbral'], unidad: 'máquinas', relativa: relativa(sl, bt.sobrante), absoluta: Math.abs(sl - bt.sobrante),
        estado: 'atipico', base: 'referencia_tecnica', fuente: F_BALANCE, refs: [refB('B'), refB('E')],
      }))
    }
  }
  if (comparable && existentesLibro !== null) {
    const suma = o0(b.buenoRegular) + o0(b.malo) + o0(b.baja)
    if (dif(suma, existentesLibro)) {
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'condicion', codigo: 'condicion_no_suma', titulo: `${tipo}: el estado del parque no suma las existentes`,
        detalle: 'Bueno o regular + malo + baja debe igualar las unidades existentes: cada unidad lleva un solo estado (Anexo 4, cols. 18-21).', enLibro: nfmt(suma), referencia: nfmt(existentesLibro), etiquetas: ['Suma por estado', 'Existentes'], unidad: 'máquinas',
        relativa: relativa(suma, existentesLibro), absoluta: Math.abs(suma - existentesLibro), estado: 'discrepa', base: 'integridad', fuente: 'Manual 2026 §6.3 paso 9 y formato 4 (p. 74): condición actual del parque existente', refs: [refB('C'), refB('F'), refB('G'), refB('H')],
      }))
    }
  }
  if (comparable && (num(b.porFaltante) !== null || num(b.porSustituir) !== null || num(b.suma) !== null)) {
    const esperado = o0(b.porFaltante) + o0(b.porSustituir)
    if (dif(esperado, o0(b.suma))) {
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'adquisicion', codigo: 'adquisicion_suma', titulo: `${tipo}: la suma de adquisición no iguala faltante + sustitución`,
        detalle: 'La adquisición total es la adquisición por faltante más la adquisición por sustitución (§6.3 paso 10).', enLibro: nfmt(o0(b.suma)), referencia: nfmt(esperado), etiquetas: ['Suma en el libro', 'Faltante + sustitución'], unidad: 'máquinas',
        relativa: relativa(o0(b.suma), esperado), absoluta: Math.abs(o0(b.suma) - esperado), estado: 'discrepa', base: 'integridad', fuente: F_BALANCE, refs: [refB('K'), refB('L'), refB('M')],
      }))
    }
  }
  // Contra el inventario: solo si IM01 se leyó, y solo si el libro declara existentes o el inventario trae unidades del tipo.
  if (comparable && inventarioLeido && invTotal !== null && (existentesLibro !== null || invTotal > 0)) {
    const ex = o0(b.existentes)
    if (dif(ex, invTotal)) {
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'existentes', codigo: 'existentes_vs_inventario', titulo: `${tipo}: existentes del balance distintas de las unidades del inventario`,
        detalle: `Las existentes se obtienen del inventario (Manual §6.3 paso 7; el Anexo 5 §3.1 paso 7 lo identifica con IM-01), sin importar la modalidad de adquisición; puede deberse también a que el libro escriba el tipo de otra forma. Se excluyen los implementos (criterio del comprobador; Anexo 4, col. 11)${existentesLibro === null ? '. La celda de existentes del balance está en blanco' : ''}.`,
        enLibro: existentesLibro === null ? 'S/D' : nfmt(ex), referencia: nfmt(invTotal), etiquetas: ['En el balance', 'En IM01'], unidad: 'unidades', relativa: relativa(ex, invTotal), absoluta: Math.abs(ex - invTotal),
        estado: 'atipico', base: 'norma', fuente: F_EXISTENTES, refs: [refB('C')],
      }))
    }
    const decl = { br: o0(b.buenoRegular), ma: o0(b.malo), ba: o0(b.baja) }
    const real = { br: inv?.buenoRegular ?? 0, ma: inv?.malo ?? 0, ba: inv?.baja ?? 0 }
    if (decl.br !== real.br || decl.ma !== real.ma || decl.ba !== real.ba) {
      const texto = (x: { br: number; ma: number; ba: number }): string => `bueno o regular ${x.br} · malo ${x.ma} · baja ${x.ba}`
      hallazgos.push(hallazgoTipo(tipo, {
        sufijo: 'estados', codigo: 'estados_vs_inventario', titulo: `${tipo}: condición del parque del balance distinta de la del inventario`,
        detalle: `Balance: ${texto(decl)}. Inventario IM01: ${texto(real)}${inv !== undefined && inv.sinEstado > 0 ? ` (${inv.sinEstado} sin estado marcado)` : ''}. Las fechas del balance y del inventario pueden ser distintas.`,
        enLibro: texto(decl), referencia: texto(real), etiquetas: ['En el balance', 'En IM01'], unidad: '',
        relativa: null, absoluta: Math.abs(decl.br - real.br) + Math.abs(decl.ma - real.ma) + Math.abs(decl.ba - real.ba),
        estado: 'atipico', base: 'norma', fuente: F_ESTADOS, refs: [refB('F'), refB('G'), refB('H')],
      }))
    }
  }

  hallazgos.sort(ordenarHallazgos)
  const peor = hallazgos[0]?.estado
  const motivoNoEvaluable = b === undefined ? null : !comparable ? 'La fila del balance trae texto donde va un número: no se interpreta ni se compara.' : !inventarioLeido ? 'No se pudo leer el inventario IM01: no hay con qué comparar las existentes ni la condición.' : nec === null ? 'La fila no trae las máquinas necesarias.' : null
  return {
    tipo, renglones: rs.length, necesariasRenglones: necRen, necesariasLibro: nec, existentesLibro, existentesInventario: invTotal,
    invBuenoRegular: invTotal === null ? null : (inv?.buenoRegular ?? 0), invMalo: invTotal === null ? null : (inv?.malo ?? 0), invBaja: invTotal === null ? null : (inv?.baja ?? 0), invSinEstado: inv?.sinEstado ?? 0,
    libroBuenoRegular: libroBR, libroMalo, libroBaja, faltanteLibro, sobranteLibro, requeridas, faltanteCalculado, sobranteCalculado,
    porFaltante: b === undefined ? null : num(b.porFaltante), porSustituir: b === undefined ? null : num(b.porSustituir), adquirir: b === undefined ? null : num(b.suma),
    cobertura: necesidad === null || necesidad === 0 || invTotal === null ? null : invTotal / necesidad, horasNecesarias,
    estado: peor ?? (motivoNoEvaluable === null ? 'coherente' : 'no_evaluable'), motivoNoEvaluable, hallazgos,
  }
}

/* ───────────────────────── totales del balance ───────────────────────── */

const COLUMNAS_TOTAL: ReadonlyArray<readonly [keyof FilaBalanceMaquinaria, string, string]> = [
  ['necesarias', 'B', 'Máquinas necesarias'], ['existentes', 'C', 'Existentes'], ['faltante', 'D', 'Faltante'], ['sobrante', 'E', 'Sobrante'],
  ['buenoRegular', 'F', 'Bueno o regular'], ['malo', 'G', 'Malo'], ['baja', 'H', 'Baja'], ['rehabilitacion', 'I', 'A rehabilitación'], ['disposicion', 'J', 'A disposición'],
  ['porFaltante', 'K', 'Adquisición por faltante'], ['porSustituir', 'L', 'Adquisición por sustitución'], ['suma', 'M', 'Adquisición total'],
]

function revisarTotales(m: MaquinariaLibro, hallazgos: HallazgoMaq[]): void {
  const t = m.totalBalance
  if (t !== null) {
    for (const [campo, col, rotulo] of COLUMNAS_TOTAL) {
      const cifra = t[campo] as Cifra
      const declarado = num(cifra)
      if (declarado === null) continue
      const suma = m.balance.reduce((a, f) => a + (num(f[campo] as Cifra) ?? 0), 0)
      if (!dif(declarado, suma)) continue
      hallazgos.push({
        id: `total:${col}`, codigo: 'total_columna', tipoMaquina: null, titulo: `Total de «${rotulo}» distinto de la suma de sus filas`,
        detalle: cifra.formula === null ? 'El total está capturado como constante, sin fórmula: no se actualiza al cambiar las filas.' : 'El rango de la fórmula no coincide con las filas del cuadro.',
        enLibro: nfmt(declarado), referencia: nfmt(suma), etiquetas: ['Total en el libro', 'Suma de filas'], unidad: '', relativa: relativa(declarado, suma), absoluta: Math.abs(declarado - suma),
        estado: 'discrepa', base: 'integridad', fuente: F_BALANCE, refs: [cifra.ref],
      })
    }
  }
  const r = m.totalRenglones
  if (r !== null) {
    for (const [campo, rotulo, ref] of [['horas', 'horas efectivas necesarias', 'I'], ['maquinas', 'número de máquinas', 'K']] as const) {
      const declarado = num(r[campo])
      if (declarado === null) continue
      const suma = m.renglones.reduce((a, x) => a + (num(x[campo]) ?? 0), 0)
      if (!dif(declarado, suma)) continue
      hallazgos.push({
        id: `total_renglones:${ref}`, codigo: 'total_columna', tipoMaquina: null, titulo: `Total de «${rotulo}» distinto de la suma de los renglones`,
        detalle: r[campo].formula === null ? 'El total está capturado como constante, sin fórmula.' : `La fórmula del total (${r[campo].formula}) no cubre exactamente los renglones.`,
        enLibro: nfmt(declarado), referencia: nfmt(suma), etiquetas: ['Total en el libro', 'Suma de renglones'], unidad: campo === 'horas' ? 'h' : 'máquinas', relativa: relativa(declarado, suma), absoluta: Math.abs(declarado - suma),
        estado: 'discrepa', base: 'integridad', fuente: F_BALANCE, refs: [r[campo].ref],
      })
    }
    const nb = t === null ? null : num(t.necesarias), nr = num(r.maquinas)
    if (nb !== null && nr !== null && dif(nb, nr)) {
      hallazgos.push({
        id: 'total:necesarias_vs_renglones', codigo: 'total_columna', tipoMaquina: null, titulo: 'Máquinas necesarias del balance distintas del total de los renglones',
        detalle: 'El total de la tabla de balance y el total de la parte superior de B Maq deberían coincidir.', enLibro: nfmt(nb), referencia: nfmt(nr), etiquetas: ['Tabla de balance', 'Renglones'], unidad: 'máquinas',
        relativa: relativa(nb, nr), absoluta: Math.abs(nb - nr), estado: 'discrepa', base: 'integridad', fuente: F_BALANCE, refs: [t!.necesarias.ref, r.maquinas.ref],
      })
    }
  }
}

/* ───────────────────────── inventario ───────────────────────── */

const SIN_ECONOMICO = /^s\/?n$|^sin\b/i

function revisarInventario(m: MaquinariaLibro, hallazgos: HallazgoMaq[]): void {
  const base = { absoluta: null, relativa: null, enLibro: null, referencia: null, etiquetas: ['En el libro', 'Esperado'] as const, unidad: '', base: 'norma' as const, fuente: F_IM01 }
  for (const u of m.inventario) {
    const nombre = `${u.tipo}${u.numeroEconomico === null ? '' : ` · ${u.numeroEconomico}`}`
    if (u.accesorio) {
      hallazgos.push({ ...base, id: `inv_accesorio:${u.fila}`, codigo: 'inv_accesorio', tipoMaquina: null, titulo: `${nombre}: es un implemento, no una máquina portadora`, detalle: 'Figura en IM-01 como implemento de una unidad básica (Anexo 4, col. 11); se excluye de las existentes de cualquier tipo (criterio del comprobador).', estado: 'informativo', fuente: F_IMPLEMENTO, refs: [u.ref] })
    } else if (u.tipoCanonico === null) {
      hallazgos.push({ ...base, id: `inv_tipo:${u.fila}`, codigo: 'inv_tipo', tipoMaquina: null, titulo: `${nombre}: tipo que no está en el catálogo del balance`, detalle: 'Su tipo no corresponde a ninguna fila de la tabla de balance; no se cuenta en ningún tipo y mueve las existentes.', estado: 'atipico', fuente: 'Anexo 4 IM-01 col. 1 (tipos de máquina)', refs: [u.ref] })
    }
    if (m.columnasInventario.numeroEconomico && (u.numeroEconomico === null || SIN_ECONOMICO.test(u.numeroEconomico))) {
      hallazgos.push({ ...base, id: `inv_sin_economico:${u.fila}`, codigo: 'inv_sin_economico', tipoMaquina: u.tipoCanonico, titulo: `${nombre}: sin número económico`, detalle: 'El Anexo 4 (col. 2) pide el número económico en IM-01 y el Manual §4.3.1 que la máquina lo porte en un lugar visible.', enLibro: u.numeroEconomico, estado: 'informativo', refs: [u.ref] })
    }
    if (u.unidadLectura === 'millas' || u.unidadLectura === 'km' || u.unidadLectura === 'otra') {
      hallazgos.push({ ...base, id: `inv_lectura:${u.fila}`, codigo: 'inv_lectura', tipoMaquina: u.tipoCanonico, titulo: `${nombre}: la lectura no está en horas`, detalle: `La columna «Horas trabajadas» trae «${u.horas.texto ?? ''}». No se convierte: aclarar las horas efectivas, salvo que la observación declare una estimación (Anexo 4, col. 22).`, enLibro: u.horas.texto ?? null, referencia: 'horas', estado: 'informativo', refs: [u.horas.ref] })
    } else if (m.columnasInventario.horas && u.unidadLectura === null && u.estado !== 'baja') {
      hallazgos.push({ ...base, id: `inv_sin_horas:${u.fila}`, codigo: 'inv_sin_horas', tipoMaquina: u.tipoCanonico, titulo: `${nombre}: sin horas trabajadas`, detalle: 'La columna «Horas trabajadas» está vacía (S/D).', estado: 'informativo', refs: [u.horas.ref] })
    }
    if (u.estadoConflicto) {
      hallazgos.push({ ...base, id: `inv_estado:${u.fila}`, codigo: 'inv_estado', tipoMaquina: u.tipoCanonico, titulo: `${nombre}: más de un estado mecánico marcado`, detalle: 'Debe marcarse un solo estado: bueno, regular, malo o baja.', estado: 'atipico', fuente: 'Anexo 4 IM-01 cols. 18-21', refs: [u.ref] })
    } else if (u.estado === null) {
      hallazgos.push({ ...base, id: `inv_estado:${u.fila}`, codigo: 'inv_estado', tipoMaquina: u.tipoCanonico, titulo: `${nombre}: sin estado mecánico marcado`, detalle: 'No se cuenta en bueno, regular, malo ni baja.', estado: 'informativo', fuente: 'Anexo 4 IM-01 cols. 18-21', refs: [u.ref] })
    }
  }
}

function ordenarHallazgos(a: HallazgoMaq, b: HallazgoMaq): number {
  return PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] || (b.relativa ?? -1) - (a.relativa ?? -1) || (b.absoluta ?? -1) - (a.absoluta ?? -1) || a.id.localeCompare(b.id, 'es')
}

const CACHE = new WeakMap<LibroDerivado, VistaMaquinaria | null>()

/** null si el libro no trae el balance de maquinaria (hoja ausente o libro leído con un extractor anterior). */
export function vistaMaquinaria(libro: LibroDerivado): VistaMaquinaria | null {
  const previa = CACHE.get(libro)
  if (previa !== undefined) return previa
  const v = calcular(libro)
  CACHE.set(libro, v)
  return v
}

function calcular(libro: LibroDerivado): VistaMaquinaria | null {
  const m = libro.maquinaria
  if (m === undefined) return null
  const todos: HallazgoMaq[] = []
  const conteo = contarInventario(m.inventario)
  const porTipoRenglones = new Map<string, RenglonMaquinaria[]>()
  for (const r of m.renglones) if (r.tipoCanonico !== null) porTipoRenglones.set(r.tipoCanonico, [...(porTipoRenglones.get(r.tipoCanonico) ?? []), r])
  const filaBalance = new Map<string, FilaBalanceMaquinaria>()
  for (const b of m.balance) {
    if (b.tipoCanonico === null) continue
    const previa = filaBalance.get(b.tipoCanonico)
    // Dos filas del balance que normalizan al mismo tipo: se queda la que trae datos y se avisa de la otra.
    if (previa !== undefined && hayDatos(previa)) {
      if (hayDatos(b)) todos.push({
        id: `tipo_duplicado:${b.fila}`, codigo: 'tipo_sin_fila', tipoMaquina: b.tipoCanonico, titulo: `${b.tipoCanonico}: dos filas del balance para el mismo tipo`,
        detalle: `Las filas ${previa.fila} y ${b.fila} de B Maq se leen como el mismo tipo («${previa.tipo.trim()}» y «${b.tipo.trim()}»); solo se compara la primera.`, enLibro: null, referencia: null, etiquetas: ['Fila 1', 'Fila 2'], unidad: '',
        relativa: null, absoluta: null, estado: 'atipico', base: 'integridad', fuente: F_BALANCE, refs: [`B Maq!A${previa.fila}`, `B Maq!A${b.fila}`],
      })
      continue
    }
    filaBalance.set(b.tipoCanonico, b)
  }

  // Una fila del balance con cifras y un nombre que no es del catálogo no se compara con nada: se señala.
  for (const b of m.balance) {
    if (b.tipoCanonico !== null || !hayDatos(b)) continue
    todos.push({
      id: `tipo_sin_catalogo_balance:${b.fila}`, codigo: 'tipo_sin_fila', tipoMaquina: null, titulo: `${b.tipo.trim()}: fila del balance con un tipo fuera del catálogo`,
      detalle: 'La fila trae cifras pero su tipo no corresponde a ninguno del catálogo; no se compara con los renglones ni con el inventario (sus cifras sí entran en los totales).', enLibro: b.tipo.trim(), referencia: null,
      etiquetas: ['En el libro', 'Catálogo'], unidad: '', relativa: null, absoluta: null, estado: 'atipico', base: 'integridad', fuente: F_BALANCE, refs: [`B Maq!A${b.fila}`],
    })
  }
  const balanceLeido = m.balance.length > 0 || m.renglones.length > 0
  const tipos: FilaTipoMaq[] = []
  for (const t of TIPOS_MAQUINA) {
    if (!balanceLeido) break
    const b = filaBalance.get(t)
    const rs = porTipoRenglones.get(t) ?? []
    const inv = conteo.get(t)
    if (rs.length === 0 && inv === undefined && (b === undefined || !hayDatos(b))) continue
    const fila = revisarTipo(t, b, rs, inv, m.inventarioLeido)
    tipos.push(fila)
    todos.push(...fila.hallazgos)
  }
  // Renglones sin tipo o con un tipo fuera del catálogo: no se pueden asignar a una fila del balance.
  for (const r of m.renglones) {
    if (r.tipoCanonico !== null) continue
    const vacio = r.tipo === ''
    todos.push({
      id: `tipo_sin_catalogo:${r.fila}`, codigo: 'tipo_sin_fila', tipoMaquina: null,
      titulo: `${r.concepto ?? 'Renglón'}: ${vacio ? 'renglón sin tipo de máquina' : `tipo de máquina «${r.tipo}» fuera del catálogo`}`,
      detalle: `${vacio ? 'El renglón trae cifras pero no el tipo de máquina' : 'El tipo no corresponde a ninguna fila de la tabla de balance'}: su necesidad no se contabiliza por tipo.`, enLibro: vacio ? null : r.tipo, referencia: null, etiquetas: ['En el libro', 'Catálogo'], unidad: '',
      relativa: null, absoluta: null, estado: 'atipico', base: 'integridad', fuente: F_BALANCE, refs: [`B Maq!G${r.fila}`],
    })
  }
  const conceptos = conciliarConceptos(libro, m, todos)
  revisarRenglones(m, todos)
  revisarTotales(m, todos)
  revisarInventario(m, todos)
  todos.sort(ordenarHallazgos)

  // La observación de un renglón (horas, máquinas) o de una unidad del inventario también es del tipo: el estado y el contador de la fila las incluyen.
  const tiposFinal = tipos.map((f): FilaTipoMaq => {
    const propios = todos.filter((h) => h.tipoMaquina === f.tipo)
    const peor = propios[0]?.estado
    return { ...f, hallazgos: propios, estado: peor ?? (f.motivoNoEvaluable === null ? 'coherente' : 'no_evaluable') }
  })

  const suma = (f: (t: FilaTipoMaq) => number | null): number | null => {
    const xs = tiposFinal.map(f).filter((x): x is number => x !== null)
    return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0)
  }
  return {
    tipos: tiposFinal, conceptos, hallazgos: todos, inventario: m.inventario, inventarioLeido: m.inventarioLeido, balanceLeido, avisos: m.avisos,
    resumen: {
      tipos: tiposFinal.length, tiposConDiferencia: tiposFinal.filter((t) => t.hallazgos.some((h) => h.estado !== 'informativo')).length,
      necesariasLibro: m.totalBalance === null ? suma((t) => t.necesariasLibro) : num(m.totalBalance.necesarias), necesariasRenglones: suma((t) => t.necesariasRenglones),
      existentesLibro: m.totalBalance === null ? suma((t) => t.existentesLibro) : num(m.totalBalance.existentes), existentesInventario: m.inventarioLeido ? tiposFinal.reduce((a, t) => a + (t.existentesInventario ?? 0), 0) : null,
      faltanteLibro: m.totalBalance === null ? suma((t) => t.faltanteLibro) : num(m.totalBalance.faltante), sobranteLibro: m.totalBalance === null ? suma((t) => t.sobranteLibro) : num(m.totalBalance.sobrante),
      unidades: m.inventario.length, accesorios: m.inventario.filter((u) => u.accesorio).length, hallazgos: todos.length,
      discrepancias: todos.filter((h) => h.estado === 'discrepa').length, atipicos: todos.filter((h) => h.estado === 'atipico').length, informativos: todos.filter((h) => h.estado === 'informativo').length,
    },
  }
}
