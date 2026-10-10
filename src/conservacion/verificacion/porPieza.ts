/**
 * Modelo `por-pieza` (puro, sin React): obras puntuales (estructuras, edificios, comunicaciones…).
 *
 * Una pieza no tiene fórmula por tramo ni veredicto «cuadra/atípico» de criterio. El comprobador:
 *  (a) RECONSTRUYE la cantidad desde el inventario cuando existe uno (obra civil = filas de IO4; edificios = filas de IO7);
 *  (b) la compara contra la cifra del libro (3DN, columna E): `cuadra` si coincide, `atipico` (candidato a revisión) si difiere,
 *      `no_evaluable` con motivo si no hay inventario de respaldo (compuertas, comunicaciones…);
 *  (c) comprueba la ARITMÉTICA propia del libro: E × F = H y H × P.U. = J (base «integridad»), y la proporción declarada de las compuertas;
 *  (d) desagrega la cantidad por familia y tipo del catálogo, marcando lo ambiguo y lo sin clasificar.
 *
 * Reglas duras: nunca «correcto»; ausente = S/D (nunca 0); las compuertas NUNCA se reparten entre las estructuras (IO4 no dice cuáles
 * tienen compuerta); los vínculos `<<external>>` de 3DN no se pueden abrir y se declaran. DIAG-02 no se lee todavía (P-13).
 */
import type { Cifra, EstadoUbicacion, Edificio, Estructura, LibroDerivado, NecesidadMedia } from '../derivacion/tipos'
import { conceptoPiezaDe, type ConceptoPiezaDef, type KindPieza, type TipoDibujo } from '../derivacion/conceptos'
import { confiabilidadEstructuras } from '../derivacion/estructuras'
import { FAMILIAS, FAMILIA_POR_ID, INFO_TIPO, type FamiliaId } from '../estructuras/catalogo'
import type { ControlComp, EntradaComp, EstadoComp, OrigenEntrada, TokenEc } from './comprobacion'

export type ClaveGrupo = FamiliaId | 'ninguna'
export const ROTULO_SIN_CLASIFICAR = 'Sin clasificar'

/** Una obra del inventario (estructura de IO4 o edificio de IO7) lista para listar. */
export interface PiezaListada {
  readonly id: string
  readonly fila: number
  readonly fuente: 'IO4' | 'IO7'
  /** Clave del inventario en IO7 (O1-SRL, C1-SRL…); en IO4, la del canal si el libro es multicanal. */
  readonly inventario: string | null
  readonly nombre: string
  readonly tipo: string
  readonly clave: ClaveGrupo
  readonly subtipo: string | null
  readonly ambiguo: boolean
  readonly material: string | null
  /** `k+mmm` o null (S/D). */
  readonly pk: string | null
  readonly pkTexto: string | null
  readonly ubicacion: EstadoUbicacion
  readonly motivoUbicacion: string | null
  readonly lon: number | null
  readonly lat: number | null
  readonly lonTexto: string | null
  readonly latTexto: string | null
  readonly ref: string
  /** Solo IO7. */
  readonly uso: string | null
  readonly caracteristicas: string | null
  readonly areaPredioM2: number | null
}

export interface DesgloseTipo { readonly clave: string; readonly nombre: string; readonly n: number; readonly ambiguas: number }

export interface GrupoPieza {
  readonly id: string
  readonly clave: ClaveGrupo
  readonly rotulo: string
  readonly n: number
  readonly ambiguas: number
  readonly estimadas: number
  readonly sinUbicar: number
  readonly porTipo: readonly DesgloseTipo[]
  readonly piezas: readonly PiezaListada[]
  /** n / total de piezas del inventario; null si no hay total. */
  readonly fraccion: number | null
}

export interface ProporcionDeclarada {
  /** E(compuertas) / E(obra civil), decimal. */
  readonly valor: string
  /** Redondeada a 4 decimales, en %. */
  readonly porcentaje: string
  /** La razón es una proporción «redonda» (≤ 4 decimales): el libro la escribió como porcentaje. */
  readonly redonda: boolean
  readonly base: string
  readonly producto: string
  readonly enLibro: string
}

