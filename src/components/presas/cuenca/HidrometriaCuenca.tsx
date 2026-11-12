import { DataTable, type Columna } from '../../ui/base';
import { VENTANAS, fechaHoraLocal, fmt, textoEdad, type VentanaHidro } from '../../../utils/hidroEstaciones';
import { textoGasto, type EstacionRed } from '../../../hooks/useHidrometriaCuenca';

const GLIFO_ENLACE = { en_linea: '●', retraso: '◐', sin_transmision: '■', sd: '◇' } as const;
const ROL_TXT = { entrada: 'Entrada a vaso', rio: 'Cauce entre vasos', salida: 'Salida de la cuenca' } as const;

function volumenTxt(e: EstacionRed): string {
  const s = e.stat;
  if (!s) return 'S/D';
  if (s.censurado && s.censurado.n > 0 && s.censurado.volInfMm3 != null && s.censurado.volSupMm3 != null) return `${fmt(s.censurado.volInfMm3, 2)}–${fmt(s.censurado.volSupMm3, 2)}`;
  return s.volumen ? fmt(s.volumen.mm3, 2) : 'S/D';
}

const columnas = (ventana: VentanaHidro): Columna<EstacionRed>[] => [
  {
    id: 'e', titulo: 'Estación', encabezadoFila: true,
    render: (e) => <><span className="cu-nombre">{e.sitio.corto}</span><span className="cu-tag">{ROL_TXT[e.sitio.rol]}</span><span className="cu-nota-fila">{e.sitio.tramo} · hacia {e.sitio.haciaTxt}</span>{e.sitio.reserva && <span className="cu-nota-fila cu-nota-fila--aviso">▲ {e.sitio.reserva}</span>}</>,
  },
  { id: 'q', titulo: `Gasto medio ${VENTANAS[ventana].etiqueta} (m³/s)`, numerica: true, render: (e) => <>{textoGasto(e.stat, 2)}{e.stat?.gasto && <span className="cu-nota-fila">mín {fmt(e.stat.gasto.min, 1)} · máx {fmt(e.stat.gasto.max, 1)}</span>}</> },
  {
    id: 'v', titulo: `Volumen ${VENTANAS[ventana].etiqueta} (Mm³)`, numerica: true,
    render: (e) => <>{volumenTxt(e)}{e.stat?.volumen && <span className="cu-nota-fila">{fmt(e.stat.volumen.pctIntegrado, 0)} % del periodo medido</span>}</>,
  },
  { id: 'n', titulo: 'Nivel medio (m)', numerica: true, render: (e) => <>{e.stat?.nivel ? fmt(e.stat.nivel.media, 2) : 'S/D'}{e.stat?.variacionNivel.h24 && <span className="cu-nota-fila">{e.stat.variacionNivel.h24.dir === 'estable' ? 'estable' : `${e.stat.variacionNivel.h24.delta > 0 ? '+' : '−'}${fmt(Math.abs(e.stat.variacionNivel.h24.delta), 2)} m`} en 24 h</span>}</> },
  {
    id: 't', titulo: 'Tendencia del gasto', render: (e) => {
      const p = e.stat?.pendienteGastoDia;
      if (p == null) return 'S/D';
      const dir = Math.abs(p) < 0.5 ? 'estable' : p > 0 ? 'sube' : 'baja';
      return <><span aria-hidden="true">{dir === 'sube' ? '▲' : dir === 'baja' ? '▼' : '▬'} </span>{dir === 'estable' ? 'Estable' : `${p > 0 ? '+' : '−'}${fmt(Math.abs(p), 1)} m³/s por día`}</>;
    },
  },
  { id: 'c', titulo: 'Lecturas recibidas', numerica: true, render: (e) => (e.stat?.cobertura ? `${fmt(e.stat.cobertura.pct, 0)} %` : 'S/D') },
  {
    id: 'x', titulo: 'Enlace', render: (e) => (
      <><span className={`cu-hid-enlace cu-hid-enlace--${e.enlace.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[e.enlace.clave]}</span> {e.enlace.etiqueta}</span><span className="cu-nota-fila">{e.est.ult_dato_en ? `${fechaHoraLocal(e.est.ult_dato_en)} · ${textoEdad(e.enlace.edadMin)}` : 'sin dato'}</span></>
    ),
  },
];

/**
 * Estaciones hidrométricas entre los vasos: lo que mide el río a la entrada de La Boquilla y de F. I. Madero, en el cauce del San
 * Pedro hacia Luis L. León y a la salida de la cuenca en Ojinaga. Gasto medio, volumen que pasó, nivel, tendencia y salud del enlace
 * en la ventana elegida. Las reservas de cada sensor van en su fila: no se ocultan ni se corrigen.
 */
export default function HidrometriaCuenca({ estaciones, ventana, onVentana, cargando, error }: {
  estaciones: EstacionRed[]; ventana: VentanaHidro; onVentana: (v: VentanaHidro) => void; cargando: boolean; error: string | null;
}) {
  return (
    <section className="an-card" id="cu-hidro" aria-label="Estaciones hidrométricas entre los vasos">
      <div className="cu-red-cab">
        <div>
          <h4 className="an-h">Estaciones hidrométricas entre los vasos</h4>
          <p className="an-nota">Telemetría satelital GOES cada 15 a 20 minutos y aforo oficial USIBWC. De aguas arriba a aguas abajo. El volumen es el gasto integrado sobre el tiempo con lectura continua.</p>
        </div>
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-hid-ven">Periodo</span>
          <div className="an-seg" role="group" aria-labelledby="cu-hid-ven">
            {(Object.keys(VENTANAS) as VentanaHidro[]).map((v) => <button key={v} type="button" className="an-seg-btn" aria-pressed={v === ventana} onClick={() => onVentana(v)}>{VENTANAS[v].etiqueta}</button>)}
          </div>
        </div>
      </div>
      {error && <p className="an-aviso" role="alert">No se pudieron leer las estaciones hidrométricas: {error}</p>}
      {!error && estaciones.length === 0 && (cargando
        ? <div className="an-skeleton" role="status" aria-busy="true" aria-label="Cargando estaciones hidrométricas" />
        : <div className="an-vacio" role="status"><strong>Sin estaciones hidrométricas (S/D)</strong></div>)}
      {estaciones.length > 0 && (
        <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Estaciones hidrométricas (desplazable)" captionOculto caption="Estaciones hidrométricas entre los vasos"
          clave={(e) => e.est.id} filas={estaciones} columnas={columnas(ventana)} />
      )}
      {cargando && estaciones.length > 0 && <p className="an-nota" role="status">Actualizando lecturas…</p>}
    </section>
  );
}
