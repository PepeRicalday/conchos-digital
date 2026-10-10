/**
 * Admisión y registro de PacOT desde archivos del disco (solo Node). Lo usan el comando
 * `npm run conservacion:derivar` y el servidor de desarrollo (lectura automática de la carpeta de PacOT).
 * Los libros nunca se modifican ni se suben a ningún lado. Cada libro pasa por la misma admisión:
 * solo los de la SRL Unidad Conchos entran; los demás se informan con su motivo.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizarDataJson, VistaLibro } from '../../src/conservacion/nucleo/index'
import { admitirPacot } from '../../src/conservacion/derivacion/admision'
import { EXTRACTOR_VERSION, extraerLibro } from '../../src/conservacion/derivacion/extraer'
import { MODULOS_ESPERADOS, registrar } from '../../src/conservacion/derivacion/registro'
import type { Registro } from '../../src/conservacion/derivacion/registro'
import { construirArchivo, leerArchivoDerivacion } from '../../src/conservacion/derivacion/archivo'
import type { ArchivoDerivacion } from '../../src/conservacion/derivacion/archivo'

export type EstadoArchivo = 'registrado' | 'sin_cambios' | 'nueva_version' | 'rechazado' | 'error'

export interface ResultadoArchivo {
  readonly archivo: string
  /** Ruta relativa a la carpeta de PacOT, para mostrarla. */
  readonly ruta: string
  readonly estado: EstadoArchivo
  /** Motivos de rechazo o de error. */
  readonly mensajes: readonly string[]
  /** Avisos de admisión y del extractor (datos pendientes de comprobar). */
  readonly avisos: readonly string[]
  readonly ciclo: string | null
  readonly ambito: string | null
  readonly sha256: string
}

export interface CicloEscrito { readonly ciclo: string; readonly ruta: string; readonly archivo: ArchivoDerivacion }

export interface OpcionesProceso {
  /** Carpeta donde viven los `derivacion-AAAA-AAAA.json` ya registrados (el registro persistente local). */
  readonly salida: string
  readonly dirLector: string
  readonly python?: string
  /** Carpeta base para mostrar rutas relativas. */
  readonly base?: string
  /** Rechazos ya conocidos por SHA-256: evita volver a leer un libro ajeno que no cambió. */
  readonly memoria?: Map<string, ResultadoArchivo>
}

const nombreCiclo = (ciclo: string): string => `derivacion-${ciclo.replace(/\s/g, '')}.json`

/** Todos los .xls/.xlsx de una carpeta y sus subcarpetas (ignora los temporales de Excel `~$…`). */
export function listarLibros(carpeta: string): string[] {
  const salida: string[] = []
  const visitar = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) visitar(p)
      else if (/\.xlsx?$/i.test(e.name) && !e.name.startsWith('~$')) salida.push(p)
    }
  }
  if (existsSync(carpeta)) visitar(carpeta)
  return salida.sort((a, b) => a.localeCompare(b))
}

