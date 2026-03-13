import React, { useState, useEffect } from 'react';
import { Upload, FileText, Save, Wifi, WifiOff, Loader, Table as TableIcon, FileSpreadsheet, Trash2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

const ImportReport = () => {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'boquilla' | 'madero' | 'delicias'>('boquilla');
    const [importMode, setImportMode] = useState<'manual' | 'excel'>('manual');
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [saving, setSaving] = useState(false);
    const [excelData, setExcelData] = useState<any[]>([]);
    const [importLog, setImportLog] = useState<{ type: 'success' | 'error', message: string }[]>([]);
    const [excelMonthYear, setExcelMonthYear] = useState<{ mesStr: string, year: number } | null>(null);

    // Initial constants
    const AREAS = {
        boquilla: 8020.088,
        madero: 2748.303,
    };

    const CAPACIDAD_TOTAL = {
        boquilla: 2846.782,
        madero: 333.320,
    };

    const ELEVACION = {
        boquilla: 1317.00,
        madero: 1239.30,
    };

    // State for all 3 entities
    const [formData, setFormData] = useState<any>({
        boquilla: {
            // Presa
            escala: '', almacenamiento: '', t_baja: '', cfe: '', extraccion_total: 'Cerrada', porcentaje: '',
            // Clima
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            // 24h
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            // Aforo
            aforo_escala: '', aforo_gasto: ''
        },
        madero: {
            escala: '', almacenamiento: '', toma_izq: '', toma_der: '', extraccion_total: 'Cerrada', porcentaje: '',
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            aforo_escala: '', aforo_gasto: ''
        },
        delicias: {
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            aforo_escala: '', aforo_gasto: ''
        }
    });

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const handleChange = (tab: string, field: string, value: any) => {
        setFormData((prev: any) => ({
            ...prev,
            [tab]: {
                ...prev[tab],
                [field]: value
            }
        }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result as string);
            reader.readAsDataURL(file);
            setImportMode('manual');
        }
    };

    const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const bstr = evt.target?.result;
                    const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
                    const wsname = wb.SheetNames[0];
                    const ws = wb.Sheets[wsname];

                    // Read as an array of arrays to handle the complex visual layout
                    const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

                    // 1. Find the Month and Year from the Main Title (e.g. "Datos Hidrológicos de Presas ENERO 2020")
                    let detectedMonth = '';
                    let detectedYear = new Date().getFullYear();

                    for (let i = 0; i < Math.min(10, rawData.length); i++) {
                        const rowStr = rawData[i]?.join(' ').toUpperCase() || '';
                        if (rowStr.includes('DATOS HIDROL') || rowStr.includes('PRESAS')) {
                            // Extract Year
                            const yearMatch = rowStr.match(/\b(20\d{2})\b/);
                            if (yearMatch) detectedYear = parseInt(yearMatch[1]);

                            // Extract Month
                            const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
                            const foundMonth = meses.find(m => rowStr.includes(m));
                            if (foundMonth) detectedMonth = foundMonth;
                            break;
                        }
                    }

                    if (!detectedMonth) {
                        toast.error('No se detectó el MES en el título del archivo. Verifica el formato.');
                        return;
                    }

                    setExcelMonthYear({ mesStr: detectedMonth, year: detectedYear });

                    // 2. Find the header row where "DIA" and "ESCALA" are defined
                    let headerRowIndex = -1;
                    for (let i = 0; i < Math.min(30, rawData.length); i++) {
                        const row = rawData[i] || [];
                        const rowString = row.join(' ').toLowerCase();
                        if (rowString.includes('dia') || rowString.includes('día')) {
                            headerRowIndex = i;
                            break;
                        }
                    }

                    if (headerRowIndex === -1) {
                        toast.error('No se encontró la fila principal de encabezados (DIA, ESCALA).');
                        return;
                    }

                    // 3. Extract purely the numeric rows for days 1 to 31
                    const extractedData: any[] = [];
                    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                        const row = rawData[i];
                        if (!row || row.length === 0) continue;

                        // Check if the first column is a number between 1 and 31 (the DAY)
                        const rawDay = row[0];
                        const dayNum = parseInt(rawDay);

                        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
                            extractedData.push(row);
                        }

                        // Stop parsing if we hit day 31
                        if (dayNum === 31) break;
                    }

                    setExcelData(extractedData);
                    setImportMode('excel');
                    setImagePreview(null);
                    toast.success(`Tablero Histórico SRL detectado: ${detectedMonth} ${detectedYear}. ${extractedData.length} días extraídos.`);
                } catch (err) {
                    toast.error('Error procesando Excel: Formato no válido.');
                }
            };
            reader.readAsBinaryString(file);
        }
    };

    const handleSaveExcelData = async () => {
        if (excelData.length === 0 || !excelMonthYear) return;
        setSaving(true);
        setImportLog([]);

        const logs: { type: 'success' | 'error', message: string }[] = [];

        try {
            const mesesMap: { [key: string]: string } = {
                'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
                'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
                'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
            };

            const targetMonth = mesesMap[excelMonthYear.mesStr];

            for (const row of excelData) {
                // Determine Date
                const dayStr = row[0].toString().padStart(2, '0');
                const dateStr = `${excelMonthYear.year}-${targetMonth}-${dayStr}`;

                // --- BOQUILLA EXTRACTION --- (Columns 1 to 5 conceptually in SRL Excel)
                // Note: The exact array indexes depend on merged cells, but typically:
                // 0: Dia, 1: Escala Boquilla, 2: Dif, 3: Almacen, 4: Dif Mm3, 5: %

                const boqEscala = parseFloat(row[1]) || null;
                const boqAlmacen = parseFloat(row[3]) || null;
                const boqPct = parseFloat(row[5]) || null;
                // Extraction typically in col 10 (total) or 6 if different merge
                const boqExtraccion = parseFloat(row[10]) || parseFloat(row[6]) || 0;

                let boqNotes = '';
                if (row[2]) boqNotes += `Dif Elev: ${row[2]}m. `;
                if (row[4]) boqNotes += `Dif Vol: ${row[4]}Mm3. `;

                if (boqEscala && boqAlmacen) {
                    // SRL Excel stores in 'Millares de m³'. We convert to 'Mm³'.
                    const boqAlmacenMm3 = boqAlmacen > 10000 ? boqAlmacen / 1000 : boqAlmacen;
                    
                    const { error: err1 } = await supabase.from('lecturas_presas').upsert({
                        presa_id: 'PRE-001',
                        fecha: dateStr,
                        escala_msnm: boqEscala,
                        almacenamiento_mm3: boqAlmacenMm3,
                        porcentaje_llenado: boqPct,
                        extraccion_total_m3s: boqExtraccion,
                        notas: boqNotes
                    }, { onConflict: 'presa_id, fecha' });

                    if (err1) logs.push({ type: 'error', message: `Boquilla Día ${dayStr}: ${err1.message}` });
                }

                // --- MADERO EXTRACTION --- (Right Side of the Excel)
                // Looking for Madero specific numerical scale > 1200

                let madEscalaIndex = -1;
                for (let col = 6; col < row.length; col++) {
                    const val = parseFloat(row[col]);
                    // Madero typical scales: 1230.XX
                    if (!isNaN(val) && val > 1200 && val < 1250 && col !== 1) {
                        madEscalaIndex = col;
                        break;
                    }
                }

                if (madEscalaIndex !== -1) {
                    const madEscala = parseFloat(row[madEscalaIndex]) || null;
                    const madAlmacen = parseFloat(row[madEscalaIndex + 2]) || null;
                    const madPct = parseFloat(row[madEscalaIndex + 4]) || null;
                    const madExtraccion = parseFloat(row[madEscalaIndex + 5]) || parseFloat(row[madEscalaIndex + 4]) || 0;

                    let madNotes = '';
                    if (row[madEscalaIndex + 1]) madNotes += `Dif Elev: ${row[madEscalaIndex + 1]}m. `;
                    if (row[madEscalaIndex + 3]) madNotes += `Dif Vol: ${row[madEscalaIndex + 3]}Mm3. `;

                    if (madEscala && madAlmacen) {
                        // SRL Excel stores in 'Millares de m³'. We convert to 'Mm³'.
                        const madAlmacenMm3 = madAlmacen > 10000 ? madAlmacen / 1000 : madAlmacen;

                        const { error: err2 } = await supabase.from('lecturas_presas').upsert({
                            presa_id: 'PRE-002',
                            fecha: dateStr,
                            escala_msnm: madEscala,
                            almacenamiento_mm3: madAlmacenMm3,
                            porcentaje_llenado: madPct,
                            extraccion_total_m3s: madExtraccion,
                            notas: madNotes
                        }, { onConflict: 'presa_id, fecha' });

                        if (err2) logs.push({ type: 'error', message: `Madero Día ${dayStr}: ${err2.message}` });
                    }
                }
            }

            logs.push({ type: 'success', message: `Procesamiento SRL Finalizado for ${excelMonthYear.mesStr} ${excelMonthYear.year}` });
            setImportLog(logs);
            toast.success('Inyección Histórica Completada');
        } catch (error: any) {
            toast.error('Error crítico durante la importación: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const data = formData[activeTab];
            const presaIdMap: Record<string, string> = { boquilla: 'PRE-001', madero: 'PRE-002', delicias: 'PRE-003' };
            const presaId = presaIdMap[activeTab];
            const today = new Date().toISOString().split('T')[0];

            // 1. Save Hydraulic Data (Only for dams)
            if (activeTab !== 'delicias') {
                const extraccion = isNaN(Number(data.extraccion_total)) ? 0 : Number(data.extraccion_total);
                let almacenamiento = Number(data.almacenamiento) || 0;
                
                // If user enters a value in 'Miles de m³' (e.g. 47,787), convert to Mm³
                if (almacenamiento > 10000) almacenamiento = almacenamiento / 1000;

                const { error: errPresa } = await supabase.from('lecturas_presas').upsert({
                    presa_id: presaId,
                    fecha: today,
                    escala_msnm: Number(data.escala) || null,
                    almacenamiento_mm3: almacenamiento || null,
                    porcentaje_llenado: Number(data.porcentaje) || null,
                    extraccion_total_m3s: extraccion,
                    gasto_toma_baja_m3s: activeTab === 'boquilla' ? (Number(data.t_baja) || null) : null,
                    gasto_cfe_m3s: activeTab === 'boquilla' ? (Number(data.cfe) || null) : null,
                    gasto_toma_izq_m3s: activeTab === 'madero' ? (Number(data.toma_izq) || null) : null,
                    gasto_toma_der_m3s: activeTab === 'madero' ? (Number(data.toma_der) || null) : null,
                    notas: isNaN(Number(data.extraccion_total)) ? `Extracción: ${data.extraccion_total}` : null
                }, { onConflict: 'presa_id, fecha' });
                if (errPresa) throw errPresa;
            }

            // 2. Save Weather Data
            const precip = data.precipitacion === 'Ø' || data.precipitacion === '0' || data.precipitacion === '' ? 0 : Number(data.precipitacion);
            const { error: errClima } = await supabase.from('clima_presas').upsert({
                presa_id: presaId,
                fecha: today,
                temp_ambiente_c: Number(data.temp_ambiente) || null,
                temp_maxima_c: Number(data.temp_maxima) || null,
                temp_minima_c: Number(data.temp_minima) || null,
                precipitacion_mm: isNaN(precip) ? null : precip,
                evaporacion_mm: Number(data.evaporacion) || null,
                dir_viento: data.dir_viento || null,
                intensidad_viento: data.intensidad || null,
                visibilidad: data.visibilidad || null,
                edo_tiempo: data.edo_tiempo || null,
                edo_tiempo_24h: data.edo_tiempo_24h || null,
                dir_viento_24h: data.dir_viento_24h || null,
                intensidad_24h: data.intensidad_24h || null
            }, { onConflict: 'presa_id, fecha' });
            if (errClima) throw errClima;

            // 3. Save Aforo Data
            const estacionMap: Record<string, string> = { boquilla: 'Km 0+580', madero: 'Km 106', delicias: 'Km 104' };
            const estacion = estacionMap[activeTab];

            if (data.aforo_escala || data.aforo_gasto) {
                const { error: errAforo } = await supabase.from('aforos_principales_diarios').upsert({
                    fecha: today,
                    estacion: estacion,
                    escala: Number(data.aforo_escala) || null,
                    gasto_m3s: Number(data.aforo_gasto) || null
                }, { onConflict: 'fecha, estacion' });
                if (errAforo) throw errAforo;
            }

            toast.success(`Captura Oficial (${activeTab.toUpperCase()}) Guardada Correctamente.`);
        } catch (error: any) {
            toast.error('Error guardando: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const EDO_TIEMPO_OPTIONS = ["Soleado", "Medio Nublado", "Nublado", "Lluvia Ligera", "Frío", "Caluroso"];
    const currentData = formData[activeTab];

    return (
        <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
            {/* LEFT: Source / Preview */}
            <div className="w-1/2 h-full border-r border-slate-700 flex flex-col bg-slate-800/50">
                <header className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/40">
                    <h2 className="font-bold flex items-center gap-2 text-white">
                        <FileText className="text-blue-400" />
                        {importMode === 'excel' ? 'Análisis de Base de Datos Excel' : 'Referencia Visual (Reporte CONAGUA)'}
                    </h2>
                    <div className="flex gap-2">
                        <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-2 transition-colors border border-slate-600">
                            <Upload size={14} />
                            Captura Manual
                            <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                        </label>
                        <label className="cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20">
                            <FileSpreadsheet size={14} />
                            Importar Excel
                            <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleExcelUpload} />
                        </label>
                    </div>
                </header>

                <div className="flex-1 overflow-auto p-4 flex flex-col items-center justify-center relative">
                    {importMode === 'excel' && excelData.length > 0 ? (
                        <div className="w-full h-full bg-slate-900 rounded-xl border border-slate-700 flex flex-col overflow-hidden">
                            <div className="p-3 bg-slate-800 flex justify-between items-center border-b border-slate-700">
                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                                    <FileSpreadsheet size={16} />
                                    Formato Oficial SRL ({excelMonthYear?.mesStr} {excelMonthYear?.year}) — {excelData.length} Tableros Diarios
                                </span>
                                <button onClick={() => { setExcelData([]); setImportMode('manual'); setExcelMonthYear(null); }} className="text-rose-400 hover:text-rose-300 transition-colors">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-auto">
                                <table className="w-full text-left text-[10px] border-collapse">
                                    <thead className="bg-slate-950 sticky top-0 shadow-lg">
                                        <tr>
                                            <th className="p-2.5 border-b border-r border-slate-800 text-slate-500 font-bold uppercase tracking-tighter">Día</th>
                                            <th className="p-2.5 border-b border-blue-900 bg-blue-500/10 text-blue-400 font-bold uppercase">Boq (Escala)</th>
                                            <th className="p-2.5 border-b border-blue-900 bg-blue-500/10 text-blue-400 font-bold uppercase">Boq (Mm³)</th>
                                            <th className="p-2.5 border-b border-cyan-900 bg-cyan-500/10 text-cyan-400 font-bold uppercase">Boq (m³/s)</th>
                                            <th className="p-2.5 border-b border-amber-900 bg-amber-500/10 text-amber-400 font-bold uppercase">Mad (Escala)</th>
                                            <th className="p-2.5 border-b border-amber-900 bg-amber-500/10 text-amber-400 font-bold uppercase">Mad (Mm³)</th>
                                            <th className="p-2.5 border-b border-emerald-900 bg-emerald-500/10 text-emerald-400 font-bold uppercase">Mad (m³/s)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {excelData.slice(0, 31).map((row, i) => {
                                            // Extract for preview
                                            const dia = row[0];
                                            const boqEscala = parseFloat(row[1]) ? parseFloat(row[1]).toFixed(2) : '--';
                                            const boqVol = parseFloat(row[3]) ? parseFloat(row[3]).toFixed(2) : '--';
                                            const boqExtValor = parseFloat(row[10]) || parseFloat(row[6]);
                                            const boqExt = boqExtValor ? boqExtValor.toFixed(2) : '--';

                                            // Find Madero roughly
                                            let madEscalaIndex = -1;
                                            for (let col = 6; col < row.length; col++) {
                                                const val = parseFloat(row[col]);
                                                if (!isNaN(val) && val > 1200 && val < 1250) {
                                                    madEscalaIndex = col; break;
                                                }
                                            }
                                            const madEscala = madEscalaIndex !== -1 && parseFloat(row[madEscalaIndex]) ? parseFloat(row[madEscalaIndex]).toFixed(2) : '--';
                                            const madVol = madEscalaIndex !== -1 && parseFloat(row[madEscalaIndex + 2]) ? parseFloat(row[madEscalaIndex + 2]).toFixed(2) : '--';
                                            const madExt = madEscalaIndex !== -1 && parseFloat(row[madEscalaIndex + 5]) ? parseFloat(row[madEscalaIndex + 5]).toFixed(2) : '--';

                                            return (
                                                <tr key={i} className="hover:bg-slate-800/50 transition-colors group font-mono text-slate-300">
                                                    <td className="p-2.5 border-r border-slate-800 font-black">{dia}</td>
                                                    <td className="p-2.5 bg-blue-500/5">{boqEscala}</td>
                                                    <td className="p-2.5 bg-blue-500/5">{boqVol}</td>
                                                    <td className="p-2.5 bg-cyan-500/5 text-cyan-400">{boqExt}</td>
                                                    <td className="p-2.5 bg-amber-500/5">{madEscala}</td>
                                                    <td className="p-2.5 bg-amber-500/5">{madVol}</td>
                                                    <td className="p-2.5 bg-emerald-500/5 text-emerald-400">{madExt}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-4 border-t border-slate-700 bg-slate-950 flex flex-col gap-3">
                                <div className="flex items-center gap-3 text-emerald-400 text-[10px] bg-emerald-400/5 p-3 rounded-lg border border-emerald-400/20 leading-relaxed font-mono">
                                    <CheckCircle size={14} className="flex-shrink-0" />
                                    <span>Sistema de mapeo visual activo. Los datos de Boquilla (Izquierda) y Madero (Derecha) se inyectarán de forma concurrente para los 31 días.</span>
                                </div>
                                <button onClick={handleSaveExcelData} disabled={saving} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-emerald-900/20 active:scale-[0.98]">
                                    {saving ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
                                    Inyectar Registros Históricos
                                </button>
                            </div>
                        </div>
                    ) : imagePreview ? (
                        <div className="w-full h-full p-4 flex items-center justify-center">
                            <img src={imagePreview} alt="Reporte Escaneado" className="max-w-full shadow-2xl border border-slate-600 rounded-lg" />
                        </div>
                    ) : (
                        <div className="text-center text-slate-500 p-8 max-w-sm">
                            <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-8 border border-slate-700/50 shadow-inner">
                                <Upload size={40} className="opacity-20" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-3 uppercase tracking-wide">Fuente de Información</h3>
                            <p className="text-xs leading-relaxed opacity-60">Sube el reporte oficial impreso para validación visual o inyecta una base de datos histórica mediante Excel.</p>
                        </div>
                    )}

                    {importLog.length > 0 && (
                        <div className="absolute bottom-6 left-6 right-6 max-h-48 bg-slate-950/90 backdrop-blur-md border border-slate-700/50 rounded-xl overflow-y-auto p-3 text-[9px] font-mono shadow-2xl scrollbar-thin">
                            <div className="sticky top-0 bg-slate-900/50 backdrop-blur pb-2 border-b border-slate-800 mb-2 flex justify-between items-center text-slate-500 font-bold">
                                <span className="flex items-center gap-2"><TableIcon size={12} /> BITÁCORA DE TRANSACCIONES</span>
                                <button onClick={() => setImportLog([])} className="hover:text-white transition-colors">[CERRAR]</button>
                            </div>
                            <div className="space-y-1">
                                {importLog.map((log, i) => (
                                    <div key={i} className={`flex items-start gap-2 ${log.type === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                        <span className="opacity-50">[{i + 1}]</span>
                                        <span className={`px-1 rounded ${log.type === 'error' ? 'bg-rose-500/10' : 'bg-emerald-500/10'}`}>
                                            {log.type === 'error' ? '✖' : '✔'}
                                        </span>
                                        {log.message}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: Data Entry Form */}
            <div className="w-1/2 h-full flex flex-col">
                <header className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-md flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h2 className="font-bold text-lg mb-0 flex items-center gap-2">
                            Captura de Datos Oficiales
                            <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-mono ${isOnline ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                                {isOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
                                {isOnline ? 'CONECTADO' : 'SIN CONEXIÓN'}
                            </span>
                        </h2>
                    </div>
                    <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
                        <TabButton id="boquilla" label="Presa Boquilla" active={activeTab} onClick={() => setActiveTab('boquilla')} />
                        <TabButton id="madero" label="Presa Fco. I. Madero" active={activeTab} onClick={() => setActiveTab('madero')} />
                        <TabButton id="delicias" label="Delicias" active={activeTab} onClick={() => setActiveTab('delicias')} />
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-700">
                    <div className="max-w-2xl mx-auto space-y-6">

                        {/* DATOS HIDRAULICOS (Solo Presas) */}
                        {activeTab !== 'delicias' && (
                            <section className="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50 shadow-sm">
                                <h3 className="text-blue-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                                    Datos Hidráulicos
                                </h3>
                                <div className="grid grid-cols-2 gap-5 mb-5">
                                    <InputGroup label="Escala (m.s.n.m)" value={currentData.escala} onChange={(v: any) => handleChange(activeTab, 'escala', v)} placeholder={ELEVACION[activeTab].toString()} />
                                    <InputGroup label="Almacenamiento (Mm³)" value={currentData.almacenamiento} onChange={(v: any) => handleChange(activeTab, 'almacenamiento', v)} />
                                </div>

                                <div className="grid grid-cols-2 gap-5 mb-5">
                                    {activeTab === 'boquilla' ? (
                                        <>
                                            <InputGroup label="T. Baja" value={currentData.t_baja} onChange={(v: any) => handleChange(activeTab, 't_baja', v)} type="text" placeholder="--" />
                                            <InputGroup label="C.F.E." value={currentData.cfe} onChange={(v: any) => handleChange(activeTab, 'cfe', v)} type="text" placeholder="--" />
                                        </>
                                    ) : (
                                        <>
                                            <InputGroup label="Toma Izq. #1" value={currentData.toma_izq} onChange={(v: any) => handleChange(activeTab, 'toma_izq', v)} type="text" placeholder="--" />
                                            <InputGroup label="Toma Der. #2" value={currentData.toma_der} onChange={(v: any) => handleChange(activeTab, 'toma_der', v)} type="text" placeholder="--" />
                                        </>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-5">
                                    <InputGroup label="Extracción Total (m³/Seg)" value={currentData.extraccion_total} onChange={(v: any) => handleChange(activeTab, 'extraccion_total', v)} type="text" />
                                    <InputGroup label="Porcentaje (%)" value={currentData.porcentaje} onChange={(v: any) => handleChange(activeTab, 'porcentaje', v)} />
                                </div>
                            </section>
                        )}

                        {/* CLIMA */}
                        <section className="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50 shadow-sm">
                            <h3 className="text-amber-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                                Datos Climatológicos
                            </h3>
                            <div className="grid grid-cols-3 gap-5 mb-5">
                                <InputGroup label="Temp. Ambiente (°C)" value={currentData.temp_ambiente} onChange={(v: any) => handleChange(activeTab, 'temp_ambiente', v)} />
                                <InputGroup label="Temp. Máxima (°C)" value={currentData.temp_maxima} onChange={(v: any) => handleChange(activeTab, 'temp_maxima', v)} />
                                <InputGroup label="Temp. Mínima (°C)" value={currentData.temp_minima} onChange={(v: any) => handleChange(activeTab, 'temp_minima', v)} />
                            </div>
                            <div className="grid grid-cols-3 gap-5 mb-5">
                                <InputGroup label="Precipitación (mm)" value={currentData.precipitacion} onChange={(v: any) => handleChange(activeTab, 'precipitacion', v)} type="text" placeholder="Ø" />
                                <InputGroup label="Evaporación (mm)" value={currentData.evaporacion} onChange={(v: any) => handleChange(activeTab, 'evaporacion', v)} />
                                <InputGroup label="Dir. Viento" value={currentData.dir_viento} onChange={(v: any) => handleChange(activeTab, 'dir_viento', v)} type="text" placeholder="SE" />
                            </div>
                            <div className="grid grid-cols-3 gap-5">
                                <InputGroup label="Intensidad Viento" value={currentData.intensidad} onChange={(v: any) => handleChange(activeTab, 'intensidad', v)} type="text" placeholder="--" />
                                <InputGroup label="Visibilidad" value={currentData.visibilidad} onChange={(v: any) => handleChange(activeTab, 'visibilidad', v)} type="text" placeholder="4T" />
                                <SelectGroup label="Edo. del Tiempo" value={currentData.edo_tiempo} onChange={(v: any) => handleChange(activeTab, 'edo_tiempo', v)} options={EDO_TIEMPO_OPTIONS} />
                            </div>
                        </section>

                        {/* 24 HORAS ANTERIORES */}
                        <section className="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50 shadow-sm">
                            <h3 className="text-purple-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></div>
                                24 Horas Anteriores
                            </h3>
                            <div className="grid grid-cols-3 gap-5">
                                <SelectGroup label="Edo. del Tiempo" value={currentData.edo_tiempo_24h} onChange={(v: any) => handleChange(activeTab, 'edo_tiempo_24h', v)} options={EDO_TIEMPO_OPTIONS} />
                                <InputGroup label="Dir. Viento" value={currentData.dir_viento_24h} onChange={(v: any) => handleChange(activeTab, 'dir_viento_24h', v)} type="text" placeholder="SE" />
                                <InputGroup label="Intensidad" value={currentData.intensidad_24h} onChange={(v: any) => handleChange(activeTab, 'intensidad_24h', v)} type="text" placeholder="--" />
                            </div>
                        </section>

                        {/* AFOROS */}
                        <section className="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50 shadow-sm">
                            <h3 className="text-emerald-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                                Aforos Principales ({activeTab === 'boquilla' ? 'Km 0+580' : activeTab === 'madero' ? 'Km 106' : 'Km 104'})
                            </h3>
                            <div className="grid grid-cols-2 gap-5">
                                <InputGroup label="Escala" value={currentData.aforo_escala} onChange={(v: any) => handleChange(activeTab, 'aforo_escala', v)} type="text" />
                                <InputGroup label="Gasto (m³/Seg)" value={currentData.aforo_gasto} onChange={(v: any) => handleChange(activeTab, 'aforo_gasto', v)} type="text" />
                            </div>
                        </section>

                        {/* Constantes Informativas */}
                        {activeTab !== 'delicias' && (
                            <section className="bg-slate-900/50 p-4 rounded-xl border border-dashed border-slate-700 mt-8 mb-4">
                                <h4 className="text-[9px] font-mono text-slate-500 uppercase tracking-[0.3em] mb-2 text-center">Referencia Técnica</h4>
                                <div className="flex justify-around text-[10px] text-slate-400 font-mono">
                                    <div><span className="opacity-50">ÁREA:</span> <span className="text-blue-300 font-bold">{AREAS[activeTab]} ha</span></div>
                                    <div><span className="opacity-50">CAPACIDAD NAMO:</span> <span className="text-blue-300 font-bold">{CAPACIDAD_TOTAL[activeTab]} Mm³</span></div>
                                </div>
                            </section>
                        )}
                        <br />
                    </div>
                </div>

                <footer className="p-4 border-t border-slate-700/50 bg-slate-800/80 backdrop-blur-md flex justify-end items-center">
                    <button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white px-8 py-3.5 rounded-xl font-bold text-sm flex items-center gap-3 shadow-xl shadow-blue-900/20 border border-blue-400/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 active:scale-95">
                        {saving ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
                        Guardar Captura Diaria
                    </button>
                </footer>
            </div>
        </div>
    );
};

// Componentes Auxiliares
const TabButton = ({ id, label, active, onClick }: { id: string, label: string, active: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`flex-1 px-4 py-2.5 text-xs font-bold transition-all rounded-md ${active === id
            ? 'bg-blue-600/10 text-blue-400 shadow-sm'
            : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
            }`}
    >
        {label}
    </button>
);

const InputGroup = ({ label, placeholder, value, onChange, type = "number" }: any) => (
    <div className="group">
        <label className="block text-[9px] uppercase text-slate-500 font-bold mb-1.5 tracking-wider transition-colors group-focus-within:text-blue-400">{label}</label>
        <div className="relative">
            <input
                type={type}
                placeholder={placeholder}
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 outline-none font-mono placeholder-slate-700 transition-all shadow-inner"
            />
        </div>
    </div>
);

const SelectGroup = ({ label, value, onChange, options }: any) => (
    <div className="group">
        <label className="block text-[9px] uppercase text-slate-500 font-bold mb-1.5 tracking-wider transition-colors group-focus-within:text-blue-400">{label}</label>
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 outline-none placeholder-slate-500 transition-all font-mono appearance-none"
        >
            <option value="">--</option>
            {options.map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    </div>
);

export default ImportReport;
