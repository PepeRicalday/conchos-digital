import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PaginaHero } from '../components/ui/PaginaHero';
import { DespachoAlertas } from '../components/alertas/DespachoAlertas';
import { CanalAlertas } from '../components/alertas/CanalAlertas';
import { PERIODOS, useAlertasPantalla, type Periodo } from '../hooks/useAlertasPantalla';
import {
    contarPorTab, etiquetaCategoria, lugarDeAlerta, ordenaDespacho, resumenPeriodo, tabDeAlerta, type TabAlerta,
} from '../utils/alertasPantalla';
import type { ChipEstado } from '../utils/alertasVivas';
import '../styles/sala-control.css';
import './Alertas.css';

const TABS: { clave: TabAlerta; etiqueta: string; vacio: string }[] = [
    { clave: 'criticas', etiqueta: 'Críticas', vacio: 'Sin alertas críticas vigentes.' },
    { clave: 'avisos', etiqueta: 'Avisos', vacio: 'Sin avisos vigentes.' },
    { clave: 'info', etiqueta: 'Info', vacio: 'Sin alertas informativas.' },
    { clave: 'antiguas', etiqueta: 'Antiguas', vacio: 'Sin pendientes antiguos.' },
];

const Alertas = () => {
    const [periodo, setPeriodo] = useState<Periodo>('Última Semana');
    const [tabElegida, setTabElegida] = useState<TabAlerta | null>(null);
    const [lugar, setLugar] = useState<string | null>(null);
    const { activas, periodoFilas, cargando, corteMs, error, recargar, atender } = useAlertasPantalla(periodo);

    const conteo = useMemo(() => contarPorTab(activas, corteMs), [activas, corteMs]);
    // Pestaña por defecto: la primera con contenido (lo urgente primero); el usuario puede cambiarla.
    const tab: TabAlerta = tabElegida ?? (TABS.find((t) => conteo[t.clave] > 0)?.clave ?? 'criticas');

    const delTab = useMemo(
        () => ordenaDespacho(activas.filter((a) => tabDeAlerta(a, corteMs) === tab)),
        [activas, corteMs, tab],
    );
    const visibles = useMemo(
        () => (lugar ? delTab.filter((a) => (lugarDeAlerta(a) ?? etiquetaCategoria(a.categoria)) === lugar) : delTab),
        [delTab, lugar],
    );
    const periodoRes = useMemo(() => resumenPeriodo(periodoFilas), [periodoFilas]);
    const maxCat = Math.max(1, ...periodoRes.porCategoria.map((c) => c.distintas));

    const elegirTab = (t: TabAlerta) => { setTabElegida(t); setLugar(null); };

    const chips: ChipEstado[] = [];
    if (error) chips.push({ key: 'err', sev: 'crit', texto: 'Sin conexión con el registro de alertas' });
    else if (!cargando) {
        chips.push(conteo.criticas > 0
            ? { key: 'c', sev: 'crit', texto: `${conteo.criticas} crítica${conteo.criticas > 1 ? 's' : ''} vigente${conteo.criticas > 1 ? 's' : ''}` }
            : { key: 'c', sev: 'ok', texto: 'Sin críticas vigentes' });
        if (conteo.avisos > 0) chips.push({ key: 'a', sev: 'warn', texto: `${conteo.avisos} aviso${conteo.avisos > 1 ? 's' : ''} vigente${conteo.avisos > 1 ? 's' : ''}` });
        if (conteo.antiguas > 0) chips.push({ key: 'o', sev: 'info', texto: `${conteo.antiguas} antigua${conteo.antiguas > 1 ? 's' : ''} sin resolver (+14 d)` });
        if (corteMs) chips.push({ key: 's', sev: 'ok', texto: `Actualizado ${new Date(corteMs).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` });
    }

    if (cargando) {
        return (
            <div className="sc-root sc-pagina al-root">
                <div className="al-vacio" role="status">Cargando alertas…</div>
            </div>
        );
    }

    const tab0 = TABS.find((t) => t.clave === tab)!;

    return (
        <div className="sc-root sc-pagina al-root">
            <PaginaHero
                kicker="Alertas · DR 005 Delicias"
                titulo="Centro de alertas"
                subtitulo="Lo vigente arriba; lo antiguo, separado para depurar."
                chips={chips}
                acciones={<button type="button" className="sc-btn" onClick={recargar}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>}
            />

            {error && (
                <p className="sc-aviso sc-aviso-crit" role="alert">
                    No se pudo leer el registro de alertas ({error}). Lo que ves puede estar incompleto: esto NO significa que no haya alertas.
                    <button type="button" className="sc-btn" onClick={recargar} style={{ marginLeft: 'auto' }}>Reintentar</button>
                </p>
            )}

            <p className="sc-sr" role="status" aria-live="polite">
                {`${conteo.criticas} alertas críticas vigentes, ${conteo.avisos} avisos vigentes, ${conteo.antiguas} antiguas sin resolver.`}
            </p>

            <div className="sc-pulso-3">
                <button type="button" onClick={() => elegirTab('criticas')}
                    className={`sc-tile sc-tile-alertas ${conteo.criticas > 0 ? 'sc-hay-crit' : ''}`} aria-label={`Ver ${conteo.criticas} alertas críticas vigentes`}>
                    <span className="sc-kicker">Críticas vigentes</span>
                    <span className="sc-num">{conteo.criticas}</span>
                    <span className="sc-fresco">{conteo.criticas > 0 ? 'Requieren atención hoy' : 'Sin críticas'}</span>
                </button>
                <button type="button" onClick={() => elegirTab('avisos')}
                    className={`sc-tile sc-tile-alertas ${conteo.avisos > 0 ? 'sc-hay-aviso' : ''}`} aria-label={`Ver ${conteo.avisos} avisos vigentes`}>
                    <span className="sc-kicker">Avisos vigentes</span>
                    <span className="sc-num">{conteo.avisos}</span>
                    <span className="sc-fresco">{conteo.avisos > 0 ? 'En monitoreo' : 'Sin avisos'}</span>
                </button>
                <button type="button" onClick={() => elegirTab('antiguas')} className="sc-tile al-tile-antiguas" aria-label={`Ver ${conteo.antiguas} alertas antiguas sin resolver`}>
                    <span className="sc-kicker">Antiguas sin resolver</span>
                    <span className="sc-num sc-num-sd">{conteo.antiguas}</span>
                    <span className="sc-fresco sc-viejo">{conteo.antiguas > 0 ? 'Más de 14 días: depurar' : 'Nada pendiente'}</span>
                </button>
            </div>

            <div className="sc-grid-2">
                <section className="sc-card" aria-labelledby="al-despacho-t">
                    <span className="sc-kicker">Centro de despacho</span>
                    <h3 id="al-despacho-t">Alertas por atender</h3>
                    <div className="sc-barra-nav al-tabs" role="tablist" aria-label="Filtrar por estado">
                        {TABS.map((t) => (
                            <button key={t.clave} type="button" role="tab" aria-selected={tab === t.clave} className={`sc-btn al-tab ${tab === t.clave ? 'al-tab-on' : ''}`}
                                onClick={() => elegirTab(t.clave)}>
                                {t.etiqueta} <span className="al-tab-n">{conteo[t.clave]}</span>
                            </button>
                        ))}
                    </div>
                    {lugar && (
                        <p className="al-filtro">
                            Filtrando por <b>{lugar}</b> ({visibles.length})
                            <button type="button" className="sc-btn" onClick={() => setLugar(null)}>Quitar filtro</button>
                        </p>
                    )}
                    <DespachoAlertas alertas={visibles} ahoraMs={corteMs} onAtender={atender} vacioTexto={tab0.vacio} />
                </section>

                <div className="al-lateral">
                    <section className="sc-card" aria-labelledby="al-canal-t">
                        <span className="sc-kicker">Dónde</span>
                        <h3 id="al-canal-t">Canal Conchos · K0–K104</h3>
                        <CanalAlertas alertas={delTab} lugarActivo={lugar} onFiltrarLugar={setLugar} />
                    </section>

                    <section className="sc-card" aria-labelledby="al-resumen-t">
                        <span className="sc-kicker">Resumen del periodo</span>
                        <h3 id="al-resumen-t">Alertas distintas</h3>
                        <label className="al-periodo">
                            <span className="sc-kicker">Periodo (solo este resumen)</span>
                            <select className="al-select" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
                                {PERIODOS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </label>
                        {periodoRes.aperturas === 0 ? (
                            <p className="al-nota">Sin alertas detectadas en el periodo.</p>
                        ) : (
                            <>
                                <p className="al-cifra">
                                    <b>{periodoRes.distintas}</b> alerta{periodoRes.distintas > 1 ? 's' : ''} distinta{periodoRes.distintas > 1 ? 's' : ''}
                                    <small> · {periodoRes.aperturas} aperturas</small>
                                </p>
                                {periodoRes.aperturas > periodoRes.distintas && (
                                    <p className="al-nota">Hay alertas que se cierran y reabren (p. ej. viento): se cuentan una sola vez.</p>
                                )}
                                <ul className="al-barras">
                                    {periodoRes.porCategoria.map((c) => (
                                        <li key={c.clave}>
                                            <span className="al-barras-et">{c.etiqueta}</span>
                                            <span className="sc-barra"><i style={{ width: `${(c.distintas / maxCat) * 100}%` }} /></span>
                                            <span className="al-barras-n">{c.distintas}{c.criticas > 0 ? ` · ${c.criticas} crít.` : ''}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Alertas;
