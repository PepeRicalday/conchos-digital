import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, CircleX, Info } from 'lucide-react';
import type { Cifra } from '../../../conservacion/derivacion/tipos';
import type { EstadoConciliacion } from '../../../conservacion/derivacion/registro';
import type { EstadoVerificacion } from '../../../conservacion/derivacion/vistas';
import type { BaseJuicio, EstadoVerif } from '../../../conservacion/verificacion/tipos';
import {
    describirEstado, desdeConciliacion, desdeVerif, TEXTO_RAZON_ATIPICO, TEXTO_SIN_DATOS_AMBOS,
    type EstadoConMotivo, type RazonAtipico, type TonoEstado,
} from '../../../conservacion/vocabulario';
import { AYUDA_BASE, TEXTO_BASE } from './fmt';

/** Celda de origen + fórmula tal como está en el libro, o si fue capturada o está vacía. */
export function Origen({ cifra }: { cifra: Cifra }) {
    const texto = cifra.origen === 'formula' ? `=${cifra.formula ?? ''}` : cifra.origen === 'capturado' ? 'valor capturado (sin fórmula)' : 'sin dato en la celda';
    return (
        <span className="cons-der-origen">
            <code>{cifra.ref}</code>
            <span className={`cons-der-formula cons-der-${cifra.origen}`}>{texto}</span>
        </span>
    );
}

const ICONO_ESTADO = { CircleCheck, CircleAlert, CircleHelp, Info, CircleDashed, CircleX } as const;
const CLASE_TONO: Readonly<Record<TonoEstado, string>> = {
    ok: 'cons-ins-ok', aviso: 'cons-ins-media', neutro: 'cons-ins-sd', info: 'cons-ins-informativa', alerta: 'cons-ins-alta',
};

/**
 * Insignia del vocabulario único (icono + palabra, nunca solo color). `conMotivo` agrega, para «No evaluable», el
 * porqué como texto visible; en cualquier caso el motivo queda en `title`.
 */
export function InsigniaEstado({ e, conMotivo = false, tono, motivoCorto }: { e: EstadoConMotivo; conMotivo?: boolean; tono?: TonoEstado; motivoCorto?: string | null }) {
    const d = describirEstado(e);
    const Ico = ICONO_ESTADO[d.icono];
    return (
        <span className="cons-ins-estado">
            <span className={`cons-ins ${CLASE_TONO[tono ?? d.tono]}`} title={d.motivo ?? d.larga}><Ico size={13} aria-hidden="true" /> {d.corta}</span>
            {(motivoCorto ?? (conMotivo ? d.motivo : null)) && <small className="cons-ins-motivo">{motivoCorto ?? d.motivo}</small>}
        </span>
    );
}

/** Razón por la que un tramo es atípico (criterio / control adicional / conciliación / regla). */
export function ChipRazon({ razon }: { razon: RazonAtipico }) {
    const t = TEXTO_RAZON_ATIPICO[razon];
    return <span className="cons-der-base" title={t.larga}>{t.corta}</span>;
}

/** `sinDatosAmbos`: la suma de módulos y la SRL valen 0 (o faltan): coincidir ahí no prueba nada. */
export function InsigniaConciliacion({ estado, parcial, sinDatosAmbos = false }: { estado: EstadoConciliacion; parcial: boolean; sinDatosAmbos?: boolean }) {
    // Con módulos por cargar, ni una diferencia ni una coincidencia son concluyentes: se dice «Parcial», nunca verde ni error.
    if (sinDatosAmbos && (estado === 'coincide' || estado === 'incompleto')) return <InsigniaEstado conMotivo e={{ estado: 'no_evaluable', motivo: TEXTO_SIN_DATOS_AMBOS }} />;
    const provisional = parcial && (estado === 'difiere' || estado === 'coincide');
    return <InsigniaEstado e={provisional ? { estado: 'parcial' } : desdeConciliacion(estado)} />;
}

const DE_VERIFICACION: Readonly<Record<EstadoVerificacion, EstadoVerif>> = { coincide: 'cuadra', difiere: 'no_cuadra', no_evaluable: 'no_evaluable' };

export function InsigniaVerificacion({ estado }: { estado: EstadoVerificacion }) {
    return <InsigniaEstado e={desdeVerif(DE_VERIFICACION[estado])} />;
}

/** Estado de un resultado de verificación: icono + texto, nunca solo color. */
export function InsigniaResultado({ estado }: { estado: EstadoVerif }) {
    return <InsigniaEstado e={desdeVerif(estado)} />;
}

export function ChipBase({ base }: { base: BaseJuicio }) {
    return <span className="cons-der-base" title={AYUDA_BASE[base]}>{TEXTO_BASE[base]}</span>;
}
