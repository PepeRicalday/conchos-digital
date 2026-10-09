import { declararParametros } from '../parametros/catalogo'
import type { DocumentoPrograma } from '../libro/perfil'
import type { VistaLibro } from '../libro/vista'
import type { FuenteNorma, Hallazgo, Regla, Resultado, TrazaCalculo } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const MANUAL = 'Manual de Conservación 2026'

// ---------------------------------------------------------------------------------------------
// NOR-001  Parámetros y fuente declarados antes de auditar (capa 0)
// ---------------------------------------------------------------------------------------------

/** Parámetros de la matriz que el código aún no declara como valor tipado (se aplican como constantes de cada regla). */
const PARAMETROS_NO_TIPADOS = ['PAR-06', 'PAR-08', 'PAR-09', 'PAR-10', 'PAR-11', 'PAR-12', 'PAR-13', 'PAR-14', 'PAR-16'] as const

export const reglaNor001: Regla = {
  meta: {
    id: 'NOR-001', clase: 'MARCO NORMATIVO', titulo: 'Parámetros y fuente declarados antes de auditar',
    severidadBase: 'alta', fuentes: [{ documento: MANUAL, seccion: 'cap. 6 y 9.4' }, { documento: 'Anexo 5', seccion: '3.1' }],
    requiereLibro: false, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    const declaracion = declararParametros(ctx.parametros)
    const hallazgos: Hallazgo[] = []
    for (const p of declaracion) {
      if (p.origen !== 'defecto_manual_2026') {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'NOR-001', id: `NOR-001:${p.id}:organizacion`, titulo: `${p.id} ${p.nombre}: valor distinto del Manual`, severidad: 'informativa', origen: 'norma',
          detalle: `Se usa ${p.valor} (${p.origen}) en lugar del defecto del Manual. Sustento declarado: ${p.sustento ?? 'ninguno'}. El valor local no se certifica: lo avala quien lo declara.`,
          referencias: [], fuentes: [p.fuente], observado: p.valor, parametros: [p.id], dimensiones: { aritmetica: 'verificada' },
        }))
      }
      if (p.alternos.length > 0) {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'NOR-001', id: `NOR-001:${p.id}:alterno`, titulo: `${p.id} ${p.nombre}: las fuentes difieren (se usa ${p.valor})`, severidad: 'informativa', origen: 'norma',
          detalle: `Se aplica ${p.valor} (${p.fuente.documento}, ${p.fuente.seccion}); el Manual prevalece sobre los Anexos. Valores alternos: ${p.alternos.join('; ')}. Es una discrepancia de la norma, no un error del PacOT.`,
          referencias: [], fuentes: [p.fuente], observado: p.valor, parametros: [p.id], dimensiones: { aritmetica: 'verificada' },
        }))
      }
    }
    const calculos: TrazaCalculo[] = declaracion.map((p) => ({
      descripcion: `${p.id} ${p.nombre}`, entradas: { fuente: `${p.fuente.documento} ${p.fuente.seccion}`, origen: p.origen }, salida: p.valor,
    }))
    return [crearResultado({
      reglaId: 'NOR-001', hallazgos, calculos, revisados: declaracion.length, identificados: declaracion.length + PARAMETROS_NO_TIPADOS.length,
      unidad: 'parámetros declarados',
      pendientes: [`${PARAMETROS_NO_TIPADOS.join(', ')}: la matriz los define pero el código aún no los declara como valor configurable; las reglas usan constantes propias y no se informan aquí.`],
    })]
  },
}

// ---------------------------------------------------------------------------------------------
// NOR-002  Checklist documental del programa anual
// ---------------------------------------------------------------------------------------------

export type EstadoDocumento = 'presente' | 'sin_datos' | 'ausente_en_libro' | 'fuera_del_libro'

/** Una hoja "tiene datos" si contiene al menos una cantidad distinta de cero: un formato en blanco no acredita el documento. */
export function hojaConDatos(libro: VistaLibro, hoja: string): boolean | null {
  const h = libro.hoja(hoja)
  if (!h) return null
  for (const c of h.celdas.values()) if (c.tipo === 'numero' && c.valor !== 0) return true
  return false
}

export function estadoDocumento(libro: VistaLibro, doc: DocumentoPrograma): EstadoDocumento {
  if (doc.hojas.length === 0) return 'fuera_del_libro'
  const estados = doc.hojas.map((h) => hojaConDatos(libro, h))
  if (estados.every((e) => e === null)) return 'ausente_en_libro'
  return estados.some((e) => e === true) ? 'presente' : 'sin_datos'
}

