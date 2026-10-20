/**
 * usePayoutTracking — detects and stores Bitcoin payout events.
 *
 * V1 strategy: watch unpaid_earnings drop >50% between SSE updates.
 * Verified against /api/earnings when available.
 * History stored in localStorage (max 100 entries).
 */

import { useEffect, useRef, useState } from 'react';
import { fetchEarnings } from '../api/client';
import { useAppStore } from '../stores/store';
import type { DashboardMetrics, EarningsResponse } from '../types';

const LS_KEY = 'deepsea_payout_history:';

export const payoutHistoryKey = (wallet: string) => `${LS_KEY}${encodeURIComponent(wallet)}`;

export function clearPayoutHistory(wallet: string): void {
  localStorage.removeItem(payoutHistoryKey(wallet));
  window.dispatchEvent(new Event('deepsea:payout-history-cleared'));
}
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

function loadHistory(wallet: string): PayoutRecord[] {
  if (!wallet) return [];
  try {
    const raw = localStorage.getItem(payoutHistoryKey(wallet));
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

function saveHistory(wallet: string, history: PayoutRecord[]): void {
  if (!wallet) return;
  try {
    const pruned = history.slice(0, MAX_HISTORY);
    localStorage.setItem(payoutHistoryKey(wallet), JSON.stringify(pruned));
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
        if (h.lightningId && p.lightning_txid && h.lightningId === p.lightning_txid) return true;
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
  const configuredWallet = useAppStore((s) => s.wallet);
  const wallet = configuredWallet ?? metrics?.wallet ?? '';
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const prevUnpaid = useRef<number | null>(null);
  const historyVersion = useRef(0);
  const [scopedHistory, setScopedHistory] = useState(() => ({ wallet, entries: loadHistory(wallet) }));
  const history = scopedHistory.wallet === wallet ? scopedHistory.entries : [];
  const historyRef = useRef(history);
  historyRef.current = history;
  const [newPayoutDetected, setNewPayoutDetected] = useState(false);
  const detectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const versionRef = historyVersion;
    const version = ++versionRef.current;
    prevUnpaid.current = null;
    setNewPayoutDetected(false);
    const initial = loadHistory(wallet);
    historyRef.current = initial;
    setScopedHistory({ wallet, entries: initial });
    if (wallet) {
      void verifyAgainstEarnings(initial).then((verified) => {
        if (cancelled || walletRef.current !== wallet || historyVersion.current !== version) return;
        historyRef.current = verified;
        setScopedHistory({ wallet, entries: verified });
        saveHistory(wallet, verified);
      });
    }
    const clear = () => {
      historyVersion.current++;
      historyRef.current = [];
      setScopedHistory({ wallet, entries: [] });
      prevUnpaid.current = null;
      setNewPayoutDetected(false);
    };
    window.addEventListener('deepsea:payout-history-cleared', clear);
    return () => {
      cancelled = true;
      versionRef.current++;
      if (detectionTimer.current) clearTimeout(detectionTimer.current);
      if (verificationTimer.current) clearTimeout(verificationTimer.current);
      verificationTimer.current = null;
      window.removeEventListener('deepsea:payout-history-cleared', clear);
    };
  }, [wallet]);

  // Only fresh snapshots for this wallet may imply a payout. An unavailable
  // response or a wallet switch must never look like a drop in unpaid balance.
  useEffect(() => {
    if (!wallet || !metrics || (metrics.wallet !== undefined && metrics.wallet !== wallet)) return;
    if (metrics.data_status && metrics.data_status !== 'fresh') return;
    const current = metrics.unpaid_earnings ?? 0;
    const previous = prevUnpaid.current;
    prevUnpaid.current = current;
    if (previous === null || previous <= 0 || current >= previous * PAYOUT_THRESHOLD_DROP) return;

    const amountBtc = previous - current;
    const record: PayoutRecord = {
      timestamp: new Date().toISOString(), amountBtc,
      fiatValueUsd: metrics.btc_price > 0 ? amountBtc * metrics.btc_price : null,
      verified: false, status: 'pending',
    };
    historyVersion.current++;
    const updated = [record, ...historyRef.current].slice(0, MAX_HISTORY);
    historyRef.current = updated;
    setScopedHistory({ wallet, entries: updated });
    saveHistory(wallet, updated);

    if (!verificationTimer.current) {
      verificationTimer.current = setTimeout(async () => {
        verificationTimer.current = null;
        const version = historyVersion.current;
        const verified = await verifyAgainstEarnings(historyRef.current);
        if (walletRef.current !== wallet || historyVersion.current !== version) return;
        historyRef.current = verified;
        setScopedHistory({ wallet, entries: verified });
        saveHistory(wallet, verified);
      }, 5000);
    }
    setNewPayoutDetected(true);
    if (detectionTimer.current) clearTimeout(detectionTimer.current);
    detectionTimer.current = setTimeout(() => setNewPayoutDetected(false), 5000);
  }, [metrics, wallet]);

  const lastPayout = history[0] ?? null;
  const avgDaysBetweenPayouts = calcAvgDays(history);
  const isPayoutRecent = lastPayout !== null &&
    Date.now() - new Date(lastPayout.timestamp).getTime() < RECENT_WINDOW_MS;

  return { lastPayout, payoutHistory: history, avgDaysBetweenPayouts, isPayoutRecent, newPayoutDetected };
}
