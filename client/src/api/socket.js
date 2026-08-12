import { io } from 'socket.io-client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Same origin in dev — vite.config.js proxies /socket.io to the API server
// alongside /api, so the browser never needs a separate host/port.
const socket = io({ autoConnect: false });

/**
 * Subscribe to camp:occupancy for the lifetime of the calling component.
 * On receipt this only invalidates the `camps` query key, per spec section
 * 7.3 — it never writes camp data into state directly, so a pushed update
 * and a manual refetch are indistinguishable to anything reading that query.
 */
export function useLiveCampUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    socket.connect();
    const onOccupancy = () => qc.invalidateQueries({ queryKey: ['camps'] });
    socket.on('camp:occupancy', onOccupancy);
    return () => {
      socket.off('camp:occupancy', onOccupancy);
      socket.disconnect();
    };
  }, [qc]);
}