function leerLibro(archivo: string, sha: string, op: OpcionesProceso): VistaLibro {
  const ext = path.extname(archivo).toLowerCase()
  const lector = process.env.CONSERVACION_LECTOR ?? path.join(op.dirLector, ext === '.xlsx' ? 'lector_xlsx.py' : 'lector_xls.py')
  const tmp = mkdtempSync(path.join(tmpdir(), 'sica-cons-'))
  try {
    const r = spawnSync(op.python ?? process.env.CONSERVACION_PYTHON ?? 'python', ['-X', 'utf8', '-W', 'ignore', lector, archivo, '--salida', tmp], { encoding: 'utf8' })
    if (r.error || r.status !== 0) throw new Error(`el lector falló: ${r.error?.message ?? ''}${r.stderr ?? ''}`.trim())
    const crudo: unknown = JSON.parse(readFileSync(path.join(tmp, 'data.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(path.join(tmp, 'manifest.json'), 'utf8')) as { sha256: string; lector?: string }
    if (manifest.sha256 !== sha) throw new Error('el SHA-256 del lector no coincide: el archivo cambió durante la lectura')
    return new VistaLibro(normalizarDataJson(crudo, { sha256: sha, extractor: manifest.lector ?? 'lector' }))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

interface EstadoCiclo { registro: Registro; avisos: Map<string, readonly string[]> }

function cargarRegistrados(salida: string): Map<string, EstadoCiclo> {
  const mapa = new Map<string, EstadoCiclo>()
  if (!existsSync(salida)) return mapa
  for (const f of readdirSync(salida)) {
    if (!/^derivacion-.*\.json$/.test(f)) continue
    try {
      const l = leerArchivoDerivacion(JSON.parse(readFileSync(path.join(salida, f), 'utf8')))
      mapa.set(l.ciclo, { registro: l.registro, avisos: l.avisos })
    } catch { /* un archivo ajeno o dañado en la carpeta no detiene el proceso */ }
  }
  return mapa
}

/** Admite y registra los libros indicados sobre lo ya registrado en `op.salida`, y reescribe los archivos de ciclo. */
export function procesarArchivos(archivos: readonly string[], op: OpcionesProceso): { resultados: ResultadoArchivo[]; ciclos: CicloEscrito[] } {
  const ciclos = cargarRegistrados(op.salida)
  const ahora = new Date().toISOString()
  const resultados: ResultadoArchivo[] = []
  const rel = (p: string): string => (op.base ? path.relative(op.base, p) : path.basename(p))

  for (const archivo of archivos) {
    const nombre = path.basename(archivo)
    let sha = ''
    try {
      sha = createHash('sha256').update(readFileSync(archivo)).digest('hex')
      // Atajo: un libro ya registrado (mismo SHA-256 y misma versión del extractor) no se vuelve a leer. Se consulta el registro real, no una memoria.
      const yaRegistrado = [...ciclos].flatMap(([ciclo, e]) => [...e.registro.values()].filter((p) => p.libro.sha256 === sha && p.libro.extractorVersion === EXTRACTOR_VERSION).map((p) => ({ ciclo, p, avisos: e.avisos.get(p.clave) ?? [] })))[0]
      if (yaRegistrado) {
        resultados.push({
          archivo: nombre, ruta: rel(archivo), estado: 'sin_cambios', mensajes: [], ciclo: yaRegistrado.ciclo, sha256: sha,
          ambito: yaRegistrado.p.ficha.tipo === 'SRL' ? 'SRL' : `M${yaRegistrado.p.ficha.numeroModulo}`,
          avisos: [...yaRegistrado.avisos, ...yaRegistrado.p.libro.avisos],
        })
        continue
      }
      // Un rechazo no cambia si el archivo no cambió: se reutiliza para no volver a leerlo.
      const rechazado = op.memoria?.get(sha)
      if (rechazado) { resultados.push({ ...rechazado, archivo: nombre, ruta: rel(archivo) }); continue }

      const v = leerLibro(archivo, sha, op)
      const adm = admitirPacot(v)
      if (!adm.admitido || !adm.ficha) {
        const r: ResultadoArchivo = { archivo: nombre, ruta: rel(archivo), estado: 'rechazado', mensajes: adm.motivos, avisos: adm.avisos, ciclo: null, ambito: null, sha256: sha }
        op.memoria?.set(sha, r); resultados.push(r); continue
      }
      const est = ciclos.get(adm.ficha.ciclo) ?? { registro: new Map(), avisos: new Map() }
      const r = registrar(est.registro, { ficha: adm.ficha, libro: extraerLibro(v), archivoNombre: nombre }, ahora)
      est.registro = r.registro
      est.avisos = new Map(est.avisos).set(r.pacot.clave, adm.avisos)
      ciclos.set(adm.ficha.ciclo, est)
      const res: ResultadoArchivo = {
        archivo: nombre, ruta: rel(archivo), mensajes: [], ciclo: adm.ficha.ciclo, sha256: sha,
        ambito: adm.ficha.tipo === 'SRL' ? 'SRL' : `M${adm.ficha.numeroModulo}`,
        estado: r.estado === 'nuevo' || r.estado === 'reprocesado' ? 'registrado' : r.estado === 'sin_cambio' ? 'sin_cambios' : 'nueva_version',
        avisos: [...adm.avisos, ...r.pacot.libro.avisos],
      }
      resultados.push(res)
    } catch (e) {
      const r: ResultadoArchivo = { archivo: nombre, ruta: rel(archivo), estado: 'error', mensajes: [e instanceof Error ? e.message : String(e)], avisos: [], ciclo: null, ambito: null, sha256: sha }
      resultados.push(r)
    }
  }

  mkdirSync(op.salida, { recursive: true })
  const escritos: CicloEscrito[] = []
  for (const [ciclo, est] of [...ciclos].sort(([a], [b]) => a.localeCompare(b))) {
    const archivo = construirArchivo(est.registro, est.avisos, ciclo, ahora, MODULOS_ESPERADOS)
    const texto = JSON.stringify(archivo)
    leerArchivoDerivacion(JSON.parse(texto)) // si el esquema no lo acepta, el archivo no sirve a la plataforma
    const ruta = path.join(op.salida, nombreCiclo(ciclo))
    writeFileSync(ruta, texto, 'utf8')
    escritos.push({ ciclo, ruta, archivo })
  }
  return { resultados, ciclos: escritos }
}
