/** Carga un asset público (ruta bajo /public) y lo devuelve como data URI
 *  base64 — para incrustarlo en un informe HTML autónomo que debe abrir sin
 *  conexión. Antes vivía como función privada de exportClimaReport.ts;
 *  movida aquí para que otros generadores de informe (ej.
 *  exportClimaGeoInforme.ts) no tengan que importar ese módulo completo solo
 *  por esta utilidad. */
export async function assetToDataURI(path: string): Promise<string> {
    try {
        const res = await fetch(path);
        if (!res.ok) return '';
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : '');
            r.readAsDataURL(blob);
        });
    } catch { return ''; }
}
