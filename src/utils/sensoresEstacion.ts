// Sensores que una estación no mide bien (clima_estaciones.sensores_no_confiables).
// La BD ya guarda esas columnas como NULL (S/D, nunca 0): esto solo lo explica en pantalla e informes.

const NOMBRE: Array<[string[], string]> = [
    [['temp_c', 'temp_max_c', 'temp_min_c', 'punto_rocio_c'], 'temperatura'],
    [['hum_rel_pct'], 'humedad'],
    [['viento_ms', 'viento_dir_deg', 'viento_rafaga_ms'], 'viento'],
    [['eto_mm', 'et_dia_mm', 'et_mes_mm', 'gdd'], 'ETₒ y grados-día'],
];

/** ['temp_c','hum_rel_pct','viento_ms', …] → "temperatura, humedad, viento y ETₒ y grados-día"; '' si no hay ninguno. */
export function sensoresLegibles(cols: string[] | null | undefined): string {
    const lista = NOMBRE.filter(([cs]) => cs.some(c => cols?.includes(c))).map(([, n]) => n);
    if (lista.length <= 1) return lista.join('');
    return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}
