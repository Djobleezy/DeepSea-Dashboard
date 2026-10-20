import type { DatumStatus, HealthStatus } from '../types';

type DatumBadgeState = {
  label: string;
  className: 'badge-online' | 'badge-offline' | 'badge-warning';
  dotColor: string;
  glow: boolean;
  tooltip: string;
};

export function deriveDatumBadge(
  health: HealthStatus | null,
  datum: DatumStatus | null,
  poolFeesPct: number,
): DatumBadgeState {
  if (health?.datum_gateway_configured) {
    if (datum && datum.status !== 'unknown') {
      return {
        label: datum.probe_reachable ? 'DATUM GATEWAY REACHABLE' : 'DATUM GATEWAY UNREACHABLE',
        className: datum.probe_reachable ? 'badge-online' : 'badge-warning',
        dotColor: datum.probe_reachable ? 'var(--color-success)' : 'var(--color-warning, #f0a020)',
        glow: datum.probe_reachable,
        tooltip: datum.explanation,
      };
    }
    return {
      label: 'DATUM STATUS UNAVAILABLE',
      className: 'badge-warning',
      dotColor: 'var(--color-warning, #f0a020)',
      glow: false,
      tooltip: 'No current gateway probe is available. Pool connection status is unverified.',
    };
  }

  const feeBand = poolFeesPct >= 0.9 && poolFeesPct <= 1.3;
  return {
    label: feeBand ? 'DATUM FEES IN RANGE' : 'DATUM STATUS UNVERIFIED',
    className: 'badge-warning',
    dotColor: 'var(--color-warning, #f0a020)',
    glow: false,
    tooltip: feeBand
      ? 'Historical pool fees are in the DATUM range. Fees alone do not verify a current connection.'
      : 'Historical pool fees do not verify a current DATUM connection. Configure a gateway URL for a reachability check.',
  };
}
