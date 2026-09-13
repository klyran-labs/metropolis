import { useSyncExternalStore } from 'react';
import { fleetSyncEngine, type FleetSyncSnapshot } from '../services/fleetSyncEngine';

export function useFleetSync(): FleetSyncSnapshot {
  return useSyncExternalStore(
    fleetSyncEngine.subscribe,
    fleetSyncEngine.getSnapshot,
    fleetSyncEngine.getSnapshot
  );
}

export function useCurrentBlock(): bigint | null {
  return useSyncExternalStore(
    fleetSyncEngine.subscribe,
    () => fleetSyncEngine.getSnapshot().currentBlock,
    () => null
  );
}
