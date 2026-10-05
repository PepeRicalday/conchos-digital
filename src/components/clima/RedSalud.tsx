import { CheckCircle2, Clock, WifiOff, AlertTriangle } from 'lucide-react';
import { ETIQUETA_ESTADO, fraseRed, resumenRed, textoEdad, type EstacionSalud, type EstadoRed } from '../../utils/saludRed';

const ICONO: Record<EstadoRed, typeof CheckCircle2> = { VIGENTE: CheckCircle2, RETRASADA: Clock, 'SIN_SEÑAL': WifiOff };
const ROL: Record<string, string> = { presa: 'Presa', modulo: 'Módulo', canal: 'Canal', unidad_riego: 'Unidad de riego' };

/** Tira de 24 bloques de 2 h (48 h): relleno = hubo lectura; hueco = no. Más antiguo a la izquierda. */
function TiraCobertura({ bloques, nombre }: { bloques: boolean[]; nombre: string }) {
    const con = bloques.filter(Boolean).length;
    return (
        <div className="cl-tira" role="img" aria-label={`${nombre}: lecturas en ${con} de ${bloques.length} bloques de 2 horas en las últimas 48 horas`}>
            {bloques.map((ok, i) => <span key={i} className={ok ? 'cl-tira-ok' : 'cl-tira-hueco'} />)}
        </div>
    );
}

interface Props {
    estaciones: EstacionSalud[];
    cargado: boolean;
    error: string | null;
    onAbrir: (id: string) => void;
}

export function RedSalud({ estaciones, cargado, error, onAbrir }: Props) {
    const resumen = resumenRed(estaciones);
    return (
        <section className="cl-seccion" aria-labelledby="cl-red-t">
            <header className="cl-seccion-cab">
                <div>
                    <span className="cl-kicker">Salud de la red</span>
                    <h3 id="cl-red-t">Estaciones meteorológicas</h3>
                </div>
                <div className="cl-seccion-cifra">
                    <b>{resumen.coberturaMediaPct != null ? `${resumen.coberturaMediaPct.toFixed(0)}%` : 'S/D'}</b>
                    <span>cobertura 48 h</span>
                </div>
            </header>
            <p className="cl-frase" role="status">{cargado ? fraseRed(resumen) : 'Consultando la red…'}</p>
            {error && <p className="cl-aviso cl-aviso-crit"><AlertTriangle size={14} /> No se pudo leer la salud de la red: {error}</p>}
            <div className="cl-red-grid">
                {estaciones.map((s) => {
                    const Ico = ICONO[s.estado];
                    return (
                        <button key={s.id} type="button" className={`cl-est cl-est-${s.estado.toLowerCase().replace('ñ', 'n')}`} onClick={() => onAbrir(s.id)}
                            aria-label={`${s.nombre}: ${ETIQUETA_ESTADO[s.estado]}, última lectura ${textoEdad(s.edadMin)}. Abrir detalle`}>
                            <div className="cl-est-top">
                                <div>
                                    <span className="cl-est-nombre">{s.nombre}</span>
                                    <span className="cl-est-rol">{ROL[s.rol ?? ''] ?? s.rol ?? 'Estación'}{s.moduloId ? ` · ${s.moduloId}` : ''}</span>
                                </div>
                                <span className="cl-chip"><Ico size={13} aria-hidden="true" />{ETIQUETA_ESTADO[s.estado]}</span>
                            </div>
                            <TiraCobertura bloques={s.bloques} nombre={s.nombre} />
                            <div className="cl-est-pie">
                                <span>Última lectura <b>{textoEdad(s.edadMin)}</b></span>
                                <span>Cobertura <b>{s.coberturaPct != null ? `${s.coberturaPct.toFixed(0)}%` : 'S/D'}</b></span>
                                <span>Hueco máx. 7 d <b>{s.huecoMaxH != null ? `${s.huecoMaxH.toFixed(1)} h` : 'S/D'}</b></span>
                            </div>
                            {s.sospechosa && (
                                <p className="cl-aviso cl-aviso-warn">
                                    <AlertTriangle size={13} /> Lectura sospechosa
                                    {s.desviacionTempC != null ? ` (${s.desviacionTempC > 0 ? '+' : ''}${s.desviacionTempC.toFixed(1)} °C vs. la red)` : ''}: no alimenta las alertas.
                                </p>
                            )}
                        </button>
                    );
                })}
            </div>
            <p className="cl-pie">Cada bloque equivale a 2 h (ciclo de sincronización de WeatherLink); izquierda = más antiguo. Vigente ≤ 2.5 h · retrasada ≤ 6 h.</p>
        </section>
    );
}
