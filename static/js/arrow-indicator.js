"use strict";

/**
 * ArrowIndicator - Metric change indicators for the dashboard
 * 
 * Shows arrows when metrics change meaningfully between refreshes.
 * Uses per-metric thresholds so hashrate noise doesn't trigger,
 * but real moves do. Arrows auto-expire after 60 seconds.
 */
class ArrowIndicator {
    constructor() {
        this.previousMetrics = {};
        this.arrowStates = {};
        this.arrowTimestamps = {};  // When each arrow was set
        this.ARROW_TTL_MS = 60000; // Arrows expire after 60s

        // Per-metric thresholds (% change required to show arrow)
        // Higher for noisy metrics, lower for stable ones
        this.thresholds = {
            // Hashrates fluctuate constantly — only show on real moves
            hashrate_60sec:    0.03,   // 3%
            hashrate_10min:    0.02,   // 2%
            hashrate_3hr:      0.01,   // 1%
            hashrate_24hr:     0.005,  // 0.5%
            pool_total_hashrate: 0.01, // 1%
            network_hashrate:  0.005,  // 0.5%

            // Price/earnings — meaningful changes matter
            btc_price:         0.005,  // 0.5%
            daily_revenue:     0.02,   // 2%
            daily_power_cost:  0.02,   // 2%
            daily_profit_usd:  0.02,   // 2%
            monthly_profit_usd: 0.02,  // 2%

            // Sats earnings
            daily_mined_sats:  0.02,   // 2%
            monthly_mined_sats: 0.02,  // 2%
            estimated_earnings_per_day_sats: 0.02,
            estimated_earnings_next_block_sats: 0.02,
            estimated_rewards_in_window_sats: 0.02,
            unpaid_earnings:   0.005,  // 0.5%

            // Discrete values — any real change
            block_number:      0,      // Always show (integer jumps)
            difficulty:        0.001,  // 0.1%
            workers_hashing:   0,      // Always show (integer)
        };
        this.defaultThreshold = 0.01; // 1% default

        this.loadFromStorage();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeDOM());
        } else {
            setTimeout(() => this.initializeDOM(), 100);
        }

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.loadFromStorage();
                this.forceApplyArrows();
            }
        });

        window.addEventListener('storage', this.handleStorageEvent.bind(this));

        // Periodically expire stale arrows
        setInterval(() => this.expireStaleArrows(), 10000);
    }

    initializeDOM() {
        this.forceApplyArrows();
        this.setupMutationObserver();
        [500, 1000, 2000].forEach(delay => {
            setTimeout(() => this.forceApplyArrows(), delay);
        });
    }

    setupMutationObserver() {
        const observer = new MutationObserver(mutations => {
            let found = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (
                            (node.id && node.id.startsWith('indicator_')) ||
                            node.querySelector?.('[id^="indicator_"]')
                        )) {
                            found = true;
                            break;
                        }
                    }
                }
                if (found) break;
            }
            if (found) this.forceApplyArrows();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    forceApplyArrows() {
        const now = Date.now();
        for (const key of Object.keys(this.arrowStates)) {
            // Skip expired arrows
            if (this.arrowTimestamps[key] && (now - this.arrowTimestamps[key]) > this.ARROW_TTL_MS) {
                this.arrowStates[key] = "";
                continue;
            }

            const element = document.getElementById(`indicator_${key}`);
            if (!element) continue;

            const html = this.arrowStates[key] || "";
            if (html) {
                element.innerHTML = html;
                const icon = element.querySelector('i');
                if (icon) icon.style.display = "inline-block";
            } else {
                element.innerHTML = "";
            }
        }
    }

    expireStaleArrows() {
        const now = Date.now();
        let changed = false;
        for (const key of Object.keys(this.arrowStates)) {
            if (this.arrowStates[key] && this.arrowTimestamps[key] &&
                (now - this.arrowTimestamps[key]) > this.ARROW_TTL_MS) {
                this.arrowStates[key] = "";
                changed = true;

                // Clear the DOM element
                const el = document.getElementById(`indicator_${key}`);
                if (el) el.innerHTML = "";
            }
        }
        if (changed) this.saveToStorage();
    }

    updateIndicators(newMetrics, forceReset = false) {
        if (!newMetrics) return this.arrowStates;

        const metricKeys = Object.keys(this.thresholds);

        if (forceReset) {
            metricKeys.forEach(key => {
                this.arrowStates[key] = "";
                delete this.arrowTimestamps[key];
            });
        }

        const now = Date.now();

        for (const key of metricKeys) {
            if (newMetrics[key] === undefined) continue;

            const newValue = this.getNormalizedValue(newMetrics, key);
            if (newValue === null) continue;

            if (this.previousMetrics[key] !== undefined) {
                const prevValue = this.previousMetrics[key];
                const threshold = this.thresholds[key] ?? this.defaultThreshold;

                // Skip if no meaningful change
                if (prevValue === 0 && newValue === 0) continue;

                const pctChange = prevValue !== 0
                    ? Math.abs((newValue - prevValue) / prevValue)
                    : (newValue !== 0 ? 1 : 0);

                if (pctChange > threshold) {
                    if (newValue > prevValue) {
                        const big = pctChange > threshold * 3;
                        const icon = big ? 'fa-angle-double-up' : 'fa-angle-up';
                        this.arrowStates[key] =
                            `<i class='arrow chevron fa-solid ${icon} bounce-up' ` +
                            `style='color: #00ff00; display: inline-block !important;'></i>`;
                    } else {
                        const big = pctChange > threshold * 3;
                        const icon = big ? 'fa-angle-double-down' : 'fa-angle-down';
                        this.arrowStates[key] =
                            `<i class='arrow chevron fa-solid ${icon} bounce-down' ` +
                            `style='color: #ff0000; display: inline-block !important;'></i>`;
                    }
                    this.arrowTimestamps[key] = now;
                }
                // If change is below threshold, keep previous arrow (it'll expire via TTL)
            }

            this.previousMetrics[key] = newValue;
        }

        this.forceApplyArrows();
        this.saveToStorage();
        return this.arrowStates;
    }

    getNormalizedValue(metrics, key) {
        const value = parseFloat(metrics[key]);
        if (isNaN(value)) return null;

        if (key.includes('hashrate') && window.normalizeHashrate) {
            const unit = metrics[key + '_unit'] || 'th/s';
            return window.normalizeHashrate(value, unit);
        }
        return value;
    }

    saveToStorage() {
        try {
            localStorage.setItem('dashboardArrows', JSON.stringify(this.arrowStates));
            localStorage.setItem('dashboardArrowTimestamps', JSON.stringify(this.arrowTimestamps));
            localStorage.setItem('dashboardPreviousMetrics', JSON.stringify(this.previousMetrics));
        } catch (e) {
            console.error("Error saving arrow indicators:", e);
        }
    }

    loadFromStorage() {
        try {
            const savedArrows = localStorage.getItem('dashboardArrows');
            if (savedArrows) this.arrowStates = JSON.parse(savedArrows);

            const savedTimestamps = localStorage.getItem('dashboardArrowTimestamps');
            if (savedTimestamps) this.arrowTimestamps = JSON.parse(savedTimestamps);

            const savedMetrics = localStorage.getItem('dashboardPreviousMetrics');
            if (savedMetrics) this.previousMetrics = JSON.parse(savedMetrics);
        } catch (e) {
            this.arrowStates = {};
            this.arrowTimestamps = {};
            this.previousMetrics = {};
        }
    }

    handleStorageEvent(event) {
        if (event.key === 'dashboardArrows') {
            try {
                this.arrowStates = JSON.parse(event.newValue);
                this.forceApplyArrows();
            } catch (e) { /* ignore */ }
        }
    }

    prepareForRefresh() {
        // Don't clear arrows on refresh — let TTL handle expiry
        // This prevents the flash of no-arrows between refreshes
    }

    clearAll() {
        this.arrowStates = {};
        this.arrowTimestamps = {};
        this.previousMetrics = {};
        this.forceApplyArrows();
        this.saveToStorage();
    }
}

const arrowIndicator = new ArrowIndicator();
