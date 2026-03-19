/**
 * usePayoutTracking — detects and stores Bitcoin payout events.
 *
 * V1 strategy: watch unpaid_earnings drop >50% between SSE updates.
 * Verified against /api/earnings when available.
 * History stored in localStorage (max 100 entries).
 */

import { useEffect, useRef, useState } from 'react';
import { fetchEarnings } from '../api/client';
import type { DashboardMetrics, EarningsResponse } from '../types';

const LS_KEY = 'deepsea_payout_history';
const MAX_HISTORY = 100;
const PAYOUT_THRESHOLD_DROP = 0.5; // current < previous * 0.5
const RECENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface PayoutRecord {
  timestamp: string; // ISO 8601
  amountBtc: number;
  fiatValueUsd: number | null;
  verified: boolean;
  officialId?: string;
  lightningId?: string;
  status: 'pending' | 'confirmed';
}

interface PayoutTrackingResult {
  lastPayout: PayoutRecord | null;
  payoutHistory: PayoutRecord[];
  avgDaysBetweenPayouts: number | null;
  isPayoutRecent: boolean; // within last hour
  newPayoutDetected: boolean; // true for ~5s after detection, then resets
}

// ── localStorage helpers ──────────────────────────────────────────────────

function loadHistory(): PayoutRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.timestamp === 'string' && typeof e.amountBtc === 'number',
    );
  } catch {
    return [];
  }
}

function saveHistory(history: PayoutRecord[]): void {
  try {
    const pruned = history.slice(0, MAX_HISTORY);
    localStorage.setItem(LS_KEY, JSON.stringify(pruned));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}

// ── Average days calculation ──────────────────────────────────────────────

function calcAvgDays(history: PayoutRecord[]): number | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const intervals: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = new Date(sorted[i].timestamp).getTime();
    const t2 = new Date(sorted[i + 1].timestamp).getTime();
    const diffDays = (t1 - t2) / (1000 * 60 * 60 * 24);
    if (diffDays > 0 && diffDays < 365) {
      intervals.push(diffDays);
    }
  }
  if (intervals.length === 0) return null;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

// ── Verification against /api/earnings ───────────────────────────────────

async function verifyAgainstEarnings(history: PayoutRecord[]): Promise<PayoutRecord[]> {
  try {
    const data: EarningsResponse = await fetchEarnings(90);

    const payments: Array<{
      date_iso?: string;
      date?: string;
      amount_btc: number;
      txid?: string;
      lightning_txid?: string;
      status?: string;
      rate?: number;
    }> = data?.payments ?? [];

    if (!payments.length) return history;

    const updated = history.map((payout) => {
      if (payout.verified) return payout; // already confirmed
      const payoutTime = new Date(payout.timestamp).getTime();

      const match = payments.find((p) => {
        const paymentTime = new Date(p.date_iso ?? p.date ?? '').getTime();
        return (
          Math.abs(paymentTime - payoutTime) < 2 * 60 * 60 * 1000 && // within 2h
          Math.abs(p.amount_btc - payout.amountBtc) < 0.00001
        );
      });

      if (match) {
        return {
          ...payout,
          verified: true,
          officialId: match.txid ?? payout.officialId,
          lightningId: match.lightning_txid ?? payout.lightningId,
          status: (match.status ?? 'confirmed') as PayoutRecord['status'],
        };
      }
      return payout;
    });

    // Seed history with official records not yet captured (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    payments.forEach((p) => {
      const pTime = new Date(p.date_iso ?? p.date ?? '').getTime();
      if (pTime < thirtyDaysAgo) return;

      const exists = updated.some((h) => {
        if (h.officialId && p.txid && h.officialId === p.txid) return true;
        const hTime = new Date(h.timestamp).getTime();
        return (
          Math.abs(hTime - pTime) < 2 * 60 * 60 * 1000 &&
          Math.abs(h.amountBtc - p.amount_btc) < 0.00001
        );
      });

      if (!exists) {
        updated.push({
          timestamp: new Date(p.date_iso ?? p.date ?? Date.now()).toISOString(),
          amountBtc: p.amount_btc,
          fiatValueUsd: p.rate ? p.amount_btc * p.rate : null,
          verified: true,
          officialId: p.txid,
          lightningId: p.lightning_txid,
          status: (p.status ?? 'confirmed') as PayoutRecord['status'],
        });
      }
    });

    // Sort descending by time, prune to max
    updated.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return updated.slice(0, MAX_HISTORY);
  } catch {
    return history;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function usePayoutTracking(metrics: DashboardMetrics | null): PayoutTrackingResult {
  const prevUnpaid = useRef<number | null>(null);
  const [history, setHistory] = useState<PayoutRecord[]>(() => loadHistory());
  const [newPayoutDetected, setNewPayoutDetected] = useState(false);
  const detectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyScheduled = useRef(false);

  // Detect payouts from SSE metric updates
  useEffect(() => {
    if (!metrics) return;
    const current = metrics.unpaid_earnings ?? 0;

    if (prevUnpaid.current === null) {
      prevUnpaid.current = current;
      return;
    }

    const previous = prevUnpaid.current;

    if (current < previous * PAYOUT_THRESHOLD_DROP && previous > 0) {
      const amountBtc = previous - current;
      const fiatValueUsd =
        metrics.btc_price && metrics.btc_price > 0
          ? amountBtc * metrics.btc_price
          : null;

      const record: PayoutRecord = {
        timestamp: new Date().toISOString(),
        amountBtc,
        fiatValueUsd,
        verified: false,
        status: 'pending',
      };

      setHistory((prev) => {
        const updated = [record, ...prev].slice(0, MAX_HISTORY);
        saveHistory(updated);

        // Schedule verification against earnings API
        if (!verifyScheduled.current) {
          verifyScheduled.current = true;
          setTimeout(async () => {
            const verified = await verifyAgainstEarnings(updated);
            setHistory(verified);
            saveHistory(verified);
            verifyScheduled.current = false;
          }, 5000);
        }

        return updated;
      });

      // Flash "PAYOUT DETECTED!" for 5s
      setNewPayoutDetected(true);
      if (detectionTimer.current) clearTimeout(detectionTimer.current);
      detectionTimer.current = setTimeout(() => setNewPayoutDetected(false), 5000);
    }

    prevUnpaid.current = current;
  }, [metrics]);

  // On mount: verify existing history against earnings API once
  useEffect(() => {
    let cancelled = false;
    verifyAgainstEarnings(history).then((verified) => {
      if (cancelled) return;
      // Only update if something changed
      const changed = JSON.stringify(verified) !== JSON.stringify(history);
      if (changed) {
        setHistory(verified);
        saveHistory(verified);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const lastPayout = history[0] ?? null;
  const avgDaysBetweenPayouts = calcAvgDays(history);
  const isPayoutRecent =
    lastPayout !== null &&
    Date.now() - new Date(lastPayout.timestamp).getTime() < RECENT_WINDOW_MS;

  return {
    lastPayout,
    payoutHistory: history,
    avgDaysBetweenPayouts,
    isPayoutRecent,
    newPayoutDetected,
  };
}
