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

export type HojaOtraObra = 'IO5a' | 'IO5b' | 'IO5c' | 'IO5d' | 'IO6'

/** Una fila de IO5c/IO5d (planta o pozo), una presa de IO5a/IO5b o un renglón de IO6 (equipos de comunicación). */
export interface ObraOtra {
  readonly fila: number
  /** Número de inventario («P1-05», «PB1-05»); null si la hoja no lo trae (presas, comunicaciones). */
  readonly inventario: string | null
  /** Nombre de la obra tal cual está en la celda (puede ser un número, como en los pozos del M5). */
  readonly nombre: string | null
  /** Cuántas piezas cuenta este renglón: 1 por obra; en IO6, el «NÚMERO» de equipos. null = celda sin número. */
  readonly cantidad: number | null
  readonly ref: string
}

/** Inventario de una de las hojas de obras que no son canal, dren ni camino. Lo que falta es null (S/D), nunca 0. */
export interface InventarioOtraObra {
  readonly hoja: HojaOtraObra
  readonly rotulo: string
  /** El formato dice «NO APLICA» y no trae obras. */
  readonly noAplica: boolean
  /** Celda que dice «NO APLICA», si la hay. */
  readonly refNoAplica: string | null
  /** Piezas registradas (suma de `cantidad`); 0 solo cuando la hoja no trae ninguna obra. */
  readonly cantidad: number
  readonly obras: readonly ObraOtra[]
}

export interface FichasInventario {
  readonly canales: readonly FichaCanal[]
  readonly drenes: readonly FichaCanal[]
  readonly caminos: readonly FichaCamino[]
  /** Estructuras de IO4 (una por obra), con tipo, ubicación y estado de la ubicación. Ausente en registros anteriores al extractor v4. */
  readonly estructuras?: readonly Estructura[]
  /** Edificios y obras dispersas de IO7. */
  readonly edificios?: readonly Edificio[]
  /** Hojas de inventario de presas (IO5a, IO5b), plantas de bombeo (IO5c), pozos (IO5d) y red de comunicación (IO6). Ausente en registros anteriores al extractor v7. */
  readonly otrasObras?: readonly InventarioOtraObra[]
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

/** Un renglón del balance de maquinaria (hoja B Maq, parte superior): concepto → cantidad anual → rendimiento → horas → máquinas. */
export type BloqueMaquinaria = 'bombeo' | 'distribucion' | 'drenaje' | 'caminos' | 'parcelario'

export interface RenglonMaquinaria {
  readonly fila: number
  /** Bloque del formato 4 donde está el renglón (lo da el último encabezado «Red de …»); null si no se pudo ubicar. */
  readonly bloque: BloqueMaquinaria | null
  /** Concepto del renglón; si la celda está vacía hereda el del renglón anterior (`conceptoHeredado`). */
  readonly concepto: string | null
  readonly conceptoHeredado: boolean
  readonly unidad: string | null
  readonly cantidad: Cifra
  readonly frecuencia: Cifra
  readonly anual: Cifra
  /** Tipo de máquina tal como lo escribe el libro y su nombre canónico (null si no está en el catálogo). */
  readonly tipo: string
  readonly tipoCanonico: string | null
  readonly rendimiento: Cifra
  readonly horas: Cifra
  readonly horasDisponibles: Cifra
  readonly maquinas: Cifra
}

/** La fila de totales del balance (horas y máquinas) tal como la declara el libro. */
export interface TotalMaquinaria {
  readonly fila: number
  readonly horas: Cifra
  readonly horasDisponibles: Cifra
  readonly maquinas: Cifra
}

/** Una fila de la tabla de balance por tipo de máquina (hoja B Maq, parte inferior). */
export interface FilaBalanceMaquinaria {
  readonly fila: number
  readonly tipo: string
  readonly tipoCanonico: string | null
  readonly necesarias: Cifra
  readonly existentes: Cifra
  readonly faltante: Cifra
  readonly sobrante: Cifra
  readonly buenoRegular: Cifra
  readonly malo: Cifra
  readonly baja: Cifra
  readonly rehabilitacion: Cifra
  readonly disposicion: Cifra
  readonly porFaltante: Cifra
  readonly porSustituir: Cifra
  readonly suma: Cifra
}

export type EstadoMecanico = 'bueno' | 'regular' | 'malo' | 'baja'

/** Una unidad del inventario de maquinaria (hoja IM01, formato CNA-DR-IM-01). */
export interface UnidadMaquinaria {
  readonly fila: number
  readonly tipo: string
  readonly tipoCanonico: string | null
  /** Accesorio o implemento que no es una máquina portadora (p. ej. una desbrozadora): no cuenta como existente. */
  readonly accesorio: boolean
  readonly numeroEconomico: string | null
  readonly marca: string | null
  readonly modelo: string | null
  /** null: sin marca de estado, o con más de una (`estadoConflicto`). */
  readonly estado: EstadoMecanico | null
  readonly estadoConflicto: boolean
  /** Horas trabajadas: número si la celda lo es; si trae texto («171,155 Millas») va en `texto`. */
  readonly horas: Cifra
  /** Unidad real de la lectura cuando no son horas. */
  readonly unidadLectura: 'horas' | 'millas' | 'km' | 'otra' | null
  readonly observaciones: string | null
  readonly ref: string
}

export interface MaquinariaLibro {
  readonly renglones: readonly RenglonMaquinaria[]
  readonly totalRenglones: TotalMaquinaria | null
  readonly balance: readonly FilaBalanceMaquinaria[]
  readonly totalBalance: FilaBalanceMaquinaria | null
  readonly inventario: readonly UnidadMaquinaria[]
  /** false si IM01 no está o no se pudo localizar su tabla: el inventario vacío entonces es S/D, no «cero unidades». */
  readonly inventarioLeido: boolean
  /** Qué columnas de IM01 se localizaron; sin ellas no se señala su ausencia unidad por unidad. */
  readonly columnasInventario: { readonly numeroEconomico: boolean; readonly horas: boolean }
  /** Lo que no se pudo localizar (hoja ausente, rótulos que no están); nunca se rellena con ceros. */
  readonly avisos: readonly string[]
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
  /** Balance e inventario de maquinaria (extractor v8). Ausente en archivos anteriores o si el libro no trae B Maq. */
  readonly maquinaria?: MaquinariaLibro
  /** Versión del extractor que produjo este registro: si cambia, el libro se vuelve a leer aunque su SHA-256 no cambie. */
  readonly extractorVersion: number
  /** Lo que no se pudo leer o interpretar; nunca se rellena con ceros. */
  readonly avisos: readonly string[]
}