export type EstadoCuenta = 'cuadra' | 'atipico' | 'informativo' | 'no_evaluable'

export interface CuentaPieza {
  readonly id: 'cantidad' | 'necesidad' | 'importe' | 'proporcion'
  readonly titulo: string
  readonly tokens: readonly TokenEc[]
  /** Resultado de la cuenta; null = S/D. */
  readonly resultado: string | null
  readonly unidad: string
  /** Lo que dice el libro en la celda que la cuenta debería dar. */
  readonly enLibro: string | null
  readonly refLibro: string | null
  readonly estado: EstadoCuenta
}

export interface ComprobacionPieza {
  readonly id: string
  readonly fila: number
  readonly bloque: string
  readonly kind: KindPieza
  /** Rótulo del libro. */
  readonly concepto: string
  /** Nombre canónico. */
  readonly nombre: string
  readonly familiaObra: 'estructura' | 'edificio'
  readonly dibujo: TipoDibujo
  readonly modelo: 'por-pieza'
  readonly unidad: string
  readonly parametrica: string | null
  readonly trabajo: string | null
  readonly frecuencia: string | null
  readonly etiquetaFrecuencia: string | null
  readonly necesidadAnual: string | null
  readonly pu: string | null
  readonly importe: string | null
  readonly reconstruida: string | null
  readonly fuenteReconstruccion: string | null
  readonly diferencia: string | null
  /** Estado de la cantidad frente al inventario; el estado global incluye además la aritmética. */
  readonly estadoCantidad: EstadoComp
  readonly estado: EstadoComp
  readonly motivo?: string
  readonly proporcion: ProporcionDeclarada | null
  readonly cuentas: readonly CuentaPieza[]
  readonly entradas: readonly EntradaComp[]
  readonly controles: readonly ControlComp[]
  readonly grupos: readonly GrupoPieza[]
  /** Los grupos se pueden elegir como unidad de análisis (false en las compuertas: la proporción no es por estructura). */
  readonly gruposSeleccionables: boolean
  readonly totalPiezas: number | null
  /** Vínculo `<<external>>` de la cantidad (E), p. ej. `<<external>>!E79:E79`; null si no hay. */
  readonly vinculoExterno: string | null
  readonly notas: readonly string[]
  readonly refs: readonly string[]
}

/* ───────────────────────────── utilidades ───────────────────────────── */

const redondear = (x: number): string => String(Number(x.toPrecision(10)))
const numero = (c: Cifra): number | null => {
  if (c.valor === null) return null
  const n = Number(c.valor)
  return Number.isFinite(n) ? n : null
}
const cerca = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
const op = (simbolo: string): TokenEc => ({ origen: 'operador', simbolo })
const dato = (origen: OrigenEntrada, valor: number | string, etiqueta: string, unidad?: string): TokenEc => ({ origen, valor: typeof valor === 'number' ? redondear(valor) : valor, etiqueta, ...(unidad ? { unidad } : {}) })
const esExterno = (c: Cifra): boolean => c.formula !== null && c.formula.includes('<<external>>')
const titulo = (s: string): string => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }

/* ───────────────────────────── desagregación ───────────────────────────── */

function piezaDeEstructura(e: Estructura): PiezaListada {
  return {
    id: `io4-${e.fila}`, fila: e.fila, fuente: 'IO4', inventario: e.canal ?? null, nombre: e.tipoCrudo, tipo: INFO_TIPO[e.tipo].nombre, clave: e.familia ?? 'ninguna', subtipo: e.subtipo,
    ambiguo: e.ambiguo, material: e.material, pk: e.pk, pkTexto: e.cadenamientoTexto === '' ? null : e.cadenamientoTexto, ubicacion: e.ubicacion.estado, motivoUbicacion: e.ubicacion.motivo,
    lon: e.ubicacion.lon, lat: e.ubicacion.lat, lonTexto: e.lonTexto, latTexto: e.latTexto, ref: e.ref, uso: null, caracteristicas: null, areaPredioM2: null,
  }
}

