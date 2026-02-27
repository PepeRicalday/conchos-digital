import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, CloudSun, Thermometer } from 'lucide-react';
import { useAforos } from '../hooks/useAforos';
import { usePresas } from '../hooks/usePresas';
import './OfficialDamReport.css'; // Will create this next

const OfficialDamReport = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const { aforosReporte } = useAforos(todayStr);
    const { presas, clima } = usePresas(todayStr);

    const boquilla = presas.find(p => p.codigo === 'PLB');
    const madero = presas.find(p => p.codigo === 'PFM');

    // Delicias climate is tied to Boquilla's ID in this mocked setup, 
    // or we might need a distinct station ID if it existed.
    // For now we assume Boquilla, Madero, and one specifically for Delicias.
    const climaBoquilla = clima.find(c => c.presa_id === boquilla?.id);
    const climaMadero = clima.find(c => c.presa_id === madero?.id);
    // TODO: Create an actual Station record for Delicias. For now, we fallback to Boquilla's weather.
    const climaDelicias = clima.find(c => c.presa_id === 'estacion-delicias') || climaBoquilla;

    // Detect if data is historical (not from today)
    const boquillaDate = boquilla?.lectura?.fecha || todayStr;
    const isHistorical = boquillaDate !== todayStr;
    const reportDateLabel = new Date(boquillaDate + 'T12:00:00Z').toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const componentRef = useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Reporte_Presas_${new Date().toLocaleDateString('es-MX').replace(/\//g, '-')}`,
    });

    return (
        <div className="report-page-container bg-slate-900 min-h-screen p-8 text-slate-800">
            {/* Toolbar */}
            <div className="flex justify-between items-center mb-6 max-w-5xl mx-auto hide-on-print">
                <h1 className="text-2xl font-bold text-white">Reporte Oficial Diario</h1>
                <button
                    onClick={handlePrint}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                    <Printer size={18} />
                    Imprimir / Guardar PDF
                </button>
            </div>

            {/* The Report (A4 Sheet Simulation) */}
            <div className="report-paper bg-white max-w-5xl mx-auto shadow-2xl overflow-hidden print:shadow-none print:m-0 print:max-w-none" ref={componentRef}>
                <div className="p-8 border-4 border-double border-slate-200 h-full flex flex-col">

                    {/* Header */}
                    <header className="report-header text-center mb-6 border-b-2 border-slate-800 pb-4">
                        <div className="flex justify-between items-start">
                            <img src="/logos/conagua_logo.png" alt="CONAGUA" className="h-16 object-contain opacity-80" onError={(e) => e.currentTarget.style.display = 'none'} />
                            <div className="flex-1 px-4">
                                <h2 className="text-xl font-bold uppercase tracking-widest text-slate-700">Comisión Nacional del Agua</h2>
                                <h3 className="text-sm font-bold uppercase text-slate-500">Dirección Local Chihuahua</h3>
                                <h3 className="text-sm font-bold uppercase text-slate-500">Distrito de Riego 005</h3>
                            </div>
                            <div className="text-right flex flex-col items-end">
                                <span className="block text-xs font-bold uppercase text-slate-400">Fecha</span>
                                <span className="text-lg font-serif font-bold text-slate-800 uppercase">{reportDateLabel}</span>
                                {isHistorical && (
                                    <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full mt-1 border border-amber-300 print:hidden shadow-sm animate-pulse">
                                        ⚠ Mostrando Lectura Guardada de Ayer
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 bg-slate-800 text-white py-1 uppercase font-bold text-sm tracking-wider">
                            Reporte Diario de las Presas y Aforos de los Principales Puntos de Control
                        </div>
                    </header>

                    {/* Main Grid */}
                    <div className="report-grid grid grid-cols-3 gap-0 border-2 border-slate-800 mb-6">
                        {/* Column Headers */}
                        <div className="col-header bg-slate-100 border-r border-b border-slate-800 p-2 text-center font-bold text-sm uppercase">Presa La Boquilla</div>
                        <div className="col-header bg-slate-100 border-r border-b border-slate-800 p-2 text-center font-bold text-sm uppercase">Presa Fco. I. Madero</div>
                        <div className="col-header bg-slate-100 border-b border-slate-800 p-2 text-center font-bold text-sm uppercase">Delicias (Estación Climatológica)</div>

                        {/* ROW 1: Hydro Data */}
                        <div className="col-boquilla border-r border-slate-400 p-2 space-y-1">
                            <DataRow label="Escala (msnm)" value={boquilla?.lectura?.escala_msnm?.toFixed(2) || '---'} />
                            <DataRow label="Almacenamiento (Mm³)" value={boquilla?.lectura?.almacenamiento_mm3?.toFixed(3) || '---'} highlight />
                            <DataRow label="T. Baja" value={boquilla?.lectura?.gasto_toma_baja_m3s?.toString() || '---'} />
                            <DataRow label="C.F.E." value={boquilla?.lectura?.gasto_cfe_m3s?.toString() || '---'} />
                            <DataRow label="Extracción Total (m³/s)" value={boquilla?.lectura?.extraccion_total_m3s?.toFixed(2) || '---'} bold />
                            <DataRow label="% Llenado" value={boquilla?.lectura?.porcentaje_llenado ? `${boquilla.lectura.porcentaje_llenado.toFixed(2)}%` : '---'} />
                        </div>

                        <div className="col-madero border-r border-slate-400 p-2 space-y-1">
                            <DataRow label="Escala (msnm)" value={madero?.lectura?.escala_msnm?.toFixed(2) || '---'} />
                            <DataRow label="Almacenamiento (Mm³)" value={madero?.lectura?.almacenamiento_mm3?.toFixed(2) || '---'} highlight />
                            <DataRow label="Toma Izq. #1" value={madero?.lectura?.gasto_toma_izq_m3s?.toFixed(2) || '---'} />
                            <DataRow label="Toma Der. #2" value={madero?.lectura?.gasto_toma_der_m3s?.toFixed(2) || '---'} />
                            <DataRow label="Extracción Total (m³/s)" value={madero?.lectura?.extraccion_total_m3s?.toFixed(2) || '---'} bold />
                            <DataRow label="% Llenado" value={madero?.lectura?.porcentaje_llenado ? `${madero.lectura.porcentaje_llenado.toFixed(2)}%` : '---'} />
                        </div>

                        <div className="col-delicias p-4 flex flex-col justify-center items-center text-slate-500 italic text-sm text-center bg-slate-50/50">
                            <p>Área de Notas / Observaciones Generales</p>
                            <div className="mt-4 border border-dashed border-slate-300 w-full h-24 rounded flex items-center justify-center">
                                (Espacio para notas manuales)
                            </div>
                        </div>

                        {/* ROW 2: Weather Data Header */}
                        <div className="col-span-3 bg-slate-100 border-y border-slate-800 text-center font-bold text-xs uppercase py-1 tracking-wider">
                            Información Climatológica
                        </div>

                        {/* ROW 3: Weather Data Body */}
                        <WeatherColumn data={climaBoquilla} location="boquilla" />
                        <WeatherColumn data={climaMadero} location="madero" />
                        <WeatherColumn data={climaDelicias} location="delicias" last />

                        {/* ROW 4: Previous 24h Header */}
                        <div className="col-span-3 bg-slate-200 border-y border-slate-800 text-center font-bold text-xs uppercase py-1 tracking-wider text-slate-600">
                            24 Horas Anteriores
                        </div>

                        {/* ROW 5: Previous 24h Body */}
                        <Prev24hColumn data={climaBoquilla} />
                        <Prev24hColumn data={climaMadero} />
                        <Prev24hColumn data={climaDelicias} last />

                        {/* ROW 6: Aforos Header */}
                        <div className="col-span-3 bg-slate-800 text-white text-center font-bold text-xs uppercase py-1 tracking-wider">
                            Aforos de Control
                        </div>

                        {/* ROW 7: Aforos Body */}
                        <div className="col-span-3 grid grid-cols-3 divide-x divide-slate-400 border-b border-slate-800">
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 0+580 (Canal Principal)</h4>
                                <DataRow label="Escala" value={aforosReporte.km0_580 ? aforosReporte.km0_580.nivel_escala_fin_m?.toFixed(2) : '---'} />
                                <DataRow label="Gasto (m³/s)" value={aforosReporte.km0_580 ? aforosReporte.km0_580.gasto_calculado_m3s?.toFixed(3) : '---'} bold />
                            </div>
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 106</h4>
                                <DataRow label="Escala" value={aforosReporte.km106 ? aforosReporte.km106.nivel_escala_fin_m?.toFixed(2) : '---'} />
                                <DataRow label="Gasto (m³/s)" value={aforosReporte.km106 ? aforosReporte.km106.gasto_calculado_m3s?.toFixed(3) : '---'} bold />
                            </div>
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 104 (Fin)</h4>
                                <DataRow label="Escala" value={aforosReporte.km104 ? aforosReporte.km104.nivel_escala_fin_m?.toFixed(2) : '---'} />
                                <DataRow label="Gasto (m³/s)" value={aforosReporte.km104 ? aforosReporte.km104.gasto_calculado_m3s?.toFixed(3) : '---'} bold />
                            </div>
                        </div>

                        {/* Footer: Totals */}
                        <div className="col-span-3 grid grid-cols-2 divide-x divide-slate-800 bg-slate-100 font-bold uppercase text-xs">
                            <div className="p-2 flex justify-between">
                                <span>Capacidad Total:</span>
                                <span>2,903 Mm³ (PLB) / 346 Mm³ (PFM)</span>
                            </div>
                            <div className="p-2 flex justify-between">
                                <span>Almacenamiento Conjunto:</span>
                                <span>{((boquilla?.lectura?.almacenamiento_mm3 || 0) + (madero?.lectura?.almacenamiento_mm3 || 0)).toFixed(3)} Mm³</span>
                            </div>
                        </div>
                    </div>

                    {/* Signatures */}
                    <div className="mt-auto pt-8 flex justify-end">
                        <div className="text-center w-64 border-t border-slate-800 pt-2">
                            <p className="font-bold text-sm uppercase">Ing. Responsable de Operación</p>
                            <p className="text-xs text-slate-500">Firma Digital / Autorización</p>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

// --- Subcomponents for Clean Layout ---

const DataRow = ({ label, value, bold = false, highlight = false }: { label: string, value: string | number | undefined, bold?: boolean, highlight?: boolean }) => (
    <div className={`flex justify-between items-end border-b border-dotted border-slate-300 pb-0.5 text-sm ${highlight ? 'bg-blue-50/80 px-1 -mx-1 rounded' : ''}`}>
        <span className="text-slate-600 font-medium text-xs uppercase">{label}</span>
        <span className={`font-mono ${bold ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{value}</span>
    </div>
);

const WeatherColumn = ({ data, last = false }: { data?: any, location: string, last?: boolean }) => (
    <div className={`${!last ? 'border-r border-slate-400' : ''} p-2 space-y-1`}>
        <DataRow label="Temp. Ambiente" value={data?.temp_ambiente_c != null ? `${data.temp_ambiente_c} °C` : '---'} />
        <DataRow label="Temp. Máxima" value={data?.temp_maxima_c != null ? `${data.temp_maxima_c} °C` : '---'} />
        <DataRow label="Temp. Mínima" value={data?.temp_minima_c != null ? `${data.temp_minima_c} °C` : '---'} />
        <DataRow label="Precipitación" value={data?.precipitacion_mm != null ? `${data.precipitacion_mm} mm` : '---'} />
        <DataRow label="Evaporación" value={data?.evaporacion_mm != null ? `${data.evaporacion_mm.toFixed(2)} mm` : '---'} />
        <DataRow label="Dir. Viento" value={data?.dir_viento || '---'} />
        <DataRow label="Intensidad (km/h)" value={data?.intensidad_viento?.toString() || '---'} />
        <DataRow label="Visibilidad (km)" value={data?.visibilidad?.toString() || '---'} />
        <div className="flex justify-between items-center mt-2 pt-1 border-t border-slate-200">
            <span className="text-xs text-slate-500 uppercase">Edo. Tiempo</span>
            <div className="flex items-center gap-1 font-bold text-sm">
                <WeatherIcon state={data?.edo_tiempo || 'Soleado'} />
                {data?.edo_tiempo || '---'}
            </div>
        </div>
    </div>
);

const Prev24hColumn = ({ data, last = false }: { data?: any, last?: boolean }) => (
    <div className={`${!last ? 'border-r border-slate-400' : ''} p-2 space-y-1`}>
        <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 uppercase">Edo. Tiempo</span>
            <div className="flex items-center gap-1 font-bold text-xs text-slate-400">
                <WeatherIcon state={data?.edo_tiempo_24h || 'Soleado'} size={12} />
                {data?.edo_tiempo_24h || '---'}
            </div>
        </div>
        <DataRow label="Dir. Viento" value={data?.dir_viento_24h || '---'} />
        <DataRow label="Intensidad (km/h)" value={data?.intensidad_24h?.toString() || '---'} />
    </div>
);

const WeatherIcon = ({ state, size = 16 }: { state: string, size?: number }) => {
    switch (state) {
        case 'Soleado': return <CloudSun size={size} />;
        case 'Nublado': return <CloudSun size={size} />; // Lucide doesn't have Cloud only?
        case 'Frio': return <Thermometer size={size} className="text-blue-500" />;
        case 'Caluroso': return <Thermometer size={size} className="text-red-500" />;
        default: return <CloudSun size={size} />;
    }
};

export default OfficialDamReport;
