/**
 * Rutas que un usuario INVITADO (solo lectura) puede abrir.
 * Todo lo que no esté aquí muestra AccesoRestringido. Es una barrera de UX:
 * la seguridad real es el RLS de la BD (migración 20261106100000_rol_invitado_solo_lectura.sql).
 */
export const RUTAS_INVITADO: readonly string[] = [
    '/',
    '/monitor-publico',
    '/escalas',
    '/canales',
    '/presas',
    '/clima',
    '/geo-monitor',
    '/analisis-historico',
    '/balance',
    '/modelacion-hidraulica',
    '/invitado-ia',
];

export function invitadoPuedeVer(pathname: string): boolean {
    const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    return RUTAS_INVITADO.includes(p);
}
