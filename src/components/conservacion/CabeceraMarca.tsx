import type { OrigenInforme } from '../../conservacion/informe/esquemaInforme';

/** Barra de identidad institucional: logos de la SRL y de SICA-005 (derivados con fondo transparente, ver Conservacion/Logos/derivados). */
export function CabeceraMarca({ origen, generadoEn }: { origen?: OrigenInforme; generadoEn?: string }) {
    return (
        <div className="cons-marca">
            <div className="cons-marca-logos">
                <img src="/logos/conservacion/logo-srl-claro.png" alt="S R L Unidad Conchos, Delicias" />
                <span className="cons-marca-sep" aria-hidden="true" />
                <img src="/logos/conservacion/sica005-transparente.png" alt="SICA-005, Distrito 005" />
            </div>
            <div className="cons-marca-texto">
                <b>SICA Conservación</b>
                <span>Comprobador técnico de programas de conservación (PacOT)</span>
            </div>
            {origen && (
                <div className="cons-marca-der">
                    <div><b>{origen.moduloNombre ?? 'Módulo sin nombre'}</b>{origen.moduloId ? ` · ${origen.moduloId}` : ''}</div>
                    <div>Ciclo {origen.ciclo ?? 's/d'} · {origen.archivoNombre}</div>
                    {generadoEn && <div>Informe del {new Date(generadoEn).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
                </div>
            )}
        </div>
    );
}
