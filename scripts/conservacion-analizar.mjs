/**
 * SICA Conservación · analiza un PacOT (.xls) en ESTA máquina y escribe un informe .json que la plataforma abre.
 *
 *   npm run conservacion:analizar -- <pacot.xls> [--modulo MOD-001] [--salida carpeta]
 *
 * El .xls nunca se modifica ni se sube a ningún lado: el lector Python lo lee, el núcleo TypeScript ejecuta las reglas
 * y solo el informe (hallazgos, cobertura, parámetros) queda en disco. Se ejecuta con vite-node (el núcleo es TS puro).
 * Variables: CONSERVACION_PYTHON (intérprete, por defecto "python"), CONSERVACION_LECTOR (ruta de lector_xls.py).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ejecutar, normalizarDataJson, PARAMETROS_POR_DEFECTO, PERFIL_PACOT_2026_27, VistaLibro,
} from '../src/conservacion/nucleo/index.ts'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(aqui, '..')

function uso(msg) {
  if (msg) console.error(`Error: ${msg}\n`)
  console.error('Uso: npm run conservacion:analizar -- <pacot.xls> [--modulo MOD-001] [--salida carpeta]')
  process.exit(msg ? 1 : 0)
}

const args = process.argv.slice(2).filter((a) => a !== '--')
let xls = null
let moduloId = null
let salida = path.join(raiz, 'informes-conservacion')
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--modulo') moduloId = args[++i] ?? uso('--modulo necesita un valor')
  else if (a === '--salida') salida = path.resolve(args[++i] ?? uso('--salida necesita una carpeta'))
  else if (a === '-h' || a === '--help') uso()
  else if (a.startsWith('--')) uso(`opción desconocida ${a}`)
  else xls = path.resolve(a)
}
if (!xls) uso('falta el archivo .xls')
if (moduloId !== null && !/^MOD-\d{3}$/.test(moduloId)) uso('el módulo debe verse como MOD-001')

const python = process.env.CONSERVACION_PYTHON ?? 'python'
const lector = process.env.CONSERVACION_LECTOR
  ?? path.resolve(raiz, '..', 'Conservacion', 'Skill', 'herramientas', 'lector_xls', 'lector_xls.py')

const shaArchivo = createHash('sha256').update(readFileSync(xls)).digest('hex')
const tmp = mkdtempSync(path.join(tmpdir(), 'sica-cons-'))
try {
  const r = spawnSync(python, ['-X', 'utf8', lector, xls, '--salida', tmp], { encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    console.error(`El lector .xls falló.\n${r.error?.message ?? ''}${r.stderr ?? ''}`)
    console.error(`Compruebe que Python y xlrd==2.0.1 están instalados (CONSERVACION_PYTHON=${python}).`)
    process.exit(2)
  }
  const crudo = JSON.parse(readFileSync(path.join(tmp, 'data.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(path.join(tmp, 'manifest.json'), 'utf8'))
  if (manifest.sha256 !== shaArchivo) throw new Error('El SHA-256 del lector no coincide con el del archivo: el .xls cambió durante la lectura.')

  const libro = new VistaLibro(normalizarDataJson(crudo, { sha256: manifest.sha256, extractor: manifest.lector ?? 'lector_xls' }))
  const informe = ejecutar({
    libro, parametros: PARAMETROS_POR_DEFECTO, perfil: PERFIL_PACOT_2026_27,
    fechaReferencia: new Date().toISOString().slice(0, 10),
  })

  const matrizRuta = path.join(raiz, 'src', 'conservacion', 'nucleo', 'especificacion', 'matriz.json')
  const matriz = JSON.parse(readFileSync(matrizRuta, 'utf8'))
  const catalogoReglas = matriz.reglas.map((x) => ({ id: x.id, clase: x.clase, regla: x.regla, severidad: x.severidad }))
  const c = PERFIL_PACOT_2026_27.ciclo

  const archivo = {
    formato: 'sica-conservacion-informe',
    version: 1,
    generadoEn: new Date().toISOString(),
    origen: {
      archivoNombre: path.basename(xls),
      archivoSha256: shaArchivo,
      moduloId,
      moduloNombre: libro.texto('Resumen', 'B6'),
      ciclo: libro.texto(c.hoja, c.celda),
      lector: manifest.lector ?? 'lector_xls',
    },
    catalogoReglas,
    informe: { ...informe, matrizSha256: createHash('sha256').update(readFileSync(matrizRuta)).digest('hex') },
  }

  mkdirSync(salida, { recursive: true })
  const sello = archivo.generadoEn.slice(0, 16).replace(/[-:T]/g, '')
  const destino = path.join(salida, `informe-${moduloId ?? 'sin-modulo'}-${sello}.json`)
  writeFileSync(destino, JSON.stringify(archivo), 'utf8')

  const r2 = informe.resumen
  console.log(`PacOT: ${archivo.origen.moduloNombre ?? path.basename(xls)} · ciclo ${archivo.origen.ciclo ?? 's/d'}`)
  console.log(`Reglas implementadas: ${informe.coberturaReglas.implementadas} de ${informe.coberturaReglas.totales}`)
  console.log(`Hallazgos: ${r2.hallazgos} (alta ${r2.alta}, media ${r2.media}, informativa ${r2.informativa})`)
  console.log(`Informe: ${destino}`)
  console.log('Ábralo en la plataforma, en SICA Conservación → "Abrir informe". Sin hallazgos no equivale a un programa correcto.')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
