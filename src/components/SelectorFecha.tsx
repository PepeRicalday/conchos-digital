import { useRef, useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFecha } from '../context/FechaContext';
import './SelectorFecha.css';

const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

function formatFechaDisplay(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    const mes = MESES[parseInt(m, 10) - 1];
    return `${parseInt(d, 10)} ${mes} ${y}`;
}

function getHoyISO(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getDiasEnMes(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

function getPrimerDiaSemana(year: number, month: number): number {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1; // Monday = 0
}

const SelectorFecha = () => {
    const { fechaSeleccionada, setFechaSeleccionada, esHoy } = useFecha();
    const [abierto, setAbierto] = useState(false);
    const [mesVista, setMesVista] = useState(() => {
        const [y, m] = fechaSeleccionada.split('-');
        return { year: parseInt(y), month: parseInt(m) - 1 };
    });
    const ref = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setAbierto(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const irHoy = () => {
        const hoy = getHoyISO();
        setFechaSeleccionada(hoy);
        const [y, m] = hoy.split('-');
        setMesVista({ year: parseInt(y), month: parseInt(m) - 1 });
        setAbierto(false);
    };

    const seleccionarDia = (dia: number) => {
        const fecha = `${mesVista.year}-${String(mesVista.month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        setFechaSeleccionada(fecha);
        setAbierto(false);
    };

    const mesAnterior = () => {
        setMesVista(prev => {
            if (prev.month === 0) return { year: prev.year - 1, month: 11 };
            return { ...prev, month: prev.month - 1 };
        });
    };

    const mesSiguiente = () => {
        setMesVista(prev => {
            if (prev.month === 11) return { year: prev.year + 1, month: 0 };
            return { ...prev, month: prev.month + 1 };
        });
    };

    const diasEnMes = getDiasEnMes(mesVista.year, mesVista.month);
    const primerDia = getPrimerDiaSemana(mesVista.year, mesVista.month);
    const hoyStr = getHoyISO();

    return (
        <div className="selector-fecha" ref={ref}>
            <button
                className={`fecha-trigger ${!esHoy ? 'fecha-historica' : ''}`}
                onClick={() => setAbierto(!abierto)}
            >
                <Calendar size={16} />
                <span className="fecha-display">{formatFechaDisplay(fechaSeleccionada)}</span>
                {esHoy && <span className="fecha-badge-hoy">HOY</span>}
            </button>

            {abierto && (
                <div className="fecha-dropdown">
                    {/* Calendar header */}
                    <div className="cal-header">
                        <button className="cal-nav" onClick={mesAnterior}>
                            <ChevronLeft size={16} />
                        </button>
                        <span className="cal-titulo">
                            {MESES[mesVista.month]} {mesVista.year}
                        </span>
                        <button className="cal-nav" onClick={mesSiguiente}>
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {/* Day labels */}
                    <div className="cal-dias-semana">
                        {DIAS_SEMANA.map(d => (
                            <span key={d} className="cal-dia-label">{d}</span>
                        ))}
                    </div>

                    {/* Calendar grid */}
                    <div className="cal-grid">
                        {Array.from({ length: primerDia }, (_, i) => (
                            <span key={`empty-${i}`} className="cal-dia vacio" />
                        ))}
                        {Array.from({ length: diasEnMes }, (_, i) => {
                            const dia = i + 1;
                            const fechaDia = `${mesVista.year}-${String(mesVista.month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                            const esSeleccionado = fechaDia === fechaSeleccionada;
                            const esDiaHoy = fechaDia === hoyStr;
                            return (
                                <button
                                    key={dia}
                                    className={`cal-dia ${esSeleccionado ? 'seleccionado' : ''} ${esDiaHoy ? 'hoy' : ''}`}
                                    onClick={() => seleccionarDia(dia)}
                                >
                                    {dia}
                                </button>
                            );
                        })}
                    </div>

                    {/* Quick actions */}
                    <div className="cal-acciones">
                        <button className="cal-btn-hoy" onClick={irHoy}>
                            Ir a Hoy
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SelectorFecha;
