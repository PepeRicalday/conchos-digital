import { supabase } from './supabase';

/**
 * SICA 005 — Centralized Realtime Hub
 *
 * Problem solved (P2-8):
 *   Previously, 8 separate Supabase channels were created across stores, hooks,
 *   and page components. Several tables were subscribed in multiple places
 *   simultaneously (lecturas_escalas × 3, sica_eventos_log × 2, etc.), causing
 *   redundant network traffic and hard-to-trace double-dispatch bugs.
 *
 * Solution:
 *   A single channel ('sica_realtime_hub') subscribes to ALL tables.
 *   Components/hooks register handlers via onTable() and receive events
 *   through a module-level registry. The channel is started once by Layout.tsx
 *   and torn down on logout.
 *
 * Usage:
 *   import { onTable } from '../lib/realtimeHub';
 *
 *   useEffect(() => {
 *       const unsub = onTable('registro_alertas', '*', () => fetchAlerts());
 *       return unsub;
 *   }, [fetchAlerts]);
 */

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE' | '*';
export type UnsubscribeFn = () => void;

// Module-level handler registry: key = `${table}:${event}`
const registry = new Map<string, Set<(payload: any) => void>>();

let hubChannel: ReturnType<typeof supabase.channel> | null = null;

/**
 * All table:event combos the hub watches.
 * Add an entry here when a new table needs Realtime tracking anywhere in the app.
 */
const WATCHED: Array<{ table: string; event: RealtimeEventType }> = [
    { table: 'mediciones',                event: 'INSERT'  },
    { table: 'mediciones',                event: 'UPDATE'  },
    { table: 'mediciones',                event: 'DELETE'  },
    { table: 'lecturas_escalas',          event: '*'       },
    { table: 'lecturas_presas',           event: '*'       },
    { table: 'movimientos_presas',        event: '*'       },
    { table: 'sica_eventos_log',          event: '*'       },
    { table: 'sica_llenado_seguimiento',  event: 'UPDATE'  },
    { table: 'registro_alertas',          event: '*'       },
    { table: 'reportes_operacion',        event: '*'       },
];

function dispatch(table: string, payload: any): void {
    const eventType = payload.eventType as string; // 'INSERT' | 'UPDATE' | 'DELETE'
    // Fire handlers registered for the specific event type
    registry.get(`${table}:${eventType}`)?.forEach(h => h(payload));
    // Fire wildcard handlers
    registry.get(`${table}:*`)?.forEach(h => h(payload));
}

/**
 * Register a handler for a given table + event combination.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 * Safe to call before startHub(); handlers are queued in the registry.
 */
export function onTable(
    table: string,
    event: RealtimeEventType,
    handler: (payload: any) => void,
): UnsubscribeFn {
    const key = `${table}:${event}`;
    if (!registry.has(key)) registry.set(key, new Set());
    registry.get(key)!.add(handler);
    return () => registry.get(key)?.delete(handler);
}

/**
 * Start the single centralized Realtime channel.
 * Call once from Layout on mount. Idempotent.
 */
export function startHub(): void {
    if (hubChannel) return;

    let builder = supabase.channel('sica_realtime_hub');
    for (const { table, event } of WATCHED) {
        builder = builder.on(
            'postgres_changes',
            { event: event as any, schema: 'public', table },
            (payload) => dispatch(table, payload),
        );
    }
    hubChannel = builder.subscribe((status) => {
        console.debug(`[RealtimeHub] ${status}`);
    });
}

/**
 * Stop and clean up the hub channel.
 * Call from Layout on unmount (logout).
 */
export function stopHub(): void {
    if (!hubChannel) return;
    supabase.removeChannel(hubChannel);
    hubChannel = null;
}
