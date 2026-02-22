import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, CloudSun, Thermometer } from 'lucide-react';
// TODO: Integrate with usePresas hook for real data
import './OfficialDamReport.css'; // Will create this next

// --- Mock Data Interface (Matches proposed DB schema) ---
interface WeatherData {
    tempMax: number;
    tempMin: number;
    tempAmb: number;
    precip: number;
    evap: number;
    windDir: string;
    windSpeed: string; // "Moderado", "40 km/h"
    visibility: string; // "4T"?
    weatherState: 'Soleado' | 'Nublado' | 'Lluvia' | 'Frio' | 'Caluroso';
}

interface HydroData {
    scale: number; // msnm
    storage: number; // Mm3
    extraction: number; // m3/s
    percent: number; // %
    // Specifics
    tBaja?: number; // Boquilla
    cfe?: number;   // Boquilla
    tomaIzq?: number; // Madero
    tomaDer?: number; // Madero
    spillway?: number;
}

interface ReportData {
    date: string;
    boquilla: HydroData & WeatherData;
    madero: HydroData & WeatherData;
    delicias: WeatherData; // Only weather
    prev24h: {
        boquilla: { weatherState: string; windDir: string; windSpeed: string };
        madero: { weatherState: string; windDir: string; windSpeed: string };
        delicias: { weatherState: string; windDir: string; windSpeed: string };
    };
    aforos: {
        km0_580: { scale: number; flow: number }; // Canal Principal
        km106: { scale: number; flow: number }; // Saucillo?
        km104: { scale: number; flow: number }; // Fin?
    };
}

// --- MOCKED DATA (To be replaced by DB fetch) ---
const MOCK_REPORT: ReportData = {
    date: new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    boquilla: {
        scale: 1302.68,
        storage: 1089.653,
        extraction: 45.3,
        percent: 38.277,
        tBaja: 0,
        cfe: 45.3,
        spillway: 0,
        // Weather
        tempMax: 24,
        tempMin: 7,
        tempAmb: 8,
        precip: 0,
        evap: 4.70,
        windDir: 'SE',
        windSpeed: 'Moderado',
        visibility: '4T',
        weatherState: 'Frio'
    },
    madero: {
        scale: 1236.00,
        storage: 232.02,
        extraction: 12.5,
        percent: 69.61,
        tomaIzq: 12.5,
        tomaDer: 0,
        spillway: 0,
        // Weather
        tempMax: 26,
        tempMin: 7,
        tempAmb: 8,
        precip: 0,
        evap: 3.98,
        windDir: 'SW',
        windSpeed: 'Moderado',
        visibility: '4T',
        weatherState: 'Frio'
    },
    delicias: {
        tempMax: 24,
        tempMin: 6,
        tempAmb: 7,
        precip: 0,
        evap: 5.30,
        windDir: 'NE',
        windSpeed: 'Ligero',
        visibility: '5T',
        weatherState: 'Frio'
    },
    prev24h: {
        boquilla: { weatherState: 'Caluroso', windDir: 'SE', windSpeed: 'Moderado' },
        madero: { weatherState: 'Caluroso', windDir: 'SW', windSpeed: 'Moderado' },
        delicias: { weatherState: 'Caluroso', windDir: 'SE', windSpeed: 'Ligero' }
    },
    aforos: {
        km0_580: { scale: 1.20, flow: 45.3 },
        km106: { scale: 0.85, flow: 12.1 },
        km104: { scale: 0.50, flow: 5.2 }
    }
};

