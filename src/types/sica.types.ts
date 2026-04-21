/**
 * Tipos de filas de Supabase para SICA 005.
 *
 * Para tablas en el esquema generado se usan alias de Tables<> para que
 * cualquier cambio en database.types.ts se propague automáticamente.
 * Para tablas aún no incluidas en el esquema generado se definen interfaces
 * manuales derivadas de los campos observados en la aplicación.
 *
 * P2-10: Sustituye el uso de `any[]` en stores y páginas — evita errores
 * silenciosos cuando se renombra un campo en Supabase sin actualizar el UI.
 */

import type { Tables } from './database.types';

// ── Tablas incluidas en el esquema generado ───────────────────────────────────

export type EscalaRow           = Tables<'escalas'>;
export type ModuloRow           = Tables<'modulos'>;
export type PuntoEntregaRow     = Tables<'puntos_entrega'>;
export type AforoControlRow     = Tables<'aforos_control'>;
export type SeccionRow          = Tables<'secciones'>;
export type MedicionRow         = Tables<'mediciones'>;
export type LecturaEscalaRow    = Tables<'lecturas_escalas'>;
export type LecturaPresaRow     = Tables<'lecturas_presas'>;
export type ReporteOperacionRow = Tables<'reportes_operacion'>;
export type ReporteDiarioRow    = Tables<'reportes_diarios'>;
export type ResumenEscalaDiarioRow = Tables<'resumen_escalas_diario'>;
export type AforoRow            = Tables<'aforos'>;
export type ClimaPresaRow       = Tables<'clima_presas'>;
export type PresaRow            = Tables<'presas'>;
export type CurvaCapacidadRow   = Tables<'curvas_capacidad'>;

/**
 * Presa con la relación curvas_capacidad inlineada.
 * Resultado de: supabase.from('presas').select('*, curvas_capacidad (elevacion_msnm, volumen_mm3, area_ha)')
 */
export type PresaConCurva = PresaRow & {
    curvas_capacidad: Pick<CurvaCapacidadRow, 'elevacion_msnm' | 'volumen_mm3' | 'area_ha'>[];
};

// ── Tablas aún no incluidas en el esquema generado ───────────────────────────
// Derivadas de los campos que la aplicación lee/escribe. Actualizar cuando
// se regenere database.types.ts con `supabase gen types typescript`.

export interface MovimientoPresaRow {
    id: string;
    presa_id: string;
    fecha_hora: string;
    gasto_m3s: number;
    fuente_dato: string | null;
}

/** movimientos_presas joined with presas (nombre_corto) */
export type MovimientoPresaConNombreRow = MovimientoPresaRow & {
    presas: { nombre_corto: string | null } | null;
};

export interface RegistroAlertaRow {
    id: string;
    tipo_riesgo: 'critical' | 'warning' | 'info';
    categoria: string;
    titulo: string;
    mensaje: string;
    fecha_deteccion: string;
    resuelta: boolean;
    coordenadas: { lat: number; lng: number } | null;
    origen_id: string | null;
    resuelto_por?: string | null;
    fecha_resolucion?: string | null;
}

export interface AppVersionRow {
    id: string;
    app_id: string;
    version: string;
}

/** Vista: vw_alertas_tomas_varadas */
export interface VwAlertaTomaVaradaRow {
    punto_id: string;
    punto_nombre: string;
    ultimo_estado: string;
    dias_varada: number;
}

export type SicaEventoTipo =
    | 'LLENADO'
    | 'ESTABILIZACION'
    | 'CONTINGENCIA_LLUVIA'
    | 'VACIADO'
    | 'ANOMALIA_BAJA';

export interface SicaEventoLogRow {
    id: string;
    evento_tipo: SicaEventoTipo;
    fecha_inicio: string;
    notas: string | null;
    esta_activo: boolean;
    autorizado_por: string | null;
    gasto_solicitado_m3s: number | null;
    porcentaje_apertura_presa: number | null;
    valvulas_activas: string[] | null;
    hora_apertura_real: string | null;
}

export type SicaLlenadoEstado = 'PENDIENTE' | 'EN_TRANSITO' | 'CONFIRMADO' | 'ESTABILIZADO';

export interface SicaLlenadoSeguimientoRow {
    id: string;
    evento_id: string;
    escala_id: string | null;
    punto_nombre: string;
    km: number;
    orden_secuencial: number;
    hora_estimada_original: string | null;
    segundos_modelo: number | null;
    hora_estimada_actual: string | null;
    recalculado_desde: string | null;
    hora_real: string | null;
    diferencia_minutos: number | null;
    nivel_arribo_m: number | null;
    gasto_paso_m3s: number | null;
    estado: SicaLlenadoEstado;
    notas: string | null;
}

export interface SolicitudRiegoSemanalRow {
    id?: string;
    modulo_id: string;
    fecha_inicio: string;
    fecha_fin: string;
    volumen_solicitado_mm3: number;
}
