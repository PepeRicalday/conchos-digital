import type { Semaforo } from '../../../utils/aqwpEstadistica';

const GLIFO: Record<string, string> = { critico: '■', bajo: '▲', normal: '●', sd: '◇' };
const ETIQUETA: Record<string, string> = { critico: 'CRÍTICO', bajo: 'BAJO', normal: 'NORMAL', sd: 'S/D' };

/**
 * Semáforo COMBINADO (volumen útil + posición histórica + tendencia). Glifo + texto + color: el color nunca va solo. Convive con
 * el estado por umbrales fijos 20/40 % de la app (presaNiveles.ts); `title` explica de dónde sale el nivel.
 */
export default function SemaforoBadge({ s }: { s: Semaforo }) {
    const motivos = s.motivos.length ? s.motivos.join(' · ') : 'Sin datos suficientes para evaluar';
    return (
        <span className={`cu-sem cu-sem--${s.nivel}`} title={motivos}>
            <span aria-hidden="true">{GLIFO[s.nivel]}</span> {ETIQUETA[s.nivel]}
            {s.calidad === 'sin_actualizar' && <span className="cu-sem-q">· dato sin actualizar</span>}
            <span className="cu-sr">. {motivos}</span>
        </span>
    );
}