function piezaDeEdificio(b: Edificio): PiezaListada {
  return {
    id: `io7-${b.fila}`, fila: b.fila, fuente: 'IO7', inventario: b.inventario, nombre: b.nombre, tipo: b.caracteristicas ?? 'S/D', clave: 'edificacion', subtipo: null, ambiguo: false, material: null,
    pk: b.pk, pkTexto: b.ubicacionTexto === '' ? null : b.ubicacionTexto, ubicacion: b.ubicacion.estado, motivoUbicacion: b.ubicacion.motivo, lon: b.ubicacion.lon, lat: b.ubicacion.lat,
    lonTexto: b.lonTexto, latTexto: b.latTexto, ref: b.ref, uso: b.uso, caracteristicas: b.caracteristicas, areaPredioM2: b.areaM2,
  }
}

const TOPE_NOMBRES_CRUDOS = 12

function armarGrupo(id: string, clave: ClaveGrupo, rotulo: string, piezas: readonly PiezaListada[], total: number | null): GrupoPieza {
  const porClave = new Map<string, { nombre: string; n: number; ambiguas: number }>()
  for (const p of piezas) {
    const k = clave === 'ninguna' ? p.nombre : p.tipo
    const prev = porClave.get(k) ?? { nombre: k, n: 0, ambiguas: 0 }
    porClave.set(k, { nombre: prev.nombre, n: prev.n + 1, ambiguas: prev.ambiguas + (p.ambiguo ? 1 : 0) })
  }
  let porTipo: DesgloseTipo[] = [...porClave].map(([k, v]) => ({ clave: k, nombre: v.nombre, n: v.n, ambiguas: v.ambiguas })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'))
  if (clave === 'ninguna' && porTipo.length > TOPE_NOMBRES_CRUDOS) {
    const resto = porTipo.slice(TOPE_NOMBRES_CRUDOS)
    porTipo = [...porTipo.slice(0, TOPE_NOMBRES_CRUDOS), { clave: '__otros', nombre: `Otros ${resto.length} nombres del inventario`, n: resto.reduce((s, x) => s + x.n, 0), ambiguas: 0 }]
  }
  return {
    id, clave, rotulo, n: piezas.length, ambiguas: piezas.filter((p) => p.ambiguo).length, estimadas: piezas.filter((p) => p.ubicacion === 'estimada').length,
    sinUbicar: piezas.filter((p) => p.ubicacion === 'sin_ubicar').length, porTipo, piezas, fraccion: total !== null && total > 0 ? piezas.length / total : null,
  }
}

/** Grupos de estructuras por familia del catálogo (y «Sin clasificar»), en el orden del catálogo. */
export function gruposDeEstructuras(estructuras: readonly Estructura[]): GrupoPieza[] {
  const piezas = estructuras.map(piezaDeEstructura)
  const out: GrupoPieza[] = []
  for (const f of FAMILIAS) {
    if (f.id === 'edificacion' && !piezas.some((p) => p.clave === 'edificacion')) continue
    const delGrupo = piezas.filter((p) => p.clave === f.id)
    if (delGrupo.length > 0) out.push(armarGrupo(f.id, f.id, FAMILIA_POR_ID[f.id].nombre, delGrupo, piezas.length))
  }
  const sin = piezas.filter((p) => p.clave === 'ninguna')
  if (sin.length > 0) out.push(armarGrupo('ninguna', 'ninguna', ROTULO_SIN_CLASIFICAR, sin, piezas.length))
  return out
}

export function gruposDeEdificios(edificios: readonly Edificio[]): GrupoPieza[] {
  const piezas = edificios.map(piezaDeEdificio)
  return piezas.length === 0 ? [] : [armarGrupo('edificacion', 'edificacion', 'Edificios y casetas (IO7)', piezas, piezas.length)]
}

/* ───────────────────────────── comprobación ───────────────────────────── */

function unidadPieza(n: NecesidadMedia): string {
  const u = (n.unidadTrabajo ?? n.unidadParametrica ?? '').trim().toLowerCase()
  return u === '' ? 'pza' : u
}

function aritmetica(n: NecesidadMedia, unidad: string): { cuentas: CuentaPieza[]; controles: ControlComp[] } {
  const E = numero(n.cantidadTrabajo), F = numero(n.frecuencia), H = numero(n.necesidadAnual), PU = numero(n.pu), J = numero(n.importe)
  const cuentas: CuentaPieza[] = []
  const controles: ControlComp[] = []
  const frec = n.etiquetaFrecuencia ?? 'frecuencia'

  // E × F = H
  if (E !== null && F !== null) {
    const calc = E * F
    const ok = H !== null && cerca(calc, H)
    cuentas.push({
      id: 'necesidad', titulo: 'Necesidad media anual: cantidad × frecuencia', unidad, resultado: redondear(calc), enLibro: H === null ? null : redondear(H), refLibro: n.necesidadAnual.ref,
      tokens: [dato('diagnostico', E, 'cantidad de trabajo (3DN)', unidad), op('×'), dato('parametro_libre', F, 'frecuencia', frec)], estado: H === null ? 'informativo' : ok ? 'cuadra' : 'atipico',
    })
    controles.push(H === null
      ? { id: 'pieza-necesidad-anual', estado: 'informativo', base: 'integridad', titulo: 'La necesidad anual (H) no tiene cifra', detalle: `3DN no trae la celda ${n.necesidadAnual.ref}: S/D, no se compara con ${redondear(E)} × ${redondear(F)}.` }
      : {
        id: 'pieza-necesidad-anual', estado: ok ? 'cuadra' : 'atipico', base: 'integridad',
        titulo: ok ? 'La necesidad anual es cantidad × frecuencia' : 'La necesidad anual no es cantidad × frecuencia',
        detalle: `${redondear(E)} × ${redondear(F)} = ${redondear(calc)}; el libro trae ${redondear(H)} (${n.necesidadAnual.ref}).${ok ? '' : ' La diferencia es de la propia cuenta del libro: candidato a revisión, no error confirmado.'}`,
        cifras: { observado: redondear(H), referencia: redondear(calc), unidad },
      })
  }
  // H × P.U. = J
  if (H !== null && PU !== null) {
    const calc = H * PU
    const ok = J !== null && cerca(calc, J)
    cuentas.push({
      id: 'importe', titulo: 'Importe: necesidad anual × precio unitario', unidad: '$', resultado: redondear(calc), enLibro: J === null ? null : redondear(J), refLibro: n.importe.ref,
      tokens: [dato('diagnostico', H, 'necesidad anual (3DN)', unidad), op('×'), dato('parametro_libre', PU, 'precio unitario', `$/${unidad}`)], estado: J === null ? 'informativo' : ok ? 'cuadra' : 'atipico',
    })
    controles.push(J === null
      ? { id: 'pieza-importe', estado: 'informativo', base: 'integridad', titulo: 'El importe (J) no tiene cifra', detalle: `3DN no trae la celda ${n.importe.ref}: S/D.` }
      : {
        id: 'pieza-importe', estado: ok ? 'cuadra' : 'atipico', base: 'integridad',
        titulo: ok ? 'El importe es necesidad anual × precio unitario' : 'El importe no es necesidad anual × precio unitario',
        detalle: `${redondear(H)} × ${redondear(PU)} = ${redondear(calc)}; el libro trae ${redondear(J)} (${n.importe.ref}).${ok ? '' : ' Candidato a revisión, no error confirmado.'}`,
        cifras: { observado: redondear(J), referencia: redondear(calc), unidad: '$' },
      })
  }
  return { cuentas, controles }
}

interface Insumos {
  readonly n: NecesidadMedia
  readonly def: ConceptoPiezaDef
  readonly libro: LibroDerivado
  readonly obraCivil: NecesidadMedia | null
}

function proporcionDe(compuertas: NecesidadMedia, obraCivil: NecesidadMedia | null): ProporcionDeclarada | null {
  const Ec = numero(compuertas.cantidadTrabajo), Eo = obraCivil === null ? null : numero(obraCivil.cantidadTrabajo)
  if (Ec === null || Eo === null || Eo === 0) return null
  const r = Ec / Eo
  const r4 = Number(r.toFixed(4))
  const redonda = cerca(r, r4)
  return { valor: redondear(r), porcentaje: redondear(r4 * 100), redonda, base: redondear(Eo), producto: redondear(r4 * Eo), enLibro: redondear(Ec) }
}

function construir({ n, def, libro, obraCivil }: Insumos): ComprobacionPieza {
  const unidad = unidadPieza(n)
  const E = numero(n.cantidadTrabajo)
  const notas: string[] = [...def.notas]
  const controles: ControlComp[] = []
  const cuentas: CuentaPieza[] = []
  let reconstruida: number | null = null
  let fuente: string | null = null
  let motivo: string | undefined
  let grupos: GrupoPieza[] = []
  let totalPiezas: number | null = null
  let proporcion: ProporcionDeclarada | null = null

  const est = libro.fichas.estructuras
  const edif = libro.fichas.edificios

  if (def.kind === 'obra-civil' || def.kind === 'compuertas') {
    if (est === undefined) {
      motivo = 'El registro es anterior a la lectura v4: no trae estructuras (IO4).'
    } else {
      const conf = confiabilidadEstructuras(libro)
      grupos = gruposDeEstructuras(est)
      if (!conf.confiable) {
        motivo = `Cifra no verificada (S/D): ${conf.motivo ?? 'las cifras de estructuras no superan las comprobaciones de cordura'}.`
        grupos = []
      } else {
        totalPiezas = est.length
        if (def.kind === 'obra-civil') { reconstruida = est.length; fuente = `IO4 · ${est.length} filas, una por estructura` }
      }
    }
  } else if (def.kind === 'edificios') {
    if (edif === undefined) {
      motivo = 'El registro es anterior a la lectura v4: no trae edificios (IO7).'
    } else {
      grupos = gruposDeEdificios(edif)
      totalPiezas = edif.length
      reconstruida = edif.length
      fuente = `IO7 · ${edif.length} edificios`
    }
  } else {
    motivo = def.kind === 'comunicaciones'
      ? 'No se lee una hoja de inventario de comunicaciones: la cantidad del libro (un vínculo externo) no es reconstruible aquí.'
      : 'No se lee un inventario de respaldo para estas obras: la cantidad del libro no es reconstruible aquí.'
  }

  // La reconstrucción contra el inventario.
  let estadoCantidad: EstadoComp = 'no_evaluable'
  let diferencia: string | null = null
  if (def.kind === 'compuertas') {
    proporcion = proporcionDe(n, obraCivil)
    const baseTxt = proporcion === null ? 'una proporción de las estructuras' : `${proporcion.porcentaje} % de las ${proporcion.base} obras civiles del libro`
    motivo = `Proporción declarada, no reconstruible por estructura: el libro asigna ${baseTxt}. IO4 no dice cuáles estructuras tienen compuerta, así que las compuertas no se reparten entre ellas.`
    if (proporcion !== null) {
      const Eo = Number(proporcion.base), r4 = Number(proporcion.porcentaje) / 100
      const ok = cerca(r4 * Eo, Number(proporcion.enLibro))
      cuentas.push({
        id: 'proporcion', titulo: 'Compuertas: proporción declarada × obras civiles', unidad, resultado: proporcion.producto, enLibro: proporcion.enLibro, refLibro: n.cantidadTrabajo.ref,
        tokens: [dato('diagnostico', proporcion.base, 'obras civiles (3DN)', unidad), op('×'), dato('parametro_libre', redondear(r4), 'proporción declarada', '')], estado: ok ? 'cuadra' : 'atipico',
      })
      controles.push({
        id: 'pieza-proporcion', base: 'integridad', estado: !proporcion.redonda ? 'informativo' : ok ? 'cuadra' : 'atipico',
        titulo: proporcion.redonda ? `La cantidad es ${proporcion.porcentaje} % de la obra civil` : 'La cantidad no es una proporción redonda de la obra civil',
        detalle: proporcion.redonda
          ? `${redondear(r4)} × ${proporcion.base} = ${proporcion.producto}; el libro trae ${proporcion.enLibro} (${n.cantidadTrabajo.ref}). Es aritmética del propio libro: no dice cuáles estructuras llevan compuerta.`
          : `La razón entre ${proporcion.enLibro} y ${proporcion.base} es ${proporcion.valor}, que no es un porcentaje redondo: no se toma como proporción declarada.`,
        cifras: { observado: proporcion.enLibro, referencia: proporcion.producto, unidad },
      })
    }
  } else if (reconstruida !== null && E !== null) {
    const ok = cerca(reconstruida, E)
    estadoCantidad = ok ? 'cuadra' : 'atipico'
    diferencia = redondear(Number((E - reconstruida).toFixed(9)))
    cuentas.push({
      id: 'cantidad', titulo: def.kind === 'edificios' ? 'Cantidad: edificios del inventario' : 'Cantidad: estructuras del inventario', unidad, resultado: redondear(reconstruida), enLibro: redondear(E), refLibro: n.cantidadTrabajo.ref,
      tokens: [dato('inventario', reconstruida, def.kind === 'edificios' ? 'edificios de IO7' : 'estructuras de IO4', unidad)], estado: ok ? 'cuadra' : 'atipico',
    })
    controles.push({
      id: 'pieza-cantidad-inventario', base: 'integridad', estado: ok ? 'cuadra' : 'atipico',
      titulo: ok ? 'La cantidad del libro coincide con el inventario' : 'La cantidad del libro difiere del inventario',
      detalle: ok ? `${fuente}: ${redondear(reconstruida)}; 3DN trae ${redondear(E)} (${n.cantidadTrabajo.ref}).`
        : `${fuente}: ${redondear(reconstruida)}; 3DN trae ${redondear(E)} (${n.cantidadTrabajo.ref}), ${redondear(Math.abs(E - reconstruida))} ${E > reconstruida ? 'de más' : 'de menos'}. Puede ser un error de captura en cualquiera de los dos: candidato a revisión, no error confirmado.`,
      cifras: { observado: redondear(E), referencia: redondear(reconstruida), unidad },
    })
  } else if (E === null) {
    motivo = motivo ?? 'El libro no trae cantidad de trabajo para este concepto (S/D).'
  }

  const ar = aritmetica(n, unidad)
  cuentas.push(...ar.cuentas)
  controles.push(...ar.controles)

  // Vínculos externos: 3DN toma estas celdas de otro libro que el comprobador no puede abrir.
  const ext = [n.cantidadParametrica, n.cantidadTrabajo, n.frecuencia, n.necesidadAnual].filter(esExterno)
  const vinculoExterno = esExterno(n.cantidadTrabajo) ? n.cantidadTrabajo.formula : (ext[0]?.formula ?? null)
  if (ext.length > 0) {
    controles.push({
      id: 'pieza-vinculo-externo', base: 'integridad', estado: 'informativo', titulo: 'Los datos de 3DN vienen de un libro externo',
      detalle: `La cantidad, la frecuencia y la necesidad anual son vínculos a otro libro (${vinculoExterno ?? '<<external>>'}); el comprobador no puede abrirlo y compara contra el valor guardado en este libro. El P.U. sí es un dato capturado (${n.pu.ref}).`,
    })
  }

  // Lo ambiguo y lo sin clasificar nunca se reparte en silencio.
  if (def.kind === 'obra-civil' && grupos.length > 0) {
    const amb = grupos.reduce((s, g) => s + g.ambiguas, 0)
    const sin = grupos.find((g) => g.clave === 'ninguna')?.n ?? 0
    if (amb > 0 || sin > 0) {
      controles.push({
        id: 'pieza-ambiguas', base: 'integridad', estado: 'informativo', titulo: 'Hay estructuras de tipo ambiguo o sin clasificar',
        detalle: `${amb} con nombre ambiguo (se conserva el subtipo crudo, p. ej. «entrada de agua» con tubos, compuerta o puente) y ${sin} sin clasificar. Cuentan en el total; ninguna se reclasifica en silencio.`,
      })
    }
    const mats = new Map<string, number>()
    for (const e of est ?? []) mats.set(e.material ?? 'S/D', (mats.get(e.material ?? 'S/D') ?? 0) + 1)
    if (mats.size > 0) {
      controles.push({
        id: 'pieza-material', base: 'integridad', estado: 'informativo', titulo: 'Material declarado en IO4',
        detalle: `${[...mats].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m} × ${c}`).join(' · ')}. Todas las filas cuentan para la reparación de obra civil; el libro no separa por material.`,
      })
    }
  }
  if (def.kind !== 'otras-obras') notas.push('DIAG-02 (obras dispersas) no se lee todavía (pendiente P-13): no se contrasta contra sus agregados.')

  const hayAtipicoControl = controles.some((k) => k.estado === 'atipico')
  const estado: EstadoComp = estadoCantidad === 'atipico' || hayAtipicoControl ? 'atipico' : estadoCantidad === 'cuadra' ? 'cuadra' : 'no_evaluable'
  const entradas: EntradaComp[] = [
    ...(reconstruida !== null && fuente !== null ? [{ etiqueta: def.kind === 'edificios' ? 'Edificios del inventario' : 'Estructuras del inventario', valor: redondear(reconstruida), unidad, origen: 'inventario' as const, ref: def.kind === 'edificios' ? 'IO7' : 'IO4' }] : []),
    { etiqueta: 'Cantidad de trabajo', valor: n.cantidadTrabajo.valor ?? 'S/D', unidad, origen: 'diagnostico', ref: n.cantidadTrabajo.ref },
    { etiqueta: 'Frecuencia', valor: n.frecuencia.valor ?? 'S/D', unidad: n.etiquetaFrecuencia ?? '', origen: 'parametro_libre', ref: n.frecuencia.ref },
    { etiqueta: 'Precio unitario', valor: n.pu.valor ?? 'S/D', unidad: `$/${unidad}`, origen: 'parametro_libre', ref: n.pu.ref },
  ]
  const refs = [n.cantidadParametrica.ref, n.cantidadTrabajo.ref, n.frecuencia.ref, n.necesidadAnual.ref, n.pu.ref, n.importe.ref]
  const nombre = def.kind === 'otras-obras' ? `${titulo(n.bloque)}: ${n.concepto.replace(/\s+/g, ' ').trim()}` : def.nombre

  return {
    id: `pieza:${n.fila}`, fila: n.fila, bloque: n.bloque, kind: def.kind, concepto: n.concepto, nombre, familiaObra: def.obras[0] === 'edificio' ? 'edificio' : 'estructura', dibujo: def.dibujo, modelo: 'por-pieza', unidad,
    parametrica: n.cantidadParametrica.valor, trabajo: n.cantidadTrabajo.valor, frecuencia: n.frecuencia.valor, etiquetaFrecuencia: n.etiquetaFrecuencia, necesidadAnual: n.necesidadAnual.valor, pu: n.pu.valor, importe: n.importe.valor,
    reconstruida: reconstruida === null ? null : redondear(reconstruida), fuenteReconstruccion: fuente, diferencia, estadoCantidad, estado,
    ...(estadoCantidad === 'no_evaluable' && motivo !== undefined ? { motivo } : {}), proporcion, cuentas, entradas, controles, grupos, gruposSeleccionables: def.kind !== 'compuertas' && grupos.length > 0, totalPiezas,
    vinculoExterno, notas, refs,
  }
}

const CACHE = new WeakMap<LibroDerivado, ComprobacionPieza[]>()

/**
 * Comprobación por pieza de los conceptos de obras puntuales de 3DN (estructuras, edificios, comunicaciones, presas, pozos y plantas)
 * que tienen cantidad de trabajo. Los conceptos sin cantidad (SUMA = 0) son «no aplica» y se listan en `bloquesNoAplica`.
 */
export function comprobarObrasPuntuales(libro: LibroDerivado): ComprobacionPieza[] {
  const previa = CACHE.get(libro)
  if (previa) return previa
  const filas = libro.necesidades.flatMap((n) => { const def = conceptoPiezaDe(n.bloque, n.concepto); return def ? [{ n, def }] : [] })
  const obraCivil = filas.find((x) => x.def.kind === 'obra-civil' && numero(x.n.cantidadTrabajo) !== null)?.n ?? null
  const salida = filas.filter((x) => numero(x.n.cantidadTrabajo) !== null).map(({ n, def }) => construir({ n, def, libro, obraCivil }))
  CACHE.set(libro, salida)
  return salida
}

/** Bloques de obras puntuales cuyos conceptos no traen cantidad (importe 0 en 3DN): no aplican a este PacOT. */
export function bloquesNoAplica(libro: LibroDerivado): string[] {
  const por = new Map<string, boolean>()
  for (const n of libro.necesidades) {
    if (!conceptoPiezaDe(n.bloque, n.concepto)) continue
    por.set(n.bloque, (por.get(n.bloque) ?? true) && numero(n.cantidadTrabajo) === null)
  }
  return [...por].filter(([, sinCantidad]) => sinCantidad).map(([b]) => titulo(b))
}

/** Nombre del grupo elegido como unidad de análisis: `todo`, `fam:<id>` o `tipo:<clave>`. */
export type GrupoSel = 'todo' | `fam:${string}` | `tipo:${string}`

export interface VistaGrupo {
  readonly id: GrupoSel
  readonly rotulo: string
  readonly piezas: readonly PiezaListada[]
  readonly n: number
  readonly fraccion: number | null
  /** Parte proporcional del importe del libro (n / total × J). NO es una cifra del libro: es un reparto. null si falta algún dato. */
  readonly importeProporcional: string | null
  readonly necesidadProporcional: string | null
}

/** La unidad de análisis de un concepto de pieza: todo el concepto, una familia o un tipo concreto. */
export function vistaDeGrupo(c: ComprobacionPieza, sel: GrupoSel): VistaGrupo {
  const todas = c.grupos.flatMap((g) => g.piezas)
  const total = c.totalPiezas
  let piezas: readonly PiezaListada[] = todas
  let rotulo = 'Todo el concepto'
  if (sel.startsWith('fam:')) {
    const g = c.grupos.find((x) => x.id === sel.slice(4))
    if (g) { piezas = g.piezas; rotulo = g.rotulo }
  } else if (sel.startsWith('tipo:')) {
    const clave = sel.slice(5)
    const g = c.grupos.find((x) => x.porTipo.some((t) => t.clave === clave))
    const t = g?.porTipo.find((x) => x.clave === clave)
    if (g && t) { piezas = g.piezas.filter((p) => (g.clave === 'ninguna' ? p.nombre : p.tipo) === clave); rotulo = `${g.rotulo}: ${t.nombre}` }
  }
  const fraccion = total !== null && total > 0 ? piezas.length / total : null
  const J = c.importe === null ? null : Number(c.importe), H = c.necesidadAnual === null ? null : Number(c.necesidadAnual)
  return {
    id: sel, rotulo, piezas, n: piezas.length, fraccion,
    importeProporcional: fraccion === null || J === null || !Number.isFinite(J) ? null : redondear(J * fraccion),
    necesidadProporcional: fraccion === null || H === null || !Number.isFinite(H) ? null : redondear(H * fraccion),
  }
}

/** Opciones de grupo para un selector: el concepto completo, las familias y, bajo ellas, los tipos. */
export function opcionesDeGrupo(c: ComprobacionPieza): Array<{ id: GrupoSel; etiqueta: string; nivel: 0 | 1 | 2 }> {
  const out: Array<{ id: GrupoSel; etiqueta: string; nivel: 0 | 1 | 2 }> = [{ id: 'todo', etiqueta: `Todo el concepto (${c.totalPiezas ?? 'S/D'})`, nivel: 0 }]
  if (!c.gruposSeleccionables) return out
  for (const g of c.grupos) {
    out.push({ id: `fam:${g.id}`, etiqueta: `${g.rotulo} (${g.n})`, nivel: 1 })
    if (g.porTipo.length > 1) for (const t of g.porTipo) if (t.clave !== '__otros') out.push({ id: `tipo:${t.clave}`, etiqueta: `${t.nombre} (${t.n})`, nivel: 2 })
  }
  return out
}

/** Texto corto del estado de un concepto de pieza (el mismo que la barra de contexto, la lista y la infografía). */
export function textoEstadoPieza(c: ComprobacionPieza): string {
  if (c.estado === 'no_evaluable') return 'no evaluable'
  if (c.estado === 'cuadra') return 'coherente con el inventario'
  if (c.estadoCantidad === 'atipico') return 'atípico por conciliación con el inventario'
  return 'atípico por la aritmética del libro'
}
