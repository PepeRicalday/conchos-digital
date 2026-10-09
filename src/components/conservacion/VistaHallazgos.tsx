import { useMemo, useState } from 'react';
import type { Severidad } from '../../conservacion/nucleo';
import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import {
    filtrarHallazgos, hallazgosPlanos, TEXTO_EVIDENCIA, TEXTO_ORIGEN, TEXTO_SEVERIDAD, type FiltrosHallazgos, type HallazgoVista,
} from '../../conservacion/informe/vistas';
import { InsigniaSeveridad } from './Insignias';

const PAGINA = 40;
const SEVERIDADES: readonly Severidad[] = ['alta', 'media', 'informativa'];

function Tarjeta({ h }: { h: HallazgoVista }) {
    const dims = Object.entries(h.dimensiones);
    return (
        <li>
            <details className={`cons-h cons-h-${h.severidad}`}>
                <summary>
                    <span className="cons-h-fila">
                        <InsigniaSeveridad severidad={h.severidad} />
                        <span className="cons-ins">{h.reglaId}</span>
                        <span className="cons-ins">{TEXTO_ORIGEN[h.origen] ?? h.origen}</span>
                    </span>
                    <p className="cons-h-tit">{h.titulo}</p>
                    <span className="cons-h-id">{h.referencias.slice(0, 3).join(' · ')}{h.referencias.length > 3 ? ` · +${h.referencias.length - 3}` : ''}</span>
                </summary>
                <div className="cons-h-cuerpo">
                    <p>{h.detalle}</p>
                    {(h.esperado !== undefined || h.observado !== undefined || h.diferencia !== undefined) && (
                        <dl className="cons-cmp">
                            <div><dt>Esperado</dt><dd>{h.esperado ?? 'S/D'}</dd></div>
                            <div><dt>Observado</dt><dd>{h.observado ?? 'S/D'}</dd></div>
                            <div><dt>Diferencia</dt><dd>{h.diferencia ?? 'S/D'}</dd></div>
                        </dl>
                    )}
                    {h.referencias.length > 0 && (
                        <div>
                            <span className="cons-etiqueta">Celdas del libro</span>
                            <ul className="cons-refs" style={{ marginTop: 6 }}>{h.referencias.map((r) => <li key={r}>{r}</li>)}</ul>
                        </div>
                    )}
                    <dl className="cons-meta">
                        <dt>Identificador</dt><dd className="cons-h-id">{h.id}</dd>
                        <dt>Clase</dt><dd>{h.clase}</dd>
                        <dt>Evidencia</dt><dd>{TEXTO_EVIDENCIA[h.estadoEvidencia] ?? h.estadoEvidencia}</dd>
                        {dims.length > 0 && <><dt>Dimensiones</dt><dd>{dims.map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd></>}
                        {h.fuentes.length > 0 && <><dt>Fuente</dt><dd>{h.fuentes.map((f) => `${f.documento} ${f.seccion}`).join('; ')}</dd></>}
                        {h.parametrosUsados.length > 0 && <><dt>Parámetros</dt><dd>{h.parametrosUsados.map((p) => `${p.id} = ${p.valor}`).join('; ')}</dd></>}
                        {h.limites.length > 0 && <><dt>Límites</dt><dd>{h.limites.join(' ')}</dd></>}
                    </dl>
                </div>
            </details>
        </li>
    );
}

interface Props { archivo: ArchivoInforme; reglaInicial?: string }

export function VistaHallazgos({ archivo, reglaInicial = '' }: Props) {
    const todos = useMemo(() => hallazgosPlanos(archivo), [archivo]);
    const [f, setF] = useState<FiltrosHallazgos>({ severidades: new Set(), clase: '', origen: '', regla: reglaInicial, texto: '' });
    const [limite, setLimite] = useState(PAGINA);
    const clases = useMemo(() => [...new Set(todos.map((h) => h.clase))].sort(), [todos]);
    const reglas = useMemo(() => [...new Set(todos.map((h) => h.reglaId))].sort(), [todos]);
    const visibles = useMemo(() => filtrarHallazgos(todos, f), [todos, f]);
    const cambia = (p: Partial<FiltrosHallazgos>) => { setF({ ...f, ...p }); setLimite(PAGINA); };
    const alternar = (s: Severidad) => { const n = new Set(f.severidades); if (n.has(s)) n.delete(s); else n.add(s); cambia({ severidades: n }); };
    const cuenta = (s: Severidad) => todos.filter((h) => h.severidad === s).length;

    return (
        <section className="sc-card" aria-labelledby="cons-h-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">Resultados del comprobador</span><h3 id="cons-h-t" style={{ marginBottom: 0 }}>Hallazgos</h3></div>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <span className="cons-etiqueta" id="cons-sev-et">Severidad</span>
                    <div className="cons-sev-grupo" role="group" aria-labelledby="cons-sev-et">
                        {SEVERIDADES.map((s) => (
                            <button key={s} type="button" className="cons-sev-btn" aria-pressed={f.severidades.has(s)} onClick={() => alternar(s)}>
                                {TEXTO_SEVERIDAD[s]} <small>{cuenta(s)}</small>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="sc-campo"><label htmlFor="cons-f-clase">Clase</label>
                    <select id="cons-f-clase" value={f.clase} onChange={(e) => cambia({ clase: e.target.value })}><option value="">Todas</option>{clases.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                <div className="sc-campo"><label htmlFor="cons-f-origen">Origen</label>
                    <select id="cons-f-origen" value={f.origen} onChange={(e) => cambia({ origen: e.target.value })}><option value="">Todos</option>{Object.entries(TEXTO_ORIGEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="sc-campo"><label htmlFor="cons-f-regla">Regla</label>
                    <select id="cons-f-regla" value={f.regla} onChange={(e) => cambia({ regla: e.target.value })}><option value="">Todas</option>{reglas.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
                <div className="sc-campo" style={{ flex: '1 1 220px' }}><label htmlFor="cons-f-q">Buscar</label>
                    <input id="cons-f-q" type="search" value={f.texto} placeholder="Celda, regla o texto…" onChange={(e) => cambia({ texto: e.target.value })} /></div>
            </div>
            <p className="cons-cuenta" role="status" aria-live="polite">{visibles.length} de {todos.length} hallazgos</p>
            {visibles.length === 0
                ? <p className="sc-vacio" role="status">Ningún hallazgo coincide con los filtros. Esto no significa que el programa esté correcto: solo se evaluaron las reglas implementadas.</p>
                : <ul className="cons-lista">{visibles.slice(0, limite).map((h) => <Tarjeta key={h.id} h={h} />)}</ul>}
            {visibles.length > limite && (
                <button type="button" className="sc-btn cons-mas" onClick={() => setLimite(limite + PAGINA)}>Mostrar {Math.min(PAGINA, visibles.length - limite)} más</button>
            )}
        </section>
    );
}
