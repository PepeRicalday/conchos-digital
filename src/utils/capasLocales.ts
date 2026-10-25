/**
 * Registro de capas locales abiertas dentro de un modal (tooltip, menú, popover). Escape cierra primero la de
 * arriba y solo cuando no queda ninguna cierra el modal (comportamiento estándar de un popover).
 * Lo usa `useModalA11y` (historico) y lo alimenta `useCapaLocal`.
 */
const capas: { id: symbol; cerrar: () => void }[] = [];

/** Registra una capa; devuelve la función que la retira (idempotente). */
export function registrarCapaLocal(cerrar: () => void): () => void {
    const id = Symbol('capa-local');
    capas.push({ id, cerrar });
    return () => { const i = capas.findIndex(c => c.id === id); if (i >= 0) capas.splice(i, 1); };
}

/** Cierra la capa de arriba. `true` si había una (Escape ya está atendido); `false` si el modal debe cerrarse. */
export function cerrarCapaSuperior(): boolean {
    const capa = capas[capas.length - 1];
    if (!capa) return false;
    capa.cerrar();
    return true;
}

export const capasLocalesAbiertas = () => capas.length;
