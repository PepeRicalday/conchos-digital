import type { FamiliaId, TipoEstructura, TipoIO1 } from '../estructuras/catalogo'

/**
 * Derivación de cálculos del PacOT: cada cifra conserva de dónde sale (celda), si la celda era una fórmula
 * o un valor capturado, y la fórmula tal cual está en el libro. Valores decimales como cadena (sin pérdida).
 * El libro original no se modifica; los valores son los guardados en el archivo (caché).
 */

/** 'formula': la celda calcula; 'capturado': el usuario tecleó el valor; 'vacio': no hay dato (nunca es cero). */
export type OrigenCifra = 'formula' | 'capturado' | 'vacio'

export interface Cifra {
  /** Decimal exacto como cadena, o null si la celda está vacía o no es número. */
  readonly valor: string | null
  /** Si la celda trae texto donde debía haber un número (p. ej. "|"), el texto: una celda vacía NO lo trae. */
  readonly texto?: string
  /** `hoja!celda`. */
  readonly ref: string
  readonly formula: string | null
  readonly origen: OrigenCifra
}

/** 'tuberia': bloque de distribución en sección circular (IO1.a), aparte de los canales abiertos. */
export type TipoRed = 'distribucion' | 'tuberia' | 'drenaje' | 'caminos' | 'otro'

export interface ConceptoTramo {
  /** Rótulo de columna de DIAG-01 (p. ej. "DESAZOLVE"). */
  readonly concepto: string
  readonly parametrica: Cifra
  readonly trabajo: Cifra
}

/** Una fila de DIAG-01: obra (canal, camino o dren) y tramo con sus cantidades por concepto. */
export interface TramoDiagnostico {
  readonly fila: number
  readonly red: TipoRed
  readonly inventario: string
  readonly obra: string
  readonly pkInicial: string
  readonly pkFinal: string
  readonly km: Cifra
  readonly conceptos: readonly ConceptoTramo[]
}

/** Fila de totales de DIAG-01 (hay una por bloque; su posición varía: antes o después de los tramos). */
export interface FilaTotalesDiagnostico {
  readonly fila: number
  readonly km: Cifra
  readonly conceptos: readonly ConceptoTramo[]
}

/** Una fila de concepto en 3DN (necesidad media anual). */
export interface NecesidadMedia {
  readonly fila: number
  readonly bloque: string
  readonly concepto: string
  readonly unidadParametrica: string | null
  readonly unidadTrabajo: string | null
  readonly cantidadParametrica: Cifra
  /** Total de trabajo: normalmente enlaza a la fila de totales de DIAG-01 (`enlaceDiagnostico`). */
  readonly cantidadTrabajo: Cifra
  readonly frecuencia: Cifra
  /** Rótulo de la frecuencia tal como está en el libro ("Ev./Mes" o "Ev./Año"). */
  readonly etiquetaFrecuencia: string | null
  readonly necesidadAnual: Cifra
  readonly pu: Cifra
  readonly importe: Cifra
  /** Columna de DIAG-01 de la que toma su total, si la fórmula lo declara; si no, null. */
  readonly enlaceDiagnostico: { readonly columna: string; readonly fila: number } | null
}

export interface SumaBloque {
  readonly fila: number
  readonly bloque: string
  readonly importe: Cifra
}

/** Un renglón del programa de obra (SEG-3): concepto en un tramo. */
export interface RenglonPrograma {
  readonly fila: number
  readonly inventario: string
  readonly clave: string
  readonly red: TipoRed
  /** Títulos de concepto que preceden al renglón (p. ej. "LIMPIA Y DESHIERBE"). */
  readonly encabezado: string
  /** Texto entre paréntesis bajo el encabezado: máquinas declaradas. */
  readonly maquinas: string | null
  readonly obra: string
  readonly localizacion: string
  readonly km: Cifra
  readonly cantidad: Cifra
  readonly unidad: string | null
  readonly pu: Cifra
  readonly importe: Cifra
}

