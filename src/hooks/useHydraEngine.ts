import { useHydraStore } from '../store/useHydraStore';
export type { SectionData, DeliveryPoint, ModuleData } from '../store/useHydraStore';

/**
 * Selector puro del estado hidráulico.
 * El ciclo de vida de la suscripción Realtime se gestiona en Layout.tsx
 * (initSubscription al montar, destroySubscription al desmontar).
 * Este hook NO inicia ni destruye suscripciones — solo lee datos del store.
 */
export const useHydraEngine = () => {
    const { modules, loading, error, fetchHydraulicData } = useHydraStore();
    return { modules, loading, error, refresh: fetchHydraulicData };
};