const OfficialDamReport = () => {
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
                            <div className="text-right">
                                <span className="block text-xs font-bold uppercase text-slate-400">Fecha</span>
                                <span className="text-lg font-serif font-bold text-slate-800 uppercase">{MOCK_REPORT.date}</span>
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
                            <DataRow label="Escala (msnm)" value={MOCK_REPORT.boquilla.scale.toFixed(2)} />
                            <DataRow label="Almacenamiento (Mm³)" value={MOCK_REPORT.boquilla.storage.toFixed(3)} highlight />
                            <DataRow label="T. Baja" value={MOCK_REPORT.boquilla.tBaja === 0 ? "---" : MOCK_REPORT.boquilla.tBaja} />
                            <DataRow label="C.F.E." value={MOCK_REPORT.boquilla.cfe === 0 ? "---" : MOCK_REPORT.boquilla.cfe} />
                            <DataRow label="Extracción Total (m³/s)" value={MOCK_REPORT.boquilla.extraction.toFixed(2)} bold />
                            <DataRow label="% Llenado" value={`${MOCK_REPORT.boquilla.percent.toFixed(2)}%`} />
                        </div>

                        <div className="col-madero border-r border-slate-400 p-2 space-y-1">
                            <DataRow label="Escala (msnm)" value={MOCK_REPORT.madero.scale.toFixed(2)} />
                            <DataRow label="Almacenamiento (Mm³)" value={MOCK_REPORT.madero.storage.toFixed(2)} highlight />
                            <DataRow label="Toma Izq. #1" value={MOCK_REPORT.madero.tomaIzq?.toFixed(2)} />
                            <DataRow label="Toma Der. #2" value={MOCK_REPORT.madero.tomaDer?.toFixed(2)} />
                            <DataRow label="Extracción Total (m³/s)" value={MOCK_REPORT.madero.extraction.toFixed(2)} bold />
                            <DataRow label="% Llenado" value={`${MOCK_REPORT.madero.percent.toFixed(2)}%`} />
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
                        <WeatherColumn data={MOCK_REPORT.boquilla} location="boquilla" />
                        <WeatherColumn data={MOCK_REPORT.madero} location="madero" />
                        <WeatherColumn data={MOCK_REPORT.delicias} location="delicias" last />

                        {/* ROW 4: Previous 24h Header */}
                        <div className="col-span-3 bg-slate-200 border-y border-slate-800 text-center font-bold text-xs uppercase py-1 tracking-wider text-slate-600">
                            24 Horas Anteriores
                        </div>

                        {/* ROW 5: Previous 24h Body */}
                        <Prev24hColumn data={MOCK_REPORT.prev24h.boquilla} />
                        <Prev24hColumn data={MOCK_REPORT.prev24h.madero} />
                        <Prev24hColumn data={MOCK_REPORT.prev24h.delicias} last />

                        {/* ROW 6: Aforos Header */}
                        <div className="col-span-3 bg-slate-800 text-white text-center font-bold text-xs uppercase py-1 tracking-wider">
                            Aforos de Control
                        </div>

                        {/* ROW 7: Aforos Body */}
                        <div className="col-span-3 grid grid-cols-3 divide-x divide-slate-400 border-b border-slate-800">
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 0+580 (Canal Principal)</h4>
                                <DataRow label="Escala" value={MOCK_REPORT.aforos.km0_580.scale.toFixed(2)} />
                                <DataRow label="Gasto (m³/s)" value={MOCK_REPORT.aforos.km0_580.flow.toFixed(3)} bold />
                            </div>
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 106</h4>
                                <DataRow label="Escala" value={MOCK_REPORT.aforos.km106.scale.toFixed(2)} />
                                <DataRow label="Gasto (m³/s)" value={MOCK_REPORT.aforos.km106.flow.toFixed(3)} bold />
                            </div>
                            <div className="p-2">
                                <h4 className="font-bold text-center text-xs uppercase mb-1">Km 104 (Fin)</h4>
                                <DataRow label="Escala" value={MOCK_REPORT.aforos.km104.scale.toFixed(2)} />
                                <DataRow label="Gasto (m³/s)" value={MOCK_REPORT.aforos.km104.flow.toFixed(3)} bold />
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
                                <span>{(MOCK_REPORT.boquilla.storage + MOCK_REPORT.madero.storage).toFixed(3)} Mm³</span>
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

const WeatherColumn = ({ data, last = false }: { data: WeatherData, location: string, last?: boolean }) => (
    <div className={`${!last ? 'border-r border-slate-400' : ''} p-2 space-y-1`}>
        <DataRow label="Temp. Ambiente" value={`${data.tempAmb} °C`} />
        <DataRow label="Temp. Máxima" value={`${data.tempMax} °C`} />
        <DataRow label="Temp. Mínima" value={`${data.tempMin} °C`} />
        <DataRow label="Precipitación" value={`${data.precip} mm`} />
        <DataRow label="Evaporación" value={`${data.evap.toFixed(2)} mm`} />
        <DataRow label="Dir. Viento" value={data.windDir} />
        <DataRow label="Intensidad" value={data.windSpeed} />
        <DataRow label="Visibilidad" value={data.visibility} />
        <div className="flex justify-between items-center mt-2 pt-1 border-t border-slate-200">
            <span className="text-xs text-slate-500 uppercase">Edo. Tiempo</span>
            <div className="flex items-center gap-1 font-bold text-sm">
                <WeatherIcon state={data.weatherState} />
                {data.weatherState}
            </div>
        </div>
    </div>
);

const Prev24hColumn = ({ data, last = false }: { data: any, last?: boolean }) => (
    <div className={`${!last ? 'border-r border-slate-400' : ''} p-2 space-y-1`}>
        <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 uppercase">Edo. Tiempo</span>
            <div className="flex items-center gap-1 font-bold text-xs text-slate-400">
                <WeatherIcon state={data.weatherState} size={12} />
                {data.weatherState}
            </div>
        </div>
        <DataRow label="Dir. Viento" value={data.windDir} />
        <DataRow label="Intensidad" value={data.windSpeed} />
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