/** Ficha de inventario de una obra de conducción (IO1 canales, IO2 drenes: mismo formato, Anexo 1). Cada dato conserva su celda. */
export interface FichaCanal {
  readonly fila: number
  readonly inventario: string
  readonly nombre: string
  /** Columna C: "Principales", "Secundarios (laterales)"… */
  readonly categoria: string | null
  /** PK normalizado "k+mmm"; null si la celda no se pudo leer. */
  readonly pkInicial: string | null
  readonly pkFinal: string | null
  readonly km: Cifra
  readonly gasto: Cifra
  readonly velocidad: Cifra
  readonly pendiente: Cifra
  readonly area: Cifra
  readonly plantilla: Cifra
  readonly tirante: Cifra
  readonly libreBordo: Cifra
  readonly talud: Cifra
  readonly corona: Cifra
  readonly revestimiento: string | null
  readonly seccion: string | null
  /** Solo IO1 y registros del extractor v4 en adelante: punto inicial con su cadenamiento y coordenadas (cols. D-F). */
  readonly ini?: PuntoCanal
  /** Punto final (cols. G-I). */
  readonly fin?: PuntoCanal
  /** Conteos de estructuras declarados en el tramo (cols. W-AN de IO1). */
  readonly conteos?: ConteosTramo
  /** 'auxiliar' = la fila viene después del reinicio del cadenamiento (su PK es propio del ramal, no del canal principal). */
  readonly ramal?: Ramal
}

/** Ficha de camino (IO3). */
export interface FichaCamino {
  readonly fila: number
  readonly inventario: string
  readonly nombre: string
  readonly pkInicial: string | null
  readonly pkFinal: string | null
  readonly km: Cifra
  readonly servicio: string | null
  /** Ancho de la carpeta de rodamiento (m). */
  readonly ancho: Cifra
  readonly revestimiento: string | null
}

export interface FichasInventario {
  readonly canales: readonly FichaCanal[]
  readonly drenes: readonly FichaCanal[]
  readonly caminos: readonly FichaCamino[]
  /** Estructuras de IO4 (una por obra), con tipo, ubicación y estado de la ubicación. Ausente en registros anteriores al extractor v4. */
  readonly estructuras?: readonly Estructura[]
  /** Edificios y obras dispersas de IO7. */
  readonly edificios?: readonly Edificio[]
  /** Fila 15 de IO1: totales declarados por columna (la suma de las filas de tramos). */
  readonly totalesIO1?: ConteosTramo
  /** Cadenamiento del canal principal en el que nace el ramal auxiliar (se lee del nombre «CANAL AUXILIAR K-68+582»), o null. */
  readonly anclaAuxiliar?: string | null
  /** Defectos de coordenadas, cadenamientos y ramales hallados al leer IO1/IO4/IO7 (nada se corrige: se informa). */
  readonly avisosGeo?: readonly string[]
}

/* ───────────── ubicación: coordenadas y cadenamiento del inventario (extractor v4) ───────────── */

export type Ramal = 'principal' | 'auxiliar'

/**
 * Por qué una coordenada no se pudo usar: 'vacia' (sin dato), 'ilegible' (no es un DMS), 'duplicada' (repite el texto de la otra
 * columna: la latitud trae la longitud o al revés) o 'eje_incorrecto' (la letra del hemisferio no es la de la columna, con otro valor).
 */
export type DefectoCoord = 'vacia' | 'ilegible' | 'duplicada' | 'eje_incorrecto'

export interface CoordenadasLeidas {
  /** Grados decimales (O negativo); null = S/D. Nunca se rellena con 0 ni con el valor de la otra columna. */
  readonly lon: number | null
  readonly lat: number | null
  /** DMS tal como está en la celda (`105°12'35.25"O`), para mostrarlo. */
  readonly lonTexto: string | null
  readonly latTexto: string | null
  readonly defectoLon: DefectoCoord | null
  readonly defectoLat: DefectoCoord | null
}

/** Extremo de un tramo de IO1: cadenamiento (k+mmm, propio del ramal) y coordenadas declaradas. */
export interface PuntoCanal extends CoordenadasLeidas {
  readonly pk: string | null
  /** Celdas de origen, p. ej. `IO1!D16`. */
  readonly refPK: string
  readonly refLon: string
  readonly refLat: string
}

/** Conteos por tipo (columnas W..AM de IO1). null = celda vacía = S/D, nunca 0. */
export interface ConteosTramo {
  readonly porTipo: Readonly<Record<TipoIO1, number | null>>
  /** Columna AN (total del tramo), null si está vacía. */
  readonly total: number | null
}

export type EstadoUbicacion = 'valida' | 'estimada' | 'sin_ubicar'

/**
 * Ubicación resuelta: 'valida' = coordenadas completas declaradas en el inventario; 'estimada' = interpolada sobre el eje del canal
 * con su cadenamiento (se dibuja punteada y rotulada «ubicación estimada»); 'sin_ubicar' = no hay forma honesta de situarla.
 */
