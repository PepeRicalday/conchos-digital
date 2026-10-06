import { useMemo } from 'react';
import { FlaskConical, RefreshCw, TrendingDown } from 'lucide-react';
import ManningCalibrador from '../components/ManningCalibrador';
import RatingCurve from '../components/RatingCurve';
import { useFecha } from '../context/FechaContext';
import { useBalanceDia } from '../hooks/useBalanceDia';
import { useEficienciaCanal } from '../hooks/useEficienciaCanal';
import { useEscalasCanal } from '../hooks/useEscalasCanal';
import { useAhora } from '../hooks/useHidrometriaSemana';
import { construyeBalance, ordenaPorSeveridad, resumenBalance } from '../utils/balanceTramos';
import { fmtEdadMin } from '../utils/formato';
import type { ChipEstado } from '../utils/alertasVivas';
import { PaginaHero } from '../components/ui/PaginaHero';
import { KpisBalance } from '../components/balance/KpisBalance';
import { TablaTramos } from '../components/balance/TablaTramos';
import { EsquemaCanal } from '../components/balance/EsquemaCanal';
import { PerfilManning } from '../components/balance/PerfilManning';
import { ReporteEjecutivo } from '../components/balance/ReporteEjecutivo';
import '../styles/sala-control.css';
import '../components/balance/balance.css';

const BalanceHidraulico = () => {
    const { fechaSeleccionada, esHoy } = useFecha();
    const datos = useBalanceDia(fechaSeleccionada);
    const canal = useEficienciaCanal();
    const { escalas: vigentes } = useEscalasCanal();
    const ahora = useAhora();

    const tramos = useMemo(() => construyeBalance(datos.escalas, datos.tomas, datos.perfil), [datos.escalas, datos.tomas, datos.perfil]);
    const ordenados = useMemo(() => ordenaPorSeveridad(tramos), [tramos]);
    const resumen = useMemo(() => resumenBalance(tramos), [tramos]);
    // Escalas con lectura NO vigente (> 4 h) hoy: sus tramos se rotulan "lectura > 4 h" en la tabla.
    const noVigentes = useMemo(() => new Set(esHoy ? vigentes.filter((e) => !e.fresca).map((e) => e.nombre) : []), [vigentes, esHoy]);
    const qTomas = useMemo(() => datos.tomas.reduce((a, t) => a + t.caudal, 0), [datos.tomas]);

    const chips: ChipEstado[] = useMemo(() => {
        const c: ChipEstado[] = [];
        if (datos.error) c.push({ key: 'err', sev: 'crit', texto: `No se pudo leer el balance: ${datos.error}` });
        if (!canal.k0Fresca || !canal.k104Fresca) c.push({ key: 'ext', sev: 'warn', texto: 'K-0 o K-104 sin lectura vigente (> 4 h): eficiencia de conducción en S/D' });
        if (esHoy && vigentes.length > 0) {
            const vivas = vigentes.filter((e) => e.fresca).length;
            c.push({ key: 'vig', sev: vivas === vigentes.length ? 'ok' : 'warn', texto: `${vivas} de ${vigentes.length} escalas con lectura vigente (≤ 4 h)` });
        }
        if (!esHoy) c.push({ key: 'fecha', sev: 'info', texto: `Balance del ${fechaSeleccionada}: resumen diario por escala (la eficiencia de conducción siempre es la actual)` });
        if (datos.sinKm > 0) c.push({ key: 'sinkm', sev: 'warn', texto: `${datos.sinKm} escala(s) sin km excluidas del balance` });
        if (datos.actualizadoEn) c.push({ key: 'act', sev: 'ok', texto: `Actualizado ${fmtEdadMin(Math.max(0, (ahora - datos.actualizadoEn) / 60000))}` });
        return c;
    }, [datos.error, datos.sinKm, datos.actualizadoEn, canal.k0Fresca, canal.k104Fresca, esHoy, vigentes, fechaSeleccionada, ahora]);

    return (
        <div className="sc-root sc-pagina">
            <PaginaHero
                kicker="Análisis · Canal Principal Conchos"
                titulo="Balance hídrico"
                subtitulo="Modelo de operación: lo que entra, lo que sale por tramos y por tomas, y lo que se pierde"
                chips={chips}
                acciones={<button type="button" className="sc-btn no-print" onClick={() => { void datos.recargar(); canal.recargar(); }} aria-label="Actualizar datos"><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>}
            />

            {datos.cargando ? (
                <p className="sc-vacio" role="status">Calculando balance hidráulico…</p>
            ) : (
                <>
                    <KpisBalance canal={canal} resumen={resumen} tomasActivas={datos.tomas.length} qTomas={qTomas} escalas={datos.escalas.length} sinKm={datos.sinKm} />
                    <TablaTramos tramos={ordenados} noVigentes={noVigentes} />
                    <EsquemaCanal tramos={tramos} />
                    <PerfilManning perfil={datos.perfil} />
                </>
            )}

            <section className="sc-card no-print bal-seccion-externa" aria-labelledby="bal-rating-t">
                <span className="sc-kicker"><TrendingDown size={12} aria-hidden="true" /> Aforos de campo · ventana de 365 días</span>
                <h3 id="bal-rating-t">Curvas Q-h por punto de aforo</h3>
                <p className="sc-fresco">Dispersión de campo contra curva teórica Manning: detecta cambios de sección y desviaciones.</p>
                <RatingCurve diasAtras={365} />
            </section>

            <section className="sc-card no-print bal-seccion-externa" aria-labelledby="bal-calib-t">
                <span className="sc-kicker"><FlaskConical size={12} aria-hidden="true" /> Aforos de sica-capture · ventana de 90 días</span>
                <h3 id="bal-calib-t">Calibración automática de la rugosidad de Manning (n)</h3>
                <ManningCalibrador />
            </section>

            <ReporteEjecutivo fecha={fechaSeleccionada} />
        </div>
    );
};

export default BalanceHidraulico;
