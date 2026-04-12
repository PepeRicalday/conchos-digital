/**
 * exportCanal.ts — Utilidades de exportación para Conchos Digital
 * CSV de telemetría de escalas, descarga directa en el navegador.
 */

export interface EscalaExportRow {
    id: string;
    nombre: string;
    km: number;
    nivel_actual?: number | null;
    nivel_max_operativo?: number | null;
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    delta_12h?: number | null;
    ultima_telemetria?: number | null;
    estado?: string;
    pct_bordo?: number | null;
}

function formatTs(ts?: number | null): string {
    if (!ts) return '';
    return new Date(ts).toLocaleString('es-MX', {
        timeZone: 'America/Chihuahua',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

export function exportEscalasCSV(escalas: EscalaExportRow[], filename?: string): void {
    const headers = [
        'Nombre', 'KM', 'Nivel (m)', 'Nivel Máx Op. (m)', '% Bordo',
        'Gasto (m³/s)', 'Apertura (m)', 'Δ12h (m)',
        'Último dato', 'Estado',
    ];

    const rows = escalas
        .filter(e => e.km >= 0 && e.km <= 104)
        .sort((a, b) => a.km - b.km)
        .map(e => {
            const pct = e.nivel_actual != null && e.nivel_max_operativo
                ? ((e.nivel_actual / e.nivel_max_operativo) * 100).toFixed(1)
                : '';
            return [
                e.nombre,
                e.km.toFixed(1),
                e.nivel_actual?.toFixed(3) ?? '',
                e.nivel_max_operativo?.toFixed(2) ?? '',
                pct,
                e.gasto_actual?.toFixed(3) ?? '',
                e.apertura_actual?.toFixed(3) ?? '',
                e.delta_12h?.toFixed(3) ?? '',
                formatTs(e.ultima_telemetria),
                e.estado ?? '',
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toLocaleDateString('en-CA');
    a.href     = url;
    a.download = filename ?? `conchos-telemetria-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
