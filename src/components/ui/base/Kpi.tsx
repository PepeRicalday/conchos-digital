import { memo, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Insignia } from './Badge';
import { EstadoChip } from '../EstadoChip';
import type { EstadoTipo } from '../../../types/estado';

export type KpiDensidad = 'compacta' | 'normal' | 'tablero';

export interface EstadoKpiProp { tipo: EstadoTipo; texto: string; /** Versión breve para pantallas angostas (solo tablero). */ corto?: string }

export interface KpiProps {
    etiqueta: string;
    /** Valor ya formateado. null = «S/D» (nunca 0). */
    valor: string | null;
    unidad?: string;
    /** Estado textual junto al valor: icono + texto, el color nunca es el único portador. */
    estado?: EstadoKpiProp | null;
    /** Contexto: de dónde sale la cifra o qué significa. Con una lista (`lineas`) se dibuja una línea por elemento. */
    contexto?: ReactNode;
    lineas?: ReactNode[];
    icono?: ReactNode;
    /** Procedencia y antigüedad del dato. */
    fresco?: string | null;
    viejo?: boolean;
    /** Acento superior (variable CSS o color); por defecto solo los estados warn/crit lo muestran. */
    acento?: string;
    aria?: string;
    /** compacta = etiqueta, cifra y nota; normal = tarjeta de página; tablero = celda del Dashboard (container queries). */
    densidad?: KpiDensidad;
    /** Cifra más pequeña para rangos («120 – 340») o textos largos. */
    rango?: boolean;
    /** Tono semántico de la cifra (p. ej. eficiencia ≥ 90 % en verde). El color no es el único canal: úselo con `estado` o texto. */
    tonoValor?: EstadoTipo;
    /** Hace la tarjeta accionable (botón con teclado: Enter y espacio). */
    onActivar?: () => void;
    /** Ayuda al pasar el cursor. */
    ayuda?: string;

    // ── solo densidad «tablero» ──
    id?: string;
    /** Texto en lugar del número (p. ej. un nombre). */
    textoValor?: string;
    /** Infografía; se oculta sola cuando la celda es baja. */
    viz?: ReactNode;
    to?: string;
    destacado?: 'crit' | 'warn' | null;
    /** Fuente en tiempo real: punto de «en vivo» (apagado si el dato está viejo, sin dato o crítico). */
    vivo?: boolean;
    /** Controles interactivos: la celda deja de ser un enlace (un botón dentro de <a> es HTML inválido) y `to` pasa a un enlace explícito. */
    acciones?: ReactNode;
    enlaceTexto?: string;
    /** La celda contiene enlaces propios. */
    enlaceInterno?: boolean;
}

const TONO_ACENTO: Partial<Record<EstadoTipo, string>> = { warn: 'var(--st-warn)', crit: 'var(--st-crit)' };

/**
 * KPI único de la interfaz. Sustituye a TileCifra, KpiTile y a las cifras compactas de Análisis de presa y Cuenca.
 * Tres densidades sobre los mismos datos; S/D explícito; estado con icono y texto.
 */
export const Kpi = memo(function Kpi(p: KpiProps) {
    const densidad = p.densidad ?? 'normal';
    if (densidad === 'tablero') return <KpiTablero {...p} />;

    const acento = p.acento ?? (p.estado ? TONO_ACENTO[p.estado.tipo] : undefined);
    const estilo = acento ? ({ '--acc': acento } as CSSProperties) : undefined;
    const sinDato = p.valor == null || p.valor === 'S/D';
    const cifra = sinDato
        ? <span className="ui-kpi__num ui-kpi__num--sd" aria-label="Sin dato" title={p.ayuda}>S/D</span>
        : <span className={`ui-kpi__num${p.rango ? ' ui-kpi__num--rango' : ''}`} data-tono={p.tonoValor} title={p.ayuda}>{p.valor}{p.unidad && <small>{p.unidad}</small>}</span>;
    const notas = p.lineas && p.lineas.length > 0
        ? <ul className="ui-kpi__lineas">{p.lineas.map((l, i) => <li key={i}>{l}</li>)}</ul>
        : p.contexto ? <span className="ui-kpi__nota">{p.contexto}</span> : null;
    return (
        <article
            className={`ui-kpi ui-kpi--${densidad}${p.onActivar ? ' ui-kpi--accion' : ''}`} style={estilo} data-estado={p.estado?.tipo ?? 'sd'} aria-label={p.aria ?? p.etiqueta}
            role={p.onActivar ? 'button' : densidad === 'compacta' ? 'listitem' : undefined} tabIndex={p.onActivar ? 0 : undefined}
            onClick={p.onActivar} onKeyDown={p.onActivar ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onActivar?.(); } } : undefined}
        >
            <div className="ui-kpi__cab"><span className="ui-kpi__etq">{p.etiqueta}</span>{p.icono}</div>
            {cifra}
            {p.estado && <Insignia tipo={p.estado.tipo}>{p.estado.texto}</Insignia>}
            {notas}
            {p.fresco && <span className={`ui-kpi__fresco${p.viejo ? ' ui-kpi__fresco--viejo' : ''}`}>{p.fresco}</span>}
        </article>
    );
});

/** Celda del Dashboard: conserva el marcado kp-* y sus container queries (KpiPanel.css). */
function KpiTablero({ id, etiqueta, icono, valor, unidad, textoValor, estado, contexto, viz, fresco, viejo, to, aria, destacado, vivo, acciones, enlaceTexto, enlaceInterno }: KpiProps) {
    const est = estado ?? { tipo: 'sd' as const, texto: 'Sin dato' };
    const conAcciones = !!acciones || !!enlaceInterno;
    const cuerpo = (
        <div className="kp-in">
            <div className="kp-cab"><span className="kp-titulo">{etiqueta}</span>{vivo && <span className={`kp-vivo ${viejo || est.tipo === 'sd' || est.tipo === 'crit' ? 'kp-vivo-off' : ''}`} title="Fuente en tiempo real" aria-hidden="true" />}
                {conAcciones && to
                    ? <Link to={to} className="kp-abrir" aria-label={enlaceTexto ?? `Abrir ${etiqueta}`} title={enlaceTexto ?? `Abrir ${etiqueta}`}><span className="kp-icono" aria-hidden="true">{icono}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>
                    : <span className="kp-icono" aria-hidden="true">{icono}</span>}</div>
            <div className="kp-cifra-fila">
                {textoValor ? <div className="kp-cifra kp-cifra-texto">{textoValor}</div>
                    : valor == null ? <div className="kp-cifra kp-cifra-sd" aria-label="Sin dato">S/D</div>
                        : <div className="kp-cifra">{valor}{unidad && <small>{unidad}</small>}</div>}
                <EstadoChip estado={est} />
            </div>
            {acciones && <div className="kp-acciones">{acciones}</div>}
            {viz && <div className="kp-viz">{viz}</div>}
            <div className="kp-contexto">{contexto}</div>
            {fresco && <div className={`kp-fresco ${viejo ? 'kp-viejo' : ''}`}>{fresco}</div>}
        </div>
    );
    const clase = `kp-tile ${destacado ? `kp-dest-${destacado}` : ''}`;
    return to && !conAcciones
        ? <Link to={to} id={id} className={clase} data-estado={est.tipo} aria-label={aria ?? etiqueta}>{cuerpo}</Link>
        : <section id={id} className={clase} data-estado={est.tipo} aria-label={aria ?? etiqueta}>{cuerpo}</section>;
}
