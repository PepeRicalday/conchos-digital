export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type Database = {
    // Allows to automatically instantiate createClient with right options
    // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
    __InternalSupabase: {
        PostgrestVersion: "14.1"
    }
    public: {
        Tables: {
            aforos_control: {
                Row: {
                    creado_en: string | null
                    escala: number | null
                    fecha: string
                    gasto_m3s: number | null
                    id: string
                    nombre_punto: string
                }
                Insert: {
                    creado_en?: string | null
                    escala?: number | null
                    fecha: string
                    gasto_m3s?: number | null
                    id: string
                    nombre_punto: string
                }
                Update: {
                    creado_en?: string | null
                    escala?: number | null
                    fecha?: string
                    gasto_m3s?: number | null
                    id?: string
                    nombre_punto?: string
                }
                Relationships: []
            }
            autorizaciones_ciclo: {
                Row: {
                    caudal_max: number | null
                    ciclo_id: string
                    creado_en: string | null
                    id: string
                    modulo_id: string
                    notas: string | null
                    vol_autorizado: number
                }
                Insert: {
                    caudal_max?: number | null
                    ciclo_id: string
                    creado_en?: string | null
                    id: string
                    modulo_id: string
                    notas?: string | null
                    vol_autorizado?: number
                }
                Update: {
                    caudal_max?: number | null
                    ciclo_id?: string
                    creado_en?: string | null
                    id?: string
                    modulo_id?: string
                    notas?: string | null
                    vol_autorizado?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "autorizaciones_ciclo_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "autorizaciones_ciclo_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                    {
                        foreignKeyName: "autorizaciones_ciclo_modulo_id_fkey"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "modulos"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "autorizaciones_ciclo_modulo_id_fkey"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "reportes_diarios"
                        referencedColumns: ["modulo_id"]
                    },
                    {
                        foreignKeyName: "autorizaciones_ciclo_modulo_id_fkey"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["modulo_id"]
                    },
                    {
                        foreignKeyName: "autorizaciones_ciclo_modulo_id_fkey"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "volumenes_diarios_modulo"
                        referencedColumns: ["modulo_id"]
                    },
                ]
            }
            canales: {
                Row: {
                    capacidad_diseno: number
                    id: string
                    longitud_total_km: number | null
                    nombre: string
                }
                Insert: {
                    capacidad_diseno: number
                    id: string
                    longitud_total_km?: number | null
                    nombre: string
                }
                Update: {
                    capacidad_diseno?: number
                    id?: string
                    longitud_total_km?: number | null
                    nombre?: string
                }
                Relationships: []
            }
            ciclos_agricolas: {
                Row: {
                    activo: boolean
                    clave: string
                    creado_en: string | null
                    fecha_fin: string
                    fecha_inicio: string
                    id: string
                    nombre: string
                    notas: string | null
                }
                Insert: {
                    activo?: boolean
                    clave: string
                    creado_en?: string | null
                    fecha_fin: string
                    fecha_inicio: string
                    id: string
                    nombre: string
                    notas?: string | null
                }
                Update: {
                    activo?: boolean
                    clave?: string
                    creado_en?: string | null
                    fecha_fin?: string
                    fecha_inicio?: string
                    id?: string
                    nombre?: string
                    notas?: string | null
                }
                Relationships: []
            }
            clima_presas: {
                Row: {
                    ciclo_id: string | null
                    creado_en: string | null
                    dir_viento: string | null
                    dir_viento_24h: string | null
                    edo_tiempo: string | null
                    edo_tiempo_24h: string | null
                    evaporacion_mm: number | null
                    fecha: string
                    id: string
                    intensidad_24h: number | null
                    intensidad_viento: number | null
                    precipitacion_mm: number | null
                    presa_id: string
                    temp_ambiente_c: number | null
                    temp_maxima_c: number | null
                    temp_minima_c: number | null
                    visibilidad: number | null
                }
                Insert: {
                    ciclo_id?: string | null
                    creado_en?: string | null
                    dir_viento?: string | null
                    dir_viento_24h?: string | null
                    edo_tiempo?: string | null
                    edo_tiempo_24h?: string | null
                    evaporacion_mm?: number | null
                    fecha: string
                    id: string
                    intensidad_24h?: number | null
                    intensidad_viento?: number | null
                    precipitacion_mm?: number | null
                    presa_id: string
                    temp_ambiente_c?: number | null
                    temp_maxima_c?: number | null
                    temp_minima_c?: number | null
                    visibilidad?: number | null
                }
                Update: {
                    ciclo_id?: string | null
                    creado_en?: string | null
                    dir_viento?: string | null
                    dir_viento_24h?: string | null
                    edo_tiempo?: string | null
                    edo_tiempo_24h?: string | null
                    evaporacion_mm?: number | null
                    fecha?: string
                    id?: string
                    intensidad_24h?: number | null
                    intensidad_viento?: number | null
                    precipitacion_mm?: number | null
                    presa_id?: string
                    temp_ambiente_c?: number | null
                    temp_maxima_c?: number | null
                    temp_minima_c?: number | null
                    visibilidad?: number | null
                }
                Relationships: [
                    {
                        foreignKeyName: "clima_presas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "clima_presas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                    {
                        foreignKeyName: "clima_presas_presa_id_fkey"
                        columns: ["presa_id"]
                        isOneToOne: false
                        referencedRelation: "presas"
                        referencedColumns: ["id"]
                    },
                ]
            }
            curvas_capacidad: {
                Row: {
                    area_ha: number
                    elevacion_msnm: number
                    id: string
                    presa_id: string
                    volumen_mm3: number
                }
                Insert: {
                    area_ha: number
                    elevacion_msnm: number
                    id: string
                    presa_id: string
                    volumen_mm3: number
                }
                Update: {
                    area_ha?: number
                    elevacion_msnm?: number
                    id?: string
                    presa_id?: string
                    volumen_mm3?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "curvas_capacidad_presa_id_fkey"
                        columns: ["presa_id"]
                        isOneToOne: false
                        referencedRelation: "presas"
                        referencedColumns: ["id"]
                    },
                ]
            }
            escalas: {
                Row: {
                    activa: boolean
                    canal_id: string | null
                    capacidad_max: number
                    creado_en: string | null
                    id: string
                    km: number
                    latitud: number | null
                    longitud: number | null
                    nivel_max_operativo: number
                    nivel_min_operativo: number
                    nombre: string
                    seccion_id: string | null
                }
                Insert: {
                    activa?: boolean
                    canal_id?: string | null
                    capacidad_max?: number
                    creado_en?: string | null
                    id: string
                    km: number
                    latitud?: number | null
                    longitud?: number | null
                    nivel_max_operativo?: number
                    nivel_min_operativo?: number
                    nombre: string
                    seccion_id?: string | null
                }
                Update: {
                    activa?: boolean
                    canal_id?: string | null
                    capacidad_max?: number
                    creado_en?: string | null
                    id?: string
                    km?: number
                    latitud?: number | null
                    longitud?: number | null
                    nivel_max_operativo?: number
                    nivel_min_operativo?: number
                    nombre?: string
                    seccion_id?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "escalas_canal_id_fkey"
                        columns: ["canal_id"]
                        isOneToOne: false
                        referencedRelation: "canales"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "escalas_seccion_id_fkey"
                        columns: ["seccion_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_escalas_diario"
                        referencedColumns: ["seccion_id"]
                    },
                    {
                        foreignKeyName: "escalas_seccion_id_fkey"
                        columns: ["seccion_id"]
                        isOneToOne: false
                        referencedRelation: "secciones"
                        referencedColumns: ["id"]
                    },
                ]
            }
            lecturas_escalas: {
                Row: {
                    ciclo_id: string | null
                    creado_en: string | null
                    escala_id: string
                    fecha: string
                    hora_lectura: string | null
                    id: string
                    nivel_m: number
                    notas: string | null
                    responsable: string | null
                    turno: Database["public"]["Enums"]["turno_lectura"]
                }
                Insert: {
                    ciclo_id?: string | null
                    creado_en?: string | null
                    escala_id: string
                    fecha: string
                    hora_lectura?: string | null
                    id: string
                    nivel_m: number
                    notas?: string | null
                    responsable?: string | null
                    turno: Database["public"]["Enums"]["turno_lectura"]
                }
                Update: {
                    ciclo_id?: string | null
                    creado_en?: string | null
                    escala_id?: string
                    fecha?: string
                    hora_lectura?: string | null
                    id?: string
                    nivel_m?: number
                    notas?: string | null
                    responsable?: string | null
                    turno?: Database["public"]["Enums"]["turno_lectura"]
                }
                Relationships: [
                    {
                        foreignKeyName: "lecturas_escalas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "lecturas_escalas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                    {
                        foreignKeyName: "lecturas_escalas_escala_id_fkey"
                        columns: ["escala_id"]
                        isOneToOne: false
                        referencedRelation: "escalas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "lecturas_escalas_escala_id_fkey"
                        columns: ["escala_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_escalas_diario"
                        referencedColumns: ["escala_id"]
                    },
                ]
            }
            lecturas_presas: {
                Row: {
                    almacenamiento_mm3: number | null
                    area_ha: number | null
                    ciclo_id: string | null
                    creado_en: string | null
                    escala_msnm: number | null
                    extraccion_total_m3s: number | null
                    fecha: string
                    gasto_cfe_m3s: number | null
                    gasto_toma_baja_m3s: number | null
                    gasto_toma_der_m3s: number | null
                    gasto_toma_izq_m3s: number | null
                    id: string
                    notas: string | null
                    porcentaje_llenado: number | null
                    presa_id: string
                    responsable: string | null
                }
                Insert: {
                    almacenamiento_mm3?: number | null
                    area_ha?: number | null
                    ciclo_id?: string | null
                    creado_en?: string | null
                    escala_msnm?: number | null
                    extraccion_total_m3s?: number | null
                    fecha: string
                    gasto_cfe_m3s?: number | null
                    gasto_toma_baja_m3s?: number | null
                    gasto_toma_der_m3s?: number | null
                    gasto_toma_izq_m3s?: number | null
                    id: string
                    notas?: string | null
                    porcentaje_llenado?: number | null
                    presa_id: string
                    responsable?: string | null
                }
                Update: {
                    almacenamiento_mm3?: number | null
                    area_ha?: number | null
                    ciclo_id?: string | null
                    creado_en?: string | null
                    escala_msnm?: number | null
                    extraccion_total_m3s?: number | null
                    fecha?: string
                    gasto_cfe_m3s?: number | null
                    gasto_toma_baja_m3s?: number | null
                    gasto_toma_der_m3s?: number | null
                    gasto_toma_izq_m3s?: number | null
                    id?: string
                    notas?: string | null
                    porcentaje_llenado?: number | null
                    presa_id?: string
                    responsable?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "lecturas_presas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "lecturas_presas_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                    {
                        foreignKeyName: "lecturas_presas_presa_id_fkey"
                        columns: ["presa_id"]
                        isOneToOne: false
                        referencedRelation: "presas"
                        referencedColumns: ["id"]
                    },
                ]
            }
            mediciones: {
                Row: {
                    ciclo_id: string | null
                    fecha_hora: string
                    id: string
                    notas: string | null
                    punto_id: string | null
                    tipo_ubicacion: string | null
                    usuario_id: string | null
                    valor_q: number
                    valor_vol: number | null
                }
                Insert: {
                    ciclo_id?: string | null
                    fecha_hora?: string
                    id: string
                    notas?: string | null
                    punto_id?: string | null
                    tipo_ubicacion?: string | null
                    usuario_id?: string | null
                    valor_q: number
                    valor_vol?: number | null
                }
                Update: {
                    ciclo_id?: string | null
                    fecha_hora?: string
                    id?: string
                    notas?: string | null
                    punto_id?: string | null
                    tipo_ubicacion?: string | null
                    usuario_id?: string | null
                    valor_q?: number
                    valor_vol?: number | null
                }
                Relationships: [
                    {
                        foreignKeyName: "fk_mediciones_puntos_entrega"
                        columns: ["punto_id"]
                        isOneToOne: false
                        referencedRelation: "puntos_entrega"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "fk_mediciones_usuario"
                        columns: ["usuario_id"]
                        isOneToOne: false
                        referencedRelation: "perfiles"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "mediciones_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "mediciones_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                ]
            }
            modulos: {
                Row: {
                    caudal_objetivo: number | null
                    codigo_corto: string | null
                    id: string
                    logo_url: string | null
                    nombre: string
                    nombre_acu: string | null
                    vol_acumulado: number | null
                    vol_autorizado: number | null
                }
                Insert: {
                    caudal_objetivo?: number | null
                    codigo_corto?: string | null
                    id: string
                    logo_url?: string | null
                    nombre: string
                    nombre_acu?: string | null
                    vol_acumulado?: number | null
                    vol_autorizado?: number | null
                }
                Update: {
                    caudal_objetivo?: number | null
                    codigo_corto?: string | null
                    id?: string
                    logo_url?: string | null
                    nombre?: string
                    nombre_acu?: string | null
                    vol_acumulado?: number | null
                    vol_autorizado?: number | null
                }
                Relationships: []
            }
            perfiles: {
                Row: {
                    correo: string | null
                    creado_en: string
                    id: string
                    modulo_id: string | null
                    nombre_completo: string | null
                    rol: string | null
                }
                Insert: {
                    correo?: string | null
                    creado_en?: string
                    id: string
                    modulo_id?: string | null
                    nombre_completo?: string | null
                    rol?: string | null
                }
                Update: {
                    correo?: string | null
                    creado_en?: string
                    id?: string
                    modulo_id?: string | null
                    nombre_completo?: string | null
                    rol?: string | null
                }
                Relationships: []
            }
            presas: {
                Row: {
                    actualizado_en: string | null
                    capacidad_actual: number
                    capacidad_max: number
                    codigo: string
                    elevacion_corona_msnm: number | null
                    id: string
                    latitud: number | null
                    longitud: number | null
                    municipio: string | null
                    nivel_actual: number
                    nombre: string
                    nombre_corto: string | null
                    rio: string | null
                    tasa_extraccion: number | null
                    tipo_cortina: string | null
                }
                Insert: {
                    actualizado_en?: string | null
                    capacidad_actual: number
                    capacidad_max: number
                    codigo: string
                    elevacion_corona_msnm?: number | null
                    id: string
                    latitud?: number | null
                    longitud?: number | null
                    municipio?: string | null
                    nivel_actual: number
                    nombre: string
                    nombre_corto?: string | null
                    rio?: string | null
                    tasa_extraccion?: number | null
                    tipo_cortina?: string | null
                }
                Update: {
                    actualizado_en?: string | null
                    capacidad_actual?: number
                    capacidad_max?: number
                    codigo?: string
                    elevacion_corona_msnm?: number | null
                    id?: string
                    latitud?: number | null
                    longitud?: number | null
                    municipio?: string | null
                    nivel_actual?: number
                    nombre?: string
                    nombre_corto?: string | null
                    rio?: string | null
                    tasa_extraccion?: number | null
                    tipo_cortina?: string | null
                }
                Relationships: []
            }
            puntos_entrega: {
                Row: {
                    capacidad_max: number
                    coords_x: number | null
                    coords_y: number | null
                    id: string
                    km: number | null
                    modulo_id: string | null
                    nombre: string
                    seccion_id: string | null
                    seccion_texto: string | null
                    tipo: string | null
                    zona: string | null
                }
                Insert: {
                    capacidad_max: number
                    coords_x?: number | null
                    coords_y?: number | null
                    id: string
                    km?: number | null
                    modulo_id?: string | null
                    nombre: string
                    seccion_id?: string | null
                    seccion_texto?: string | null
                    tipo?: string | null
                    zona?: string | null
                }
                Update: {
                    capacidad_max?: number
                    coords_x?: number | null
                    coords_y?: number | null
                    id?: string
                    km?: number | null
                    modulo_id?: string | null
                    nombre?: string
                    seccion_id?: string | null
                    seccion_texto?: string | null
                    tipo?: string | null
                    zona?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "fk_puntos_entrega_modulo"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "modulos"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "fk_puntos_entrega_modulo"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "reportes_diarios"
                        referencedColumns: ["modulo_id"]
                    },
                    {
                        foreignKeyName: "fk_puntos_entrega_modulo"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["modulo_id"]
                    },
                    {
                        foreignKeyName: "fk_puntos_entrega_modulo"
                        columns: ["modulo_id"]
                        isOneToOne: false
                        referencedRelation: "volumenes_diarios_modulo"
                        referencedColumns: ["modulo_id"]
                    },
                    {
                        foreignKeyName: "puntos_entrega_seccion_id_fkey"
                        columns: ["seccion_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_escalas_diario"
                        referencedColumns: ["seccion_id"]
                    },
                    {
                        foreignKeyName: "puntos_entrega_seccion_id_fkey"
                        columns: ["seccion_id"]
                        isOneToOne: false
                        referencedRelation: "secciones"
                        referencedColumns: ["id"]
                    },
                ]
            }
            reportes_operacion: {
                Row: {
                    actualizado_en: string | null
                    caudal_maximo: number | null
                    caudal_promedio: number | null
                    ciclo_id: string | null
                    creado_en: string | null
                    estado: Database["public"]["Enums"]["estado_reporte"]
                    fecha: string
                    hora_apertura: string | null
                    hora_cierre: string | null
                    id: string
                    notas: string | null
                    num_mediciones: number | null
                    punto_id: string | null
                    volumen_acumulado: number | null
                }
                Insert: {
                    actualizado_en?: string | null
                    caudal_maximo?: number | null
                    caudal_promedio?: number | null
                    ciclo_id?: string | null
                    creado_en?: string | null
                    estado?: Database["public"]["Enums"]["estado_reporte"]
                    fecha: string
                    hora_apertura?: string | null
                    hora_cierre?: string | null
                    id: string
                    notas?: string | null
                    num_mediciones?: number | null
                    punto_id?: string | null
                    volumen_acumulado?: number | null
                }
                Update: {
                    actualizado_en?: string | null
                    caudal_maximo?: number | null
                    caudal_promedio?: number | null
                    ciclo_id?: string | null
                    creado_en?: string | null
                    estado?: Database["public"]["Enums"]["estado_reporte"]
                    fecha?: string
                    hora_apertura?: string | null
                    hora_cierre?: string | null
                    id?: string
                    notas?: string | null
                    num_mediciones?: number | null
                    punto_id?: string | null
                    volumen_acumulado?: number | null
                }
                Relationships: [
                    {
                        foreignKeyName: "reportes_operacion_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "ciclos_agricolas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "reportes_operacion_ciclo_id_fkey"
                        columns: ["ciclo_id"]
                        isOneToOne: false
                        referencedRelation: "resumen_ciclo"
                        referencedColumns: ["ciclo_id"]
                    },
                    {
                        foreignKeyName: "reportes_operacion_punto_id_fkey"
                        columns: ["punto_id"]
                        isOneToOne: false
                        referencedRelation: "puntos_entrega"
                        referencedColumns: ["id"]
                    },
                ]
            }
            secciones: {
                Row: {
                    color: string | null
                    creado_en: string | null
                    id: string
                    km_fin: number
                    km_inicio: number
                    nombre: string
                }
                Insert: {
                    color?: string | null
                    creado_en?: string | null
                    id: string
                    km_fin: number
                    km_inicio: number
                    nombre: string
                }
                Update: {
                    color?: string | null
                    creado_en?: string | null
                    id?: string
                    km_fin?: number
                    km_inicio?: number
                    nombre?: string
                }
                Relationships: []
            }
        }
        Views: {
            reportes_diarios: {
                Row: {
                    caudal_maximo: number | null
                    caudal_promedio_lps: number | null
                    caudal_promedio_m3s: number | null
                    estado: Database["public"]["Enums"]["estado_reporte"] | null
                    fecha: string | null
                    hora_apertura: string | null
                    hora_cierre: string | null
                    id: string | null
                    modulo_id: string | null
                    modulo_nombre: string | null
                    notas: string | null
                    num_mediciones: number | null
                    punto_id: string | null
                    punto_nombre: string | null
                    volumen_total_mm3: number | null
                }
                Relationships: [
                    {
                        foreignKeyName: "reportes_operacion_punto_id_fkey"
                        columns: ["punto_id"]
                        isOneToOne: false
                        referencedRelation: "puntos_entrega"
                        referencedColumns: ["id"]
                    },
                ]
            }
            resumen_ciclo: {
                Row: {
                    activo: boolean | null
                    caudal_max_m3s: number | null
                    caudal_maximo_m3s: number | null
                    caudal_promedio_m3s: number | null
                    ciclo_clave: string | null
                    ciclo_id: string | null
                    ciclo_nombre: string | null
                    codigo_corto: string | null
                    dias_operacion: number | null
                    dias_restantes: number | null
                    dias_transcurridos: number | null
                    fecha_fin: string | null
                    fecha_inicio: string | null
                    modulo_id: string | null
                    modulo_nombre: string | null
                    porcentaje_consumido: number | null
                    total_mediciones: number | null
                    vol_autorizado_mm3: number | null
                    volumen_entregado_mm3: number | null
                }
                Relationships: []
            }
            resumen_escalas_diario: {
                Row: {
                    capacidad_max: number | null
                    delta_12h: number | null
                    escala_id: string | null
                    estado: string | null
                    fecha: string | null
                    hora_am: string | null
                    hora_pm: string | null
                    km: number | null
                    lectura_am: number | null
                    lectura_pm: number | null
                    nivel_actual: number | null
                    nivel_max_operativo: number | null
                    nivel_min_operativo: number | null
                    nombre: string | null
                    seccion_color: string | null
                    seccion_id: string | null
                    seccion_nombre: string | null
                }
                Relationships: []
            }
            volumenes_diarios_modulo: {
                Row: {
                    caudal_promedio_lps: number | null
                    codigo_corto: string | null
                    fecha: string | null
                    modulo_id: string | null
                    modulo_nombre: string | null
                    porcentaje_consumido: number | null
                    puntos_activos: number | null
                    total_mediciones: number | null
                    volumen_acumulado_mm3: number | null
                    volumen_autorizado_mm3: number | null
                    volumen_dia_mm3: number | null
                }
                Relationships: []
            }
        }
        Functions: {
            fn_cerrar_reporte: {
                Args: { p_fecha: string; p_notas: string; p_punto_id: string }
                Returns: undefined
            }
            fn_ciclo_por_fecha: { Args: { p_fecha: string }; Returns: string }
            fn_recalcular_vol_acumulado: { Args: never; Returns: undefined }
            verificar_acceso_usuario: {
                Args: { modulo_objetivo_id: string }
                Returns: boolean
            }
        }
        Enums: {
            estado_reporte:
            | "inicio"
            | "suspension"
            | "reabierto"
            | "cierre"
            | "continua"
            | "modificacion"
            turno_lectura: "am" | "pm"
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
    DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
    }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
}
    ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
            Row: infer R
        }
    ? R
    : never
    : never

export type TablesInsert<
    DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
    }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
}
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Insert: infer I
    }
    ? I
    : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
    }
    ? I
    : never
    : never

export type TablesUpdate<
    DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
    }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
}
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Update: infer U
    }
    ? U
    : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
    }
    ? U
    : never
    : never

export type Enums<
    DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
    EnumName extends DefaultSchemaEnumNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
    }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
}
    ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
    : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals
    }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
}
    ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
    public: {
        Enums: {
            estado_reporte: [
                "inicio",
                "suspension",
                "reabierto",
                "cierre",
                "continua",
                "modificacion",
            ],
            turno_lectura: ["am", "pm"],
        },
    },
} as const
