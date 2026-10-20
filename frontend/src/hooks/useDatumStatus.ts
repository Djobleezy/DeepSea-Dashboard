import { useEffect, useState } from 'react';
import { fetchDatumStatus, fetchHealth } from '../api/client';
import type { DatumStatus, HealthStatus } from '../types';

const POLL_MS = 30_000;

export function useDatumStatus() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [datum, setDatum] = useState<DatumStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const tick = async () => {
      try {
        // Recheck configuration so startup failures and settings changes
        // recover without a reload. Schedule after completion to avoid overlap.
        const nextHealth = await fetchHealth();
        if (cancelled) return;
        setHealth(nextHealth);
        if (nextHealth.datum_gateway_configured) {
          const nextDatum = await fetchDatumStatus();
          if (!cancelled) setDatum(nextDatum);
        } else {
          setDatum(null);
        }
      } catch {
        // Never keep showing an old successful probe after a failed refresh.
        if (!cancelled) setDatum(null);
      } finally {
        if (!cancelled) timeoutId = window.setTimeout(() => void tick(), POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return { health, datum };
}