export const reglaNor002: Regla = {
  meta: {
    id: 'NOR-002', clase: 'MARCO NORMATIVO', titulo: 'Checklist documental del programa anual',
    severidadBase: 'media', fuentes: [{ documento: MANUAL, seccion: '3.3' }, { documento: 'Anexo 3', seccion: '2.f' }], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('NOR-002', 'Requiere el libro y un perfil de formato')]
    const libro = ctx.libro
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    const calculos: TrazaCalculo[] = []
    let identificados = 0
    let revisados = 0
    const listas: ReadonlyArray<{ readonly clave: string; readonly fuente: FuenteNorma; readonly docs: readonly DocumentoPrograma[] }> = [
      { clave: 'manual', fuente: { documento: MANUAL, seccion: '3.3' }, docs: ctx.perfil.documentosPrograma.manual },
      { clave: 'anexo3', fuente: { documento: 'Anexo 3', seccion: '2.f' }, docs: ctx.perfil.documentosPrograma.anexo3 },
    ]
    for (const lista of listas) {
      const aparte: string[] = []
      lista.docs.forEach((doc, i) => {
        identificados++
        const estado = estadoDocumento(libro, doc)
        calculos.push({ descripcion: `${lista.clave} ${i + 1}. ${doc.nombre}`, entradas: { hojas: doc.hojas.join(', ') || 'fuera del libro' }, salida: estado })
        if (estado === 'fuera_del_libro') { aparte.push(doc.nombre); return }
        revisados++
        if (estado === 'presente') return
        const ausente = estado === 'ausente_en_libro'
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'NOR-002', id: `NOR-002:${lista.clave}:${i + 1}:${estado}`, titulo: `${ausente ? 'Falta en el libro' : 'Sin cantidades'}: ${doc.nombre}`,
          detalle: ausente ? `El documento se esperaría en ${doc.hojas.join(', ')} y el libro no tiene esas hojas.` : `Las hojas ${doc.hojas.join(', ')} existen pero no traen ninguna cantidad distinta de cero: el formato está en blanco o el programa no lo usa.`,
          origen: 'pacot', severidad: ausente ? 'media' : 'informativa', referencias: doc.hojas.map((h) => `${h}!A1`), fuentes: [lista.fuente],
          estadoEvidencia: 'verificada_en_archivo', dimensiones: { referencias: 'abierta' },
        }))
      })
      if (aparte.length) pendientes.push(`${lista.fuente.documento} ${lista.fuente.seccion}: ${aparte.length} documento(s) se entregan aparte y no se verifican desde el libro: ${aparte.join('; ')}`)
    }
    pendientes.push('Las dos listas se informan por separado; la del Manual prevalece. Presencia en el libro no acredita contenido correcto ni firma.')
    return [crearResultado({ reglaId: 'NOR-002', hallazgos, calculos, revisados, identificados, unidad: 'documentos exigidos', pendientes })]
  },
}

// ---------------------------------------------------------------------------------------------
// NOR-004  Calendario normativo: ciclo y meses
// ---------------------------------------------------------------------------------------------

export interface CicloAgricola {
  readonly inicio: number
  readonly fin: number
}

/** "2026 - 2027" → ciclo consecutivo. Un ciclo con años no consecutivos es un error de captura. */
export function parsearCiclo(texto: string): CicloAgricola | null {
  const m = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/.exec(texto)
  return m?.[1] && m[2] ? { inicio: Number(m[1]), fin: Number(m[2]) } : null
}

const normalizarMes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

