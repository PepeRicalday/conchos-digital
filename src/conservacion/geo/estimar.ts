import type { Estructura, Edificio, UbicacionResuelta } from '../derivacion/tipos'
import { ejeDe, kmALatLng, usaTrazo } from './kmALatLng'
import type { CalidadPunto, EjesCanal } from './kmALatLng'

/**
 * Completa la ubicación de las obras cuyas coordenadas declaradas están defectuosas, usando su cadenamiento sobre el eje del
 * canal. Ni las coordenadas declaradas (lon/lat) ni el PK se modifican: la posición interpolada vive solo en `ubicacion`,
 * con estado 'estimada'. Sin PK completo o fuera del rango del eje queda 'sin_ubicar' con su motivo.
 */

/**
 * Desfase CONOCIDO entre el PK declarado de una estructura de IO4 y el PK de sus propias coordenadas (medido con el trazo real de la
 * SRL en las estructuras con coordenadas válidas): mediana 137 m, p90 414 m. Por eso toda posición calculada por PK es «posición
 * estimada» (la UI debe rotularla así) y las coordenadas válidas NUNCA se proyectan al trazo (ya están a mediana 13.1 m de él).
 */
export const DESFASE_PK_MEDIANA_M = 137
export const DESFASE_PK_P90_M = 414

/** Calidad de la ubicación de una obra: coordenadas válidas = 'declarada'; calculada por PK = 'estimada'; sin posición = null. */
export const calidadDeUbicacion = (u: UbicacionResuelta): CalidadPunto | null => (u.estado === 'valida' ? 'declarada' : u.estado === 'estimada' ? 'estimada' : null)

function resolver(o: Pick<Estructura, 'ubicacion' | 'pkMetros' | 'ramal' | 'motivoPK' | 'pkParcialKm'>, ejes: EjesCanal): UbicacionResuelta {
  if (o.ubicacion.estado === 'valida') return o.ubicacion
  const defecto = o.ubicacion.motivo ?? 'sin coordenadas'
  if (o.pkMetros === null) {
    const porque = o.pkParcialKm !== null ? `el cadenamiento solo trae el kilómetro ${o.pkParcialKm}` : (o.motivoPK ?? 'sin cadenamiento')
    return { estado: 'sin_ubicar', lon: null, lat: null, motivo: `${defecto}; ${porque}: no se puede estimar` }
  }
  const eje = ejeDe(ejes, o.ramal)
  const p = eje === null ? null : kmALatLng(o.pkMetros, eje)
  if (p === null) {
    return { estado: 'sin_ubicar', lon: null, lat: null, motivo: `${defecto}; su cadenamiento queda fuera del tramo con coordenadas del ${o.ramal === 'auxiliar' ? 'ramal auxiliar' : 'canal principal'}: no se extrapola` }
  }
  return { estado: 'estimada', lon: p.lon, lat: p.lat, motivo: eje !== null && usaTrazo(eje)
    ? `${defecto}; posición estimada sobre el trazo del canal con su cadenamiento (el PK declarado puede desfasarse ~${DESFASE_PK_MEDIANA_M} m)`
    : `${defecto}; posición interpolada con su cadenamiento` }
}

export function estimarUbicaciones(estructuras: readonly Estructura[], ejes: EjesCanal): Estructura[] {
  return estructuras.map((e) => ({ ...e, ubicacion: resolver(e, ejes) }))
}

/** Edificios: solo con cadenamiento en el texto de ubicación (IO7 lo trae a veces). Siempre sobre el eje principal. */
export function estimarEdificios(edificios: readonly Edificio[], ejes: EjesCanal): Edificio[] {
  return edificios.map((b) => {
    if (b.ubicacion.estado === 'valida') return b
    const m = b.pk === null ? null : Number(b.pk.split('+')[0]) * 1000 + Number(b.pk.split('+')[1])
    return { ...b, ubicacion: resolver({ ubicacion: b.ubicacion, pkMetros: m, ramal: 'principal', motivoPK: 'sin cadenamiento en el texto de ubicación', pkParcialKm: null }, ejes) }
  })
}
