/**
 * SICA Conservación · admite y registra PacOT de la SRL Unidad Conchos y escribe el archivo de derivación del ciclo.
 *
 *   npm run conservacion:derivar -- [<pacot.xls|.xlsx> ...] [--carpeta <ruta>] [--salida <carpeta>] [--json]
 *
 * Sin archivos ni --carpeta lee la carpeta de PacOT de la SRL (Conservacion/SRL CONCHOS, o CONSERVACION_CARPETA_PACOT).
 * Solo los PacOT admitidos por esta vía son parte de la plataforma. Cada corrida suma a lo ya registrado en la
 * carpeta de salida (un archivo por ciclo): el mismo libro no se duplica y uno modificado crea versión nueva.
 * Los libros nunca se modifican ni se suben a ningún lado. Variables: CONSERVACION_PYTHON, CONSERVACION_LECTOR.
 * (La plataforma en local hace lo mismo sola al abrir el apartado; este comando sirve fuera del servidor de desarrollo.)
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listarLibros, procesarArchivos } from './lib/derivacion-carpeta.ts'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(aqui, '..')

function uso(msg) {
  if (msg) console.error(`Error: ${msg}\n`)
  console.error('Uso: npm run conservacion:derivar -- [<pacot.xls|.xlsx> ...] [--carpeta <ruta>] [--salida <carpeta>] [--json]')
  process.exit(msg ? 1 : 0)
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const libros = []
let carpeta = null
let salida = path.join(raiz, 'derivacion-conservacion')
let json = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--salida') salida = path.resolve(args[++i] ?? uso('--salida necesita una carpeta'))
  else if (a === '--carpeta') carpeta = path.resolve(args[++i] ?? uso('--carpeta necesita una ruta'))
  else if (a === '--json') json = true
  else if (a === '-h' || a === '--help') uso()
  else if (a.startsWith('--')) uso(`opción desconocida ${a}`)
  else libros.push(path.resolve(a))
}

const carpetaPorDefecto = process.env.CONSERVACION_CARPETA_PACOT ?? path.resolve(raiz, '..', 'Conservacion', 'SRL CONCHOS')
const base = carpeta ?? (libros.length === 0 ? carpetaPorDefecto : undefined)
const archivos = base ? listarLibros(base) : libros
if (archivos.length === 0) uso(base ? `no hay archivos .xls/.xlsx en ${base}` : 'falta al menos un archivo .xls o .xlsx')
if (base && !json) console.log(`Carpeta de PacOT: ${base} (${archivos.length} libros)`)

const dirLector = path.resolve(raiz, '..', 'Conservacion', 'Skill', 'herramientas', 'lector_xls')
const { resultados, ciclos } = procesarArchivos(archivos, { salida, dirLector, ...(base ? { base } : {}) })

if (json) {
  // Salida para la plataforma en local (servidor de desarrollo): solo el JSON, sin texto.
  const salidaJson = JSON.stringify({ carpeta: base ?? null, generadoEn: new Date().toISOString(), resultados, ciclos: ciclos.map((c) => c.archivo) })
  await new Promise((fin) => process.stdout.write(salidaJson, fin)) // esperar a que se vacíe la tubería antes de salir
  process.exit(0)
}

const TEXTO = { registrado: 'registrado', sin_cambios: 'sin cambios (mismo SHA-256)', nueva_version: 'nueva versión', rechazado: 'RECHAZADO, no es un PacOT de la SRL Unidad Conchos', error: 'ERROR' }
let problemas = 0
for (const r of resultados) {
  const ok = r.estado !== 'rechazado' && r.estado !== 'error'
  if (!ok) problemas++
  console.log(`${ok ? '✓' : '✗'} ${r.ruta}: ${r.ambito ? `${r.ambito} · ciclo ${r.ciclo} · ` : ''}${TEXTO[r.estado]}`)
  for (const m of r.mensajes) console.log(`    · ${m}`)
  for (const a of r.avisos) console.log(`    ! ${a}`)
}
for (const c of ciclos) {
  const s = c.archivo.resumen
  console.log(`\nCiclo ${c.ciclo}: SRL ${s.srlRegistrada ? 'registrada' : 'pendiente de cargar'} · módulos ${s.modulosRegistrados.join(', ') || 'ninguno'}`
    + (s.modulosPendientes.length ? ` · pendientes de cargar: ${s.modulosPendientes.join(', ')}` : ' · completo'))
  console.log(`Archivo: ${c.ruta}`)
}
if (problemas > 0) process.exitCode = 3
