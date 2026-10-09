import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Gauge, ListChecks, RefreshCw, ScrollText, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { PaginaHero } from '../components/ui/PaginaHero';
import { CabeceraMarca } from '../components/conservacion/CabeceraMarca';
import { CargaInforme } from '../components/conservacion/CargaInforme';
import { VistaResumen } from '../components/conservacion/VistaResumen';
import { VistaHallazgos } from '../components/conservacion/VistaHallazgos';
import { VistaReglas } from '../components/conservacion/VistaReglas';
import { VistaParametros } from '../components/conservacion/VistaParametros';
import { VistaPreviaInforme } from '../components/conservacion/VistaPreviaInforme';
import { leerInforme, type ArchivoInforme } from '../conservacion/informe/esquemaInforme';
import { filasReglas, resumenReglas } from '../conservacion/informe/vistas';
import type { ChipEstado } from '../utils/alertasVivas';
import '../styles/sala-control.css';
import '../components/conservacion/conservacion.css';

const CLAVE = 'sica-conservacion-informe-v1';
type Vista = 'resumen' | 'hallazgos' | 'reglas' | 'parametros';
const VISTAS: ReadonlyArray<{ id: Vista; etiqueta: string; icono: typeof Gauge }> = [
    { id: 'resumen', etiqueta: 'Resumen', icono: Gauge },
    { id: 'hallazgos', etiqueta: 'Hallazgos', icono: TriangleAlert },
    { id: 'reglas', etiqueta: 'Reglas', icono: ListChecks },
    { id: 'parametros', etiqueta: 'Parámetros', icono: SlidersHorizontal },
];

/** El informe vive solo en esta pestaña del navegador (sessionStorage): contiene datos de un PacOT y no se comparte. */
function restaurar(): ArchivoInforme | null {
    try {
        const t = sessionStorage.getItem(CLAVE);
        if (!t) return null;
        const r = leerInforme(t);
        return r.ok ? r.archivo : null;
    } catch { return null; }
}
function guardar(a: ArchivoInforme | null): void {
    try { if (a) sessionStorage.setItem(CLAVE, JSON.stringify(a)); else sessionStorage.removeItem(CLAVE); } catch { /* sin almacenamiento: el informe sigue en memoria */ }
}

const Conservacion = () => {
    const [archivo, setArchivo] = useState<ArchivoInforme | null>(restaurar);
    const [params, setParams] = useSearchParams();
    const [reglaFiltro, setReglaFiltro] = useState('');
    const [previa, setPrevia] = useState(false);

    const vistaParam = params.get('vista');
    const vista: Vista = VISTAS.some((v) => v.id === vistaParam) ? (vistaParam as Vista) : 'resumen';
    const irA = useCallback((v: Vista) => { const p = new URLSearchParams(params); p.set('vista', v); setParams(p, { replace: true }); }, [params, setParams]);
    const abrirHallazgos = useCallback((regla: string) => { setReglaFiltro(regla); irA('hallazgos'); }, [irA]);
    const abrir = useCallback((a: ArchivoInforme) => { setArchivo(a); guardar(a); }, []);
    const cambiar = useCallback(() => { setArchivo(null); guardar(null); }, []);

    const reglas = useMemo(() => (archivo ? resumenReglas(filasReglas(archivo)) : null), [archivo]);
    const chips: ChipEstado[] = useMemo(() => {
        if (!archivo || !reglas) return [];
        const r = archivo.informe.resumen;
        const c: ChipEstado[] = [];
        c.push(r.alta > 0 ? { key: 'alta', sev: 'crit', texto: `${r.alta} hallazgos de severidad alta` } : { key: 'alta', sev: 'ok', texto: 'Sin severidad alta en lo evaluado' });
        c.push({ key: 'reglas', sev: 'warn', texto: `${reglas.implementadas} de ${reglas.total} reglas implementadas` });
        c.push({ key: 'base', sev: 'info', texto: archivo.informe.baseValores === 'cache' ? 'Valores guardados en el archivo (caché)' : archivo.informe.baseValores });
        c.push({ key: 'motor', sev: 'info', texto: `Motor ${archivo.informe.versionMotor}` });
        return c;
    }, [archivo, reglas]);

    return (
        <div className="sc-root sc-pagina cons-pagina">
            <CabeceraMarca {...(archivo ? { origen: archivo.origen, generadoEn: archivo.generadoEn } : {})} />

            {!archivo ? (
                <>
                    <PaginaHero kicker="SICA Conservación" titulo="Comprobación de programas de conservación"
                        subtitulo="Verifica la cadena inventario → diagnóstico → programa → maquinaria de un PacOT con aritmética determinista y cita la norma de cada hallazgo." />
                    <CargaInforme onInforme={abrir} />
                </>
            ) : (
                <>
                    <PaginaHero id="cons-titulo" kicker={`SICA Conservación · ${archivo.origen.moduloNombre ?? 'PacOT'}`} titulo="Comprobación del programa"
                        subtitulo={<>Ciclo {archivo.origen.ciclo ?? 's/d'} · {archivo.origen.archivoNombre}</>} chips={chips}
                        acciones={<>
                            <button type="button" className="sc-btn sc-btn-primario" onClick={() => setPrevia(true)}><FileText size={16} aria-hidden="true" /> Informe imprimible</button>
                            <button type="button" className="sc-btn" onClick={cambiar}><RefreshCw size={16} aria-hidden="true" /> Abrir otro informe</button>
                        </>} />

                    <p className="sc-aviso cons-honesto" role="note">
                        <ScrollText size={16} aria-hidden="true" />
                        <span><b>Cobertura parcial:</b> {reglas?.implementadas} de {reglas?.total} reglas implementadas. Que no aparezcan hallazgos no equivale a que el programa sea correcto,
                            y la aritmética que coincide no acredita la condición física de las obras.</span>
                    </p>

                    <div className="cons-tabs" role="tablist" aria-label="Secciones del informe">
                        {VISTAS.map((v) => {
                            const Ico = v.icono;
                            return (
                                <button key={v.id} id={`cons-tab-${v.id}`} type="button" role="tab" className="cons-tab" aria-selected={vista === v.id}
                                    aria-controls="cons-panel" tabIndex={vista === v.id ? 0 : -1} onClick={() => irA(v.id)}>
                                    <Ico size={16} aria-hidden="true" /> {v.etiqueta}
                                    {v.id === 'hallazgos' && <small>{archivo.informe.resumen.hallazgos}</small>}
                                    {v.id === 'reglas' && reglas && <small>{reglas.implementadas}/{reglas.total}</small>}
                                </button>
                            );
                        })}
                    </div>

                    <div id="cons-panel" role="tabpanel" aria-labelledby={`cons-tab-${vista}`}>
                        {vista === 'resumen' && <VistaResumen archivo={archivo} irAHallazgos={abrirHallazgos} />}
                        {vista === 'hallazgos' && <VistaHallazgos key={reglaFiltro} archivo={archivo} reglaInicial={reglaFiltro} />}
                        {vista === 'reglas' && <VistaReglas archivo={archivo} abrirHallazgos={abrirHallazgos} />}
                        {vista === 'parametros' && <VistaParametros archivo={archivo} />}
                    </div>
                    {previa && <VistaPreviaInforme archivo={archivo} onCerrar={() => setPrevia(false)} />}
                </>
            )}
        </div>
    );
};

export default Conservacion;