export const reglaNor004: Regla = {
  meta: {
    id: 'NOR-004', clase: 'MARCO NORMATIVO', titulo: 'Calendario normativo: ciclo agrícola y meses',
    severidadBase: 'alta', fuentes: [{ documento: MANUAL, seccion: '3.3 y 9.2' }, { documento: 'Anexo 3', seccion: '2' }], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('NOR-004', 'Requiere el libro y un perfil de formato')]
    const libro = ctx.libro
    const cic = ctx.perfil.ciclo
    const maestro = libro.texto(cic.hoja, cic.celda)
    if (maestro === null) return [noEvaluable('NOR-004', `No se encontró el ciclo agrícola en ${cic.hoja}!${cic.celda}`)]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    const fuentes = [{ documento: MANUAL, seccion: '3.3' }] as const
    let revisados = 0
    let identificados = 0

    const ciclo = parsearCiclo(maestro)
    identificados++
    if (ciclo === null || ciclo.fin !== ciclo.inicio + 1) {
      hallazgos.push(crearHallazgo(ctx, {
        reglaId: 'NOR-004', id: `NOR-004:${cic.hoja}!${cic.celda}:ciclo`, titulo: 'El ciclo agrícola no son dos años consecutivos', severidad: 'alta', origen: 'pacot',
        detalle: `"${textoDeCelda(maestro, 30)}": el ciclo corre de octubre de un año a septiembre del siguiente.`, referencias: [`${cic.hoja}!${cic.celda}`], fuentes: [...fuentes],
        observado: textoDeCelda(maestro, 30), dimensiones: { referencias: 'abierta' },
      }))
    } else revisados++

    // El mismo ciclo en el encabezado de cada hoja
    for (const nombre of libro.hojas()) {
      const h = libro.hoja(nombre)
      if (!h || nombre === cic.hoja || cic.hojasCatalogo.includes(nombre)) continue
      for (const [ref, c] of h.celdas) {
        const fila = Number(/\d+/.exec(ref)?.[0] ?? '0')
        if (fila > cic.filasEncabezado || c.tipo !== 'texto') continue
        const otro = parsearCiclo(c.valor)
        if (otro === null) continue
        identificados++
        if (ciclo !== null && otro.inicio === ciclo.inicio && otro.fin === ciclo.fin) { revisados++; continue }
        revisados++
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'NOR-004', id: `NOR-004:${nombre}!${ref}:ciclo_distinto`, titulo: `Hoja con un ciclo distinto del declarado (${nombre})`, severidad: 'alta', origen: 'pacot',
          detalle: `${nombre}!${ref} dice "${otro.inicio} - ${otro.fin}" y ${cic.hoja}!${cic.celda} dice "${textoDeCelda(maestro, 30)}". Un programa con ciclos mezclados no se puede mapear a año-mes real.`,
          referencias: [`${nombre}!${ref}`, `${cic.hoja}!${cic.celda}`], fuentes: [...fuentes], esperado: textoDeCelda(maestro, 30), observado: `${otro.inicio} - ${otro.fin}`,
          dimensiones: { referencias: 'abierta' },
        }))
      }
    }

    // Meses del calendario: octubre a septiembre, en orden
    const verificar = (hoja: string, fila: number, columnas: ReadonlyArray<{ nombre: string; columna: string }>): void => {
      for (const m of columnas) {
        identificados++
        const t = libro.texto(hoja, `${m.columna}${fila}`)
        if (t !== null && normalizarMes(t) === normalizarMes(m.nombre)) { revisados++; continue }
        if (t === null) { pendientes.push(`${hoja}!${m.columna}${fila}: encabezado de mes ausente`); continue }
        revisados++
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'NOR-004', id: `NOR-004:${hoja}!${m.columna}${fila}:mes`, titulo: `Mes fuera de orden del ciclo (${hoja})`, severidad: 'alta', origen: 'pacot',
          detalle: `La columna ${m.columna} debería ser ${m.nombre} y dice "${textoDeCelda(t, 20)}".`, referencias: [`${hoja}!${m.columna}${fila}`], fuentes: [...fuentes],
          esperado: m.nombre, observado: textoDeCelda(t, 20), dimensiones: { referencias: 'abierta' },
        }))
      }
    }
    const cal = ctx.perfil.calendarioMensual
    for (const hoja of cal.hojas) if (libro.hoja(hoja)) verificar(hoja, cal.filaEncabezado, cal.meses.map((m) => ({ nombre: m.nombre, columna: m.columnas[0] ?? '' })))
    const um = ctx.perfil.programaMaquinaria
    if (libro.hoja(um.hoja)) verificar(um.hoja, um.filaEncabezado, um.meses)

    pendientes.push('Las fechas del diagnóstico, del inventario y del envío del programa (última semana de septiembre) no están en el libro: requieren el expediente. Prevalece el Manual sobre el "durante septiembre" del Anexo 3.')
    return [crearResultado({ reglaId: 'NOR-004', hallazgos, revisados, identificados, unidad: 'elementos del calendario', pendientes })]
  },
}
