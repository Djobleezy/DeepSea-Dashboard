"use strict";

/**
 * config.js - Global configuration, timezone, and threshold management
 */

// Global timezone configuration
let dashboardTimezone = 'America/Los_Angeles'; // Default
window.dashboardTimezone = dashboardTimezone; // Make it globally accessible

// Hashrate thresholds
let lowHashrateThresholdTHS = 3.0;
let highHashrateThresholdTHS = 20.0;
let extendedHistoryEnabled = false;
window.lowHashrateThresholdTHS = lowHashrateThresholdTHS;
window.highHashrateThresholdTHS = highHashrateThresholdTHS;
// Restore extended history preference from localStorage if present
try {
    const storedExt = localStorage.getItem('extendedHistoryEnabled');
    if (storedExt !== null) {
        extendedHistoryEnabled = storedExt === 'true';
    }
} catch (e) {
    console.error('Error loading extended history preference', e);
}
window.extendedHistoryEnabled = extendedHistoryEnabled;

// Fetch the configured timezone when the page loads
function fetchTimezoneConfig() {
    fetch('/api/timezone')
        .then(response => response.json())
        .then(data => {
            if (data && data.timezone) {
                dashboardTimezone = data.timezone;
                window.dashboardTimezone = dashboardTimezone; // Make it globally accessible
                console.log(`Using configured timezone: ${dashboardTimezone}`);
            }
        })
        .catch(error => console.error('Error fetching timezone config:', error));
}

function fetchHashrateThresholds() {
    fetch('/api/config')
        .then(response => response.json())
        .then(cfg => {
            if (cfg.low_hashrate_threshold_ths !== undefined) {
                lowHashrateThresholdTHS = parseFloat(cfg.low_hashrate_threshold_ths);
                window.lowHashrateThresholdTHS = lowHashrateThresholdTHS;
            }
            if (cfg.high_hashrate_threshold_ths !== undefined) {
                highHashrateThresholdTHS = parseFloat(cfg.high_hashrate_threshold_ths);
                window.highHashrateThresholdTHS = highHashrateThresholdTHS;
            }
            if (cfg.extended_history !== undefined) {
                extendedHistoryEnabled = Boolean(cfg.extended_history);
                window.extendedHistoryEnabled = extendedHistoryEnabled;
                try {
                    localStorage.setItem('extendedHistoryEnabled', String(extendedHistoryEnabled));
                } catch (e) {
                    console.error('Error storing extended history preference', e);
                }
                if (extendedHistoryEnabled && chartPoints === Infinity && trendChart && latestMetrics) {
                    updateChartWithNormalizedData(trendChart, latestMetrics);
                }
            }
        })
        .catch(err => console.error('Error fetching hashrate thresholds:', err));
}

// Call this on page load
document.addEventListener('DOMContentLoaded', () => {
    fetchTimezoneConfig();
    fetchHashrateThresholds();
});