export interface UbicacionResuelta {
  readonly estado: EstadoUbicacion
  readonly lon: number | null
  readonly lat: number | null
  /** Por qué no es 'valida' (null si lo es). */
  readonly motivo: string | null
}

export type CategoriaEstructura = 'operacion' | 'proteccion' | 'cruce'

/** Una fila de IO4: una estructura del inventario longitudinal. */
export interface Estructura extends CoordenadasLeidas {
  readonly fila: number
  readonly inventario: string
  /** Nombre de la obra en IO4 (columna C) tal cual, sin espacios sobrantes: el «tipo crudo». */
  readonly tipoCrudo: string
  readonly cadenamientoTexto: string
  /** k+mmm limpio (propio del ramal); null si el cadenamiento es parcial o ilegible. */
  readonly pk: string | null
  readonly pkMetros: number | null
  /** Solo el kilómetro cuando el PK viene truncado (`K-44+`). */
  readonly pkParcialKm: number | null
  readonly motivoPK: string | null
  readonly margen: 'I' | 'D' | null
  readonly notaPK: string | null
  readonly ramal: Ramal
  /** Columna H: Operación / Protección / Cruce; null si no es ninguna. */
  readonly categoria: CategoriaEstructura | null
  readonly correspondencia: string | null
  readonly material: string | null
  readonly tipo: TipoEstructura
  readonly familia: FamiliaId | null
  readonly subtipo: string | null
  readonly ambiguo: boolean
  readonly ubicacion: UbicacionResuelta
  /** Celda del nombre, p. ej. `IO4!C14`. */
  readonly ref: string
  /**
   * Libros de VARIOS canales (p. ej. un módulo): clave normalizada del canal/ramal al que pertenece la obra (columna A de IO4, que se
   * hereda de la fila anterior si está en blanco), igual a `claveCanal(FichaCanal.inventario)`. Cada canal tiene su propio cadenamiento
   * desde 0. Ausente en libros de un solo eje (SRL): ahí el ramal manda.
   */
  readonly canal?: string
  /** El canal viene de una fila anterior (la columna A estaba en blanco). */
  readonly canalHeredado?: boolean
  /** El cadenamiento venía como número (metros desde el origen del canal) y no como «K-km+mmm». */
  readonly pkEnMetros?: boolean
}

/** Una obra de IO7 (edificios, casetas y obras dispersas). */
export interface Edificio extends CoordenadasLeidas {
  readonly fila: number
  readonly inventario: string
  readonly nombre: string
  /** Columna C (texto libre; puede traer el cadenamiento: «K-6+000 Canal Principal»). */
  readonly ubicacionTexto: string
  readonly pk: string | null
  readonly caracteristicas: string | null
  readonly uso: string | null
  readonly areaM2: number | null
  readonly ubicacion: UbicacionResuelta
  readonly ref: string
}

export interface LibroDerivado {
  readonly sha256: string
  readonly moduloNombre: string | null
  readonly ciclo: string | null
  readonly baseValores: 'cache' | 'recalculo-nativo'
  readonly conceptosDiagnostico: readonly string[]
  readonly tramos: readonly TramoDiagnostico[]
  readonly totalesDiagnostico: readonly ConceptoTramo[]
  /** Todas las filas de totales de DIAG-01 (una por bloque). `totalesDiagnostico` es solo la primera. */
  readonly filasTotales: readonly FilaTotalesDiagnostico[]
  readonly necesidades: readonly NecesidadMedia[]
  readonly sumasBloque: readonly SumaBloque[]
  /** "SUMA TOTAL" de 3DN: suma de los bloques; se compara contra Σ sumasBloque en la conciliación. */
  readonly totalGeneral3dn: Cifra | null
  readonly programa: readonly RenglonPrograma[]
  /** Longitud total del inventario propio del libro por red (IO1!J15, IO2!J15, IO3!I15). Un 0 es un dato: la red no existe. */
  readonly inventarioKm: { readonly distribucion: Cifra; readonly drenaje: Cifra; readonly caminos: Cifra }
  /** Fichas de inventario de las que se recalcula el diagnóstico. Vacías en archivos generados con una versión anterior. */
  readonly fichas: FichasInventario
  /** Versión del extractor que produjo este registro: si cambia, el libro se vuelve a leer aunque su SHA-256 no cambie. */
  readonly extractorVersion: number
  /** Lo que no se pudo leer o interpretar; nunca se rellena con ceros. */
  readonly avisos: readonly string[]
}
