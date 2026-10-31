import { memo } from 'react';
import { Activity, Printer } from 'lucide-react';
import SelectorFecha from '../SelectorFecha';
import { EstadoChip } from '../ui/EstadoChip';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

interface Props {
    veredicto: EstadoKpi;
    detalleVeredicto: string;
    fechaTexto: string;
    esHoy: boolean;
    erroresPagina: string[];
    /** Protocolo operativo activo (p. ej. VACIADO · 32 d abierto): contexto que cambia cómo se leen todos los KPIs. */
    protocolo: EstadoKpi | null;
    /** Estado de cada tarjeta: 10 puntos que dan el pulso del conjunto de un vistazo. */
    pulso: { id: string; nombre: string; tipo: EstadoKpi['tipo'] }[];
    version: string;
    onMonitor: () => void;
    onImprimir: () => void;
}

/** Barra superior de una línea: identidad, veredicto global, fecha y acciones (reemplaza al hero alto y a la top-bar del shell). */
export const BarraCentro = memo(function BarraCentro({ veredicto, detalleVeredicto, fechaTexto, esHoy, erroresPagina, protocolo, pulso, version, onMonitor, onImprimir }: Props) {
    return (
        <header className="kp-barra-centro">
            <div className="kp-bc-id">
                <span className="sc-kicker">Unidad Conchos · DR-005 · v{version}</span>
                <h1 id="sc-hero-t" className="kp-bc-titulo">Centro de control</h1>
            </div>
            <div className="kp-bc-veredicto" role="status" aria-live="polite" title={detalleVeredicto}>
                <EstadoChip estado={veredicto} />
                <span className="kp-bc-detalle">{detalleVeredicto}</span>
            </div>
            <ol className="kp-pulso" aria-label="Estado de cada indicador">
                {pulso.map((p) => <li key={p.id}><span role="img" className={`kp-p-${p.tipo}`} title={`${p.nombre}: ${p.tipo === 'ok' ? 'normal' : p.tipo === 'warn' ? 'atención' : p.tipo === 'crit' ? 'crítico' : p.tipo === 'info' ? 'informativo' : 'sin dato'}`} aria-label={`${p.nombre}: ${p.tipo === 'ok' ? 'normal' : p.tipo === 'warn' ? 'atención' : p.tipo === 'crit' ? 'crítico' : p.tipo === 'info' ? 'informativo' : 'sin dato'}`} /></li>)}
            </ol>
            {protocolo && <div className="kp-bc-protocolo"><EstadoChip estado={protocolo} /></div>}
            <div className="kp-bc-acciones">
                {!esHoy && <span className="kp-bc-fecha" title="Presas y ciclo siguen la fecha elegida; Canal, Clima y Alertas son de ahora">Vista del {fechaTexto}</span>}
                <SelectorFecha />
                <button type="button" className="sc-btn kp-bc-icono" onClick={onMonitor} aria-label="Abrir Monitor Público en una pestaña nueva" title="Monitor Público"><Activity size={18} aria-hidden="true" /></button>
                <button type="button" className="sc-btn kp-bc-icono kp-solo-ancho" onClick={onImprimir} aria-label="Generar reporte digital" title="Generar reporte digital"><Printer size={18} aria-hidden="true" /></button>
            </div>
            {erroresPagina.length > 0 && (
                <p className="kp-bc-error" role="alert">No se pudo leer: {erroresPagina.join(' · ')}. Esas cifras pueden estar incompletas.</p>
            )}
        </header>
    );
});
