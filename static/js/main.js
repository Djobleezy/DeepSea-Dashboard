"use strict";

/**
 * ArrowIndicator - A clean implementation for managing metric value change indicators
 * 
 * This module provides a simple, self-contained system for managing arrow indicators
 * that show whether metric values have increased, decreased, or remained stable
 * between refreshes.
 */
class ArrowIndicator {
    constructor() {
        this.previousMetrics = {};
        this.arrowStates = {};
        this.changeThreshold = 0.00001;
        this.debug = false;

        // Load saved state immediately
        this.loadFromStorage();

        // DOM ready handling
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeDOM());
        } else {
            setTimeout(() => this.initializeDOM(), 100);
        }

        // Handle tab visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.loadFromStorage();
                this.forceApplyArrows();
            }
        });

        // Handle storage changes for cross-tab sync
        window.addEventListener('storage', this.handleStorageEvent.bind(this));
    }

    initializeDOM() {
        // First attempt to apply arrows
        this.forceApplyArrows();

        // Set up a detection system to find indicator elements
        this.detectIndicatorElements();
    }

    detectIndicatorElements() {
        // Scan the DOM for all elements that match our indicator pattern
        const indicatorElements = {};

        // Look for elements with IDs starting with "indicator_"
        const elements = document.querySelectorAll('[id^="indicator_"]');
        elements.forEach(element => {
            const key = element.id.replace('indicator_', '');
            indicatorElements[key] = element;
        });

        // Apply arrows to the found elements
        this.applyArrowsToFoundElements(indicatorElements);

        // Set up a MutationObserver to catch dynamically added elements
        this.setupMutationObserver();

        // Schedule additional attempts with increasing delays
        [500, 1000, 2000].forEach(delay => {
            setTimeout(() => this.forceApplyArrows(), delay);
        });
    }

    setupMutationObserver() {
        // Watch for changes to the DOM that might add indicator elements
        const observer = new MutationObserver(mutations => {
            let newElementsFound = false;

            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // Element node
                            // Check the node itself
                            if (node.id && node.id.startsWith('indicator_')) {
                                newElementsFound = true;
                            }

                            // Check children of the node
                            const childIndicators = node.querySelectorAll('[id^="indicator_"]');
                            if (childIndicators.length) {
                                newElementsFound = true;
                            }
                        }
                    });
                }
            });

            if (newElementsFound) {
                this.forceApplyArrows();
            }
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    forceApplyArrows() {
        let applied = 0;
        let missing = 0;

        // Apply arrows to all indicators we know about
        Object.keys(this.arrowStates).forEach(key => {
            const element = document.getElementById(`indicator_${key}`);
            if (element) {
                // Double-check if the element is visible
                const arrowValue = this.arrowStates[key] || "";

                // Use direct DOM manipulation instead of innerHTML for better reliability
                if (arrowValue) {
                    // Clear existing content
                    while (element.firstChild) {
                        element.removeChild(element.firstChild);
                    }

                    // Create the new icon element
                    const tmpDiv = document.createElement('div');
                    tmpDiv.innerHTML = arrowValue;
                    const iconElement = tmpDiv.firstChild;

                    // Make the arrow more visible
                    if (iconElement) {
                        element.appendChild(iconElement);

                        // Force the arrow to be visible
                        iconElement.style.display = "inline-block";
                    }
                }

                applied++;
            } else {
                missing++;
            }
        });

        return applied;
    }

    applyArrowsToFoundElements(elements) {
        let applied = 0;

        Object.keys(elements).forEach(key => {
            if (this.arrowStates[key]) {
                const element = elements[key];
                element.innerHTML = this.arrowStates[key];
                applied++;
            }
        });
    }

    updateIndicators(newMetrics, forceReset = false) {
        if (!newMetrics) return this.arrowStates;

        // Define metrics that should have indicators
        const metricKeys = [
            "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
            "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
            "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
            "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
            "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats",
            "estimated_rewards_in_window_sats", "workers_hashing"
        ];

        // Clear all arrows if requested
        if (forceReset) {
            metricKeys.forEach(key => {
                this.arrowStates[key] = "";
            });
        }

        // Current theme affects arrow colors
        const theme = getCurrentTheme();
        const upArrowColor = THEME.SHARED.GREEN;
        const downArrowColor = THEME.SHARED.RED;

        // Get normalized values and compare with previous metrics
        for (const key of metricKeys) {
            if (newMetrics[key] === undefined) continue;

            const newValue = this.getNormalizedValue(newMetrics, key);
            if (newValue === null) continue;

            if (this.previousMetrics[key] !== undefined) {
                const prevValue = this.previousMetrics[key];

                if (newValue > prevValue * (1 + this.changeThreshold)) {
                    this.arrowStates[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green; display: inline-block !important;'></i>";
                }
                else if (newValue < prevValue * (1 - this.changeThreshold)) {
                    this.arrowStates[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px; display: inline-block !important;'></i>";
                }
            }

            this.previousMetrics[key] = newValue;
        }

        // Apply arrows to DOM
        this.forceApplyArrows();

        // Save to localStorage for persistence
        this.saveToStorage();

        return this.arrowStates;
    }

    // Get a normalized value for a metric to ensure consistent comparisons
    getNormalizedValue(metrics, key) {
        const value = parseFloat(metrics[key]);
        if (isNaN(value)) return null;

        // Special handling for hashrate values to normalize units
        if (key.includes('hashrate')) {
            const unit = metrics[key + '_unit'] || 'th/s';
            return this.normalizeHashrate(value, unit);
        }

        return value;
    }

    // Normalize hashrate to a common unit (TH/s)
    normalizeHashrate(value, unit) {
        // Use the enhanced global normalizeHashrate function
        return window.normalizeHashrate(value, unit);
    }

    // Save current state to localStorage
    saveToStorage() {
        try {
            // Save arrow states
            localStorage.setItem('dashboardArrows', JSON.stringify(this.arrowStates));

            // Save previous metrics for comparison after page reload
            localStorage.setItem('dashboardPreviousMetrics', JSON.stringify(this.previousMetrics));
        } catch (e) {
            console.error("Error saving arrow indicators to localStorage:", e);
        }
    }

    // Load state from localStorage
    loadFromStorage() {
        try {
            // Load arrow states
            const savedArrows = localStorage.getItem('dashboardArrows');
            if (savedArrows) {
                this.arrowStates = JSON.parse(savedArrows);
            }

            // Load previous metrics
            const savedMetrics = localStorage.getItem('dashboardPreviousMetrics');
            if (savedMetrics) {
                this.previousMetrics = JSON.parse(savedMetrics);
            }
        } catch (e) {
            console.error("Error loading arrow indicators from localStorage:", e);
            // On error, reset to defaults
            this.arrowStates = {};
            this.previousMetrics = {};
        }
    }

    // Handle storage events for cross-tab synchronization
    handleStorageEvent(event) {
        if (event.key === 'dashboardArrows') {
            try {
                const newArrows = JSON.parse(event.newValue);
                this.arrowStates = newArrows;
                this.forceApplyArrows();
            } catch (e) {
                console.error("Error handling storage event:", e);
            }
        }
    }

    // Reset for new refresh cycle
    prepareForRefresh() {
        Object.keys(this.arrowStates).forEach(key => {
            this.arrowStates[key] = "";
        });
        this.forceApplyArrows();
    }

    // Clear all indicators
    clearAll() {
        this.arrowStates = {};
        this.previousMetrics = {};
        this.forceApplyArrows();
        this.saveToStorage();
    }
}

// Create the singleton instance
const arrowIndicator = new ArrowIndicator();

// Global timezone configuration
let dashboardTimezone = 'America/Los_Angeles'; // Default
window.dashboardTimezone = dashboardTimezone; // Make it globally accessible

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

// Call this on page load
document.addEventListener('DOMContentLoaded', fetchTimezoneConfig);

// Global variables
let previousMetrics = {};
let latestMetrics = null;
let initialLoad = true;
let trendData = [];
let trendLabels = [];
let trendChart = null;
let blockAnnotations = [];
let connectionRetryCount = 0;
let maxRetryCount = 10;
let reconnectionDelay = 1000; // Start with 1 second
let pingInterval = null;
let lastPingTime = Date.now();
let connectionLostTimeout = null;

// Add this to the top of main.js with other global variables
let lastPayoutTracking = {
    lastUnpaidEarnings: null,
    payoutHistory: [],
    avgDays: null
};

// Server time variables for uptime calculation
let serverTimeOffset = 0;
let serverStartTime = null;

// Register local annotation plugin if available
if (window.simpleAnnotationPlugin) {
    Chart.register(window.simpleAnnotationPlugin);
}

function pruneBlockAnnotations(minutes = 180, maxEntries = 100) {
    const tz = window.dashboardTimezone || DEFAULT_TIMEZONE;
    const now = Date.now();
    const cutoff = now - minutes * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const offset = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getTime() - now;

    try {
        blockAnnotations = blockAnnotations.filter(label => {
            const parts = label.split(':');
            if (parts.length < 2) return false;
            const hour = parseInt(parts[0], 10);
            const minute = parseInt(parts[1], 10);
            if (isNaN(hour) || isNaN(minute)) return false;
            const base = new Date();
            base.setHours(hour, minute, 0, 0);
            let ts = base.getTime() - offset;
            const diff = ts - now;
            if (diff > 12 * 60 * 60 * 1000) ts -= dayMs;
            else if (diff < -12 * 60 * 60 * 1000) ts += dayMs;
            return ts >= cutoff;
        });
        if (maxEntries && blockAnnotations.length > maxEntries) {
            blockAnnotations.splice(0, blockAnnotations.length - maxEntries);
        }
    } catch (e) {
        console.error('Error pruning block annotations', e);
        blockAnnotations = [];
    }
}

function clearBlockAnnotations() {
    blockAnnotations = [];
    try {
        localStorage.removeItem('blockAnnotations');
    } catch (e) {
        console.error('Error clearing block annotations', e);
    }
    if (trendChart) {
        updateBlockAnnotations(trendChart);
        trendChart.update('none');
    }
}

window.clearBlockAnnotations = clearBlockAnnotations;

function loadBlockAnnotations(minutes = 180, maxEntries = 100) {
    const tz = window.dashboardTimezone || DEFAULT_TIMEZONE;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    // Compute cutoff based on requested minutes
    const cutoff = Date.now() - minutes * 60 * 1000;

    try {
        const stored = localStorage.getItem('blockAnnotations');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                blockAnnotations = parsed;
            }
        }
    } catch (e) {
        console.error('Error loading block annotations', e);
        blockAnnotations = [];
    }

    pruneBlockAnnotations(minutes, maxEntries);

    // Fetch past block events from the server and merge with stored annotations
    fetch(`/api/block-events?minutes=${minutes}`)
        .then(resp => resp.json())
        .then(data => {
            if (data && Array.isArray(data.events)) {
                data.events.forEach(ev => {
                    try {
                        const d = new Date(ev.timestamp);
                        if (d.getTime() < cutoff) return;
                        const label = formatter.format(d).replace(/\s[AP]M$/i, '');
                        if (!blockAnnotations.includes(label)) {
                            blockAnnotations.push(label);
                        }
                    } catch (err) {
                        console.error('Error processing block event', err);
                    }
                });
                saveBlockAnnotations();
                if (trendChart) {
                    updateBlockAnnotations(trendChart);
                    trendChart.update('none');
                }
            }
        })
        .catch(err => console.error('Error fetching block events', err));
}

function saveBlockAnnotations(minutes = 180, maxEntries = 100) {
    pruneBlockAnnotations(minutes, maxEntries);
    try {
        localStorage.setItem('blockAnnotations', JSON.stringify(blockAnnotations));
    } catch (e) {
        console.error('Error saving block annotations', e);
    }
}

function updateBlockAnnotations(chart) {
    if (!chart || !chart.options) return;
    if (!chart.options.plugins) chart.options.plugins = {};
    if (!chart.options.plugins.annotation) chart.options.plugins.annotation = { annotations: {} };

    let anns = chart.options.plugins.annotation.annotations;
    if (!anns) {
        anns = {};
        chart.options.plugins.annotation.annotations = anns;
    }

    Object.keys(anns).forEach(key => {
        if (key.startsWith('blockEvent')) delete anns[key];
    });

    const theme = getCurrentTheme();
    const validLabels = chart.data && Array.isArray(chart.data.labels)
        ? new Set(chart.data.labels)
        : new Set();
    let idx = 0;
    blockAnnotations.forEach(label => {
        if (!validLabels.has(label)) return;
        anns['blockEvent' + idx] = {
            type: 'line',
            xMin: label,
            xMax: label,
            borderColor: theme.CHART.BLOCK_EVENT,
            borderWidth: 2,
            borderDash: [4, 2],
            label: {
                enabled: true,
                content: label,
                backgroundColor: 'rgba(0,0,0,0.8)',
                color: theme.CHART.BLOCK_EVENT,
                font: {
                    family: "'VT323', monospace",
                    size: 16,
                    weight: 'bold'
                },
                padding: { top: 4, bottom: 4, left: 8, right: 8 },
                borderRadius: 0,
                position: 'start'
            }
        };
        idx++;
    });
}

// Hashrate Normalization Utilities
// Enhanced normalizeHashrate function with better error handling for units
/**
 * Normalizes hashrate values to TH/s (terahashes per second) for consistent comparison
 * @param {number|string} value - The hashrate value to normalize
 * @param {string} unit - The unit of the provided hashrate (e.g., 'ph/s', 'th/s', 'gh/s')
 * @param {boolean} [debug=false] - Whether to output detailed debugging information
 * @returns {number} - The normalized hashrate value in TH/s
 */
function normalizeHashrate(value, unit, debug = false) {
    // Handle null, undefined, empty strings or non-numeric values
    if (value === null || value === undefined || value === '' || isNaN(parseFloat(value))) {
        if (debug) console.warn(`Invalid hashrate value: ${value}`);
        return 0;
    }

    // Convert to number and handle scientific notation (e.g., "1.23e+5")
    value = parseFloat(value);

    // Standardize unit handling with a lookup table
    const unit_normalized = (unit || 'th/s').toLowerCase().trim();

    // Store original values for logging
    const originalValue = value;
    const originalUnit = unit;

    // Lookup table for conversion factors (all relative to TH/s)
    const unitConversions = {
        // Zettahash (ZH/s) - 1 ZH/s = 1,000,000,000 TH/s
        'zh/s': 1000000000,
        'z/s': 1000000000,
        'z': 1000000000,
        'zettahash': 1000000000,
        'zettahash/s': 1000000000,
        'zetta': 1000000000,

        // Exahash (EH/s) - 1 EH/s = 1,000,000 TH/s
        'eh/s': 1000000,
        'e/s': 1000000,
        'e': 1000000,
        'exahash': 1000000,
        'exahash/s': 1000000,
        'exa': 1000000,

        // Petahash (PH/s) - 1 PH/s = 1,000 TH/s
        'ph/s': 1000,
        'p/s': 1000,
        'p': 1000,
        'petahash': 1000,
        'petahash/s': 1000,
        'peta': 1000,

        // Terahash (TH/s) - Base unit
        'th/s': 1,
        't/s': 1,
        't': 1,
        'terahash': 1,
        'terahash/s': 1,
        'tera': 1,

        // Gigahash (GH/s) - 1 TH/s = 1,000 GH/s
        'gh/s': 1 / 1000,
        'g/s': 1 / 1000,
        'g': 1 / 1000,
        'gigahash': 1 / 1000,
        'gigahash/s': 1 / 1000,
        'giga': 1 / 1000,

        // Megahash (MH/s) - 1 TH/s = 1,000,000 MH/s
        'mh/s': 1 / 1000000,
        'm/s': 1 / 1000000,
        'm': 1 / 1000000,
        'megahash': 1 / 1000000,
        'megahash/s': 1 / 1000000,
        'mega': 1 / 1000000,

        // Kilohash (KH/s) - 1 TH/s = 1,000,000,000 KH/s
        'kh/s': 1 / 1000000000,
        'k/s': 1 / 1000000000,
        'k': 1 / 1000000000,
        'kilohash': 1 / 1000000000,
        'kilohash/s': 1 / 1000000000,
        'kilo': 1 / 1000000000,

        // Hash (H/s) - 1 TH/s = 1,000,000,000,000 H/s
        'h/s': 1 / 1000000000000,
        'h': 1 / 1000000000000,
        'hash': 1 / 1000000000000,
        'hash/s': 1 / 1000000000000
    };

    let conversionFactor = null;
    let matchedUnit = null;

    // Direct lookup for exact matches
    if (unitConversions.hasOwnProperty(unit_normalized)) {
        conversionFactor = unitConversions[unit_normalized];
        matchedUnit = unit_normalized;
    } else {
        // Fuzzy matching for non-exact matches
        for (const knownUnit in unitConversions) {
            if (unit_normalized.includes(knownUnit) || knownUnit.includes(unit_normalized)) {
                conversionFactor = unitConversions[knownUnit];
                matchedUnit = knownUnit;

                if (debug) {
                    console.log(`Fuzzy matching unit: "${unit}" → interpreted as "${knownUnit}" (conversion: ${unitConversions[knownUnit]})`);
                }
                break;
            }
        }
    }

    // Handle unknown units
    if (conversionFactor === null) {
        console.warn(`Unrecognized hashrate unit: "${unit}", assuming TH/s. Value: ${value}`);

        // Automatically detect and suggest the appropriate unit based on magnitude
        if (value > 1000) {
            console.warn(`NOTE: Value ${value} is quite large for TH/s. Could it be PH/s?`);
        } else if (value > 1000000) {
            console.warn(`NOTE: Value ${value} is extremely large for TH/s. Could it be EH/s?`);
        } else if (value < 0.001) {
            console.warn(`NOTE: Value ${value} is quite small for TH/s. Could it be GH/s or MH/s?`);
        }

        // Assume TH/s as fallback
        conversionFactor = 1;
        matchedUnit = 'th/s';
    }

    // Calculate normalized value
    const normalizedValue = value * conversionFactor;

    // Log abnormally large conversions for debugging
    if ((normalizedValue > 1000000 || normalizedValue < 0.000001) && normalizedValue !== 0) {
        console.log(`Large scale conversion detected: ${originalValue} ${originalUnit} → ${normalizedValue.toExponential(2)} TH/s`);
    }

    // Extra debugging for very large values to help track the Redis storage issue
    if (debug && originalValue > 900000 && matchedUnit === 'th/s') {
        console.group('High Hashrate Debug Info');
        console.log(`Original: ${originalValue} ${originalUnit}`);
        console.log(`Normalized: ${normalizedValue} TH/s`);
        console.log(`Should be displayed as: ${(normalizedValue / 1000).toFixed(2)} PH/s`);
        console.log('Call stack:', new Error().stack);
        console.groupEnd();
    }

    return normalizedValue;
}

// ===== Chart Data Points Control =====
let chartPoints = 180; // Default to 180 points

function updateChartPointsButtons() {
    document.getElementById('btn-30').classList.toggle('active', chartPoints === 30);
    document.getElementById('btn-60').classList.toggle('active', chartPoints === 60);
    document.getElementById('btn-180').classList.toggle('active', chartPoints === 180);
}

function setChartPoints(points) {
    if (points === chartPoints) return;
    chartPoints = points;
    updateChartPointsButtons();
    // Reload block annotations for the new time range
    loadBlockAnnotations(chartPoints);

    updateChartWithNormalizedData(trendChart, latestMetrics);

    try {
        localStorage.setItem('chartPointsPreference', points.toString());
    } catch (e) {
        console.error("Error storing chart points preference", e);
    }

    // No need to reconnect SSE when toggling chart view
    // The current metrics already contain all history points
    // and updateChartWithNormalizedData will re-render the chart
}

function showLoadingOverlay(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Remove existing overlay if any
    let overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();

    // Create loading overlay
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10';
    overlay.style.borderRadius = '4px';

    // Add loading spinner
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    overlay.appendChild(spinner);

    // Make parent position relative for absolute positioning
    const parent = element.parentElement;
    if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
    }

    // Add overlay to parent
    parent.appendChild(overlay);

    // Auto-hide after 2 seconds (failsafe)
    setTimeout(() => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.remove();
    }, 2000);
}

// Helper function to format hashrate values for display
function formatHashrateForDisplay(value, unit) {
    if (isNaN(value) || value === null || value === undefined) return "N/A";

    // Always normalize to TH/s first if unit is provided
    let normalizedValue = unit ? normalizeHashrate(value, unit) : value;

    // Select appropriate unit based on magnitude
    if (normalizedValue >= 1000000) { // EH/s range
        return (normalizedValue / 1000000).toFixed(2) + ' EH/s';
    } else if (normalizedValue >= 1000) { // PH/s range
        return (normalizedValue / 1000).toFixed(2) + ' PH/s';
    } else if (normalizedValue >= 1) { // TH/s range
        return normalizedValue.toFixed(2) + ' TH/s';
    } else if (normalizedValue >= 0.001) { // GH/s range
        return (normalizedValue * 1000).toFixed(2) + ' GH/s';
    } else { // MH/s range or smaller
        return (normalizedValue * 1000000).toFixed(2) + ' MH/s';
    }
}

// Function to calculate block finding probability based on hashrate and network hashrate
function calculateBlockProbability(yourHashrate, yourHashrateUnit, networkHashrate) {
    // First normalize both hashrates to the same unit (TH/s)
    const normalizedYourHashrate = normalizeHashrate(yourHashrate, yourHashrateUnit);

    // Network hashrate is in EH/s, convert to TH/s (1 EH/s = 1,000,000 TH/s)
    const networkHashrateInTH = networkHashrate * 1000000;

    // Calculate probability as your_hashrate / network_hashrate
    const probability = normalizedYourHashrate / networkHashrateInTH;

    // Format the probability for display
    return formatProbability(probability);
}

// Format probability for display
function formatProbability(probability) {
    // Format as 1 in X chance (more intuitive for small probabilities)
    if (probability > 0) {
        const oneInX = Math.round(1 / probability);
        return `1 : ${numberWithCommas(oneInX)}`;
    } else {
        return "N/A";
    }
}

// Calculate theoretical time to find a block based on hashrate
function calculateBlockTime(yourHashrate, yourHashrateUnit, networkHashrate) {
    // First normalize both hashrates to the same unit (TH/s)
    const normalizedYourHashrate = normalizeHashrate(yourHashrate, yourHashrateUnit);

    // Make sure network hashrate is a valid number
    if (typeof networkHashrate !== 'number' || isNaN(networkHashrate) || networkHashrate <= 0) {
        console.error("Invalid network hashrate:", networkHashrate);
        return "N/A";
    }

    // Network hashrate is in EH/s, convert to TH/s (1 EH/s = 1,000,000 TH/s)
    const networkHashrateInTH = networkHashrate * 1000000;

    // Calculate the probability of finding a block per hash attempt
    const probability = normalizedYourHashrate / networkHashrateInTH;

    // Bitcoin produces a block every 10 minutes (600 seconds) on average
    const secondsToFindBlock = 600 / probability;

    // Log the calculation for debugging
    console.log(`Block time calculation using network hashrate: ${networkHashrate} EH/s`);
    console.log(`Your hashrate: ${yourHashrate} ${yourHashrateUnit} (normalized: ${normalizedYourHashrate} TH/s)`);
    console.log(`Probability: ${normalizedYourHashrate} / (${networkHashrate} * 1,000,000) = ${probability}`);
    console.log(`Time to find block: 600 seconds / ${probability} = ${secondsToFindBlock} seconds`);
    console.log(`Estimated time: ${secondsToFindBlock / 86400} days (${secondsToFindBlock / 86400 / 365.25} years)`);

    return formatTimeRemaining(secondsToFindBlock);
}

// Format time in seconds to a readable format (similar to est_time_to_payout)
function formatTimeRemaining(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) {
        return "N/A";
    }

    // Extremely large values (over 100 years) are not useful
    if (seconds > 3153600000) { // 100 years in seconds
        return "Never (statistically)";
    }

    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;
    const months = days / 30.44; // Average month length
    const years = days / 365.25; // Account for leap years

    if (years >= 1) {
        // For very long timeframes, show years and months
        const remainingMonths = Math.floor((years - Math.floor(years)) * 12);
        if (remainingMonths > 0) {
            return `${Math.floor(years)} year${Math.floor(years) !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(years)} year${Math.floor(years) !== 1 ? 's' : ''}`;
    } else if (months >= 1) {
        // For months, show months and days
        const remainingDays = Math.floor((months - Math.floor(months)) * 30.44);
        if (remainingDays > 0) {
            return `${Math.floor(months)} month${Math.floor(months) !== 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(months)} month${Math.floor(months) !== 1 ? 's' : ''}`;
    } else if (days >= 1) {
        // For days, show days and hours
        const remainingHours = Math.floor((days - Math.floor(days)) * 24);
        if (remainingHours > 0) {
            return `${Math.floor(days)} day${Math.floor(days) !== 1 ? 's' : ''}, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(days)} day${Math.floor(days) !== 1 ? 's' : ''}`;
    } else if (hours >= 1) {
        // For hours, show hours and minutes
        const remainingMinutes = Math.floor((hours - Math.floor(hours)) * 60);
        if (remainingMinutes > 0) {
            return `${Math.floor(hours)} hour${Math.floor(hours) !== 1 ? 's' : ''}, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(hours)} hour${Math.floor(hours) !== 1 ? 's' : ''}`;
    } else {
        // For minutes, just show minutes
        return `${Math.ceil(minutes)} minute${Math.ceil(minutes) !== 1 ? 's' : ''}`;
    }
}

// Calculate pool luck as a percentage
function calculatePoolLuck(actualSats, estimatedSats) {
    if (!actualSats || !estimatedSats || estimatedSats === 0) {
        return null;
    }

    // Calculate luck as a percentage (actual/estimated * 100)
    const luck = (actualSats / estimatedSats) * 100;
    return luck;
}

// Format luck percentage for display with color coding
function formatLuckPercentage(luckPercentage) {
    if (luckPercentage === null) {
        return "N/A";
    }

    const formattedLuck = luckPercentage.toFixed(1) + "%";

    // Don't add classes here, just return the formatted value
    // The styling will be applied separately based on the value
    return formattedLuck;
}

function trackPayoutPerformance(data) {
    // Check if we have the necessary data
    if (!data || data.unpaid_earnings === undefined) {
        return;
    }

    const currentUnpaidEarnings = data.unpaid_earnings;
    const currentTime = new Date();

    // First-time initialization
    if (lastPayoutTracking.lastUnpaidEarnings === null) {
        lastPayoutTracking.lastUnpaidEarnings = currentUnpaidEarnings;
        return;
    }

    // Check if unpaid earnings decreased significantly (potential payout)
    if (currentUnpaidEarnings < lastPayoutTracking.lastUnpaidEarnings * 0.5) {
        console.log("Payout detected! Unpaid earnings decreased from",
            lastPayoutTracking.lastUnpaidEarnings, "to", currentUnpaidEarnings);

        const actualPayoutTime = data.last_block_time ? new Date(data.last_block_time) : currentTime;

        const payoutRecord = {
            timestamp: actualPayoutTime,
            amountBTC: (lastPayoutTracking.lastUnpaidEarnings - currentUnpaidEarnings).toFixed(8),
            verified: false,
            status: 'pending'
        };

        lastPayoutTracking.payoutHistory.unshift(payoutRecord);
        if (lastPayoutTracking.payoutHistory.length > 10) {
            lastPayoutTracking.payoutHistory.pop();
        }

        updateAvgDaysFromHistory();

        try {
            localStorage.setItem('payoutHistory', JSON.stringify(lastPayoutTracking.payoutHistory));
            fetch('/api/payout-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record: payoutRecord })
            });
        } catch (e) {
            console.error("Error saving payout history to localStorage:", e);
        }

        displayPayoutComparison(payoutRecord);
    }

    lastPayoutTracking.lastUnpaidEarnings = currentUnpaidEarnings;
}


// Update the displayPayoutComparison function to use better formatting
function displayPayoutComparison(comparison) {

    // Update the UI with the latest payout comparison
    const payoutInfoCard = $("#payoutMiscCard .card-body");

    // Remove old comparison element if exists
    $("#payout-comparison").remove();

    // Create a new comparison element
    const comparisonElement = $("<p id='payout-comparison'></p>");

    // Format date using the earnings.js style formatter
    const formattedDate = formatPayoutDate(comparison.timestamp);

    comparisonElement.html(`
        <strong>Last Payout:</strong>
        <span class="metric-note">${formattedDate} (${formatBTC(comparison.amountBTC)} BTC)</span>
    `);

    // Add to the payout card - insert after the Est. Time to Payout element
    $("#est_time_to_payout").parent().after(comparisonElement);

    // Also update the payout history display if it exists
    if ($("#payout-history-container").is(":visible")) {
        displayPayoutSummary();
    }
}

// Function to load payout history from localStorage
function loadPayoutHistory() {
    // Attempt to load from server first
    fetch('/api/payout-history')
        .then(res => res.json())
        .then(data => {
            if (data && Array.isArray(data.payout_history)) {
                lastPayoutTracking.payoutHistory = data.payout_history;
                localStorage.setItem('payoutHistory', JSON.stringify(lastPayoutTracking.payoutHistory));
                return;
            }
            loadLocalHistory();
        })
        .catch(() => {
            loadLocalHistory();
        });
}

function loadLocalHistory() {
    try {
        const savedHistory = localStorage.getItem('payoutHistory');
        if (savedHistory) {
            lastPayoutTracking.payoutHistory = JSON.parse(savedHistory);
        }
    } catch (e) {
        console.error("Error loading payout history from localStorage:", e);
    }
}

// Update the init function to add the summary display
function initPayoutTracking() {
    loadPayoutHistory();

    // Add a button to view payout history with theme-aware styling
    const theme = getCurrentTheme();
    const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';

    // Create button with theme-aware text color
    const viewHistoryButton = $("<button>", {
        id: "view-payout-history",
        text: "VIEW LAST PAYOUT",
        click: togglePayoutHistoryDisplay,
        class: "btn btn-sm mt-2",
        style: `
            background-color: ${theme.PRIMARY}; 
            color: ${isDeepSea ? 'white' : 'black'};
            border-radius: 0;
            font-style: bold;
        `
    });

    $("#est_time_to_payout").parent().after(viewHistoryButton);

    // Create a container for the payout history (initially hidden)
    $("<div>", {
        id: "payout-history-container",
        style: "display: none; margin-top: 10px;"
    }).insertAfter(viewHistoryButton);

    // Update theme-change listener for the button with fixed colors for each theme
    $(document).on('themeChanged', function () {
        const updatedTheme = getCurrentTheme();
        // Check if DeepSea theme is active
        const isDeepSeaActive = localStorage.getItem('useDeepSeaTheme') === 'true';

        $("#view-payout-history").css({
            'background-color': updatedTheme.PRIMARY,
            'color': isDeepSeaActive ? 'white' : 'black'  // White for DeepSea, Black for Bitcoin
        });
    });

    // Verify payouts against official records
    verifyPayoutsAgainstOfficial();

    // Schedule regular checks for new data
    setInterval(verifyPayoutsAgainstOfficial, 1 * 60 * 1000); // Check every 1 minutes
}

// Update toggle function to include only summary display
function togglePayoutHistoryDisplay() {
    const container = $("#payout-history-container");
    const button = $("#view-payout-history");

    if (container.is(":visible")) {
        container.slideUp();
        button.text("VIEW LAST PAYOUT");
    } else {
        // Clear the container first
        container.empty();

        // Display payout summary only - this now handles everything
        displayPayoutSummary();

        // Show the container and update button text
        container.slideDown();
        button.text("HIDE LAST PAYOUT");
    }
}

// Enhanced function to display complete payout summary information
function displayPayoutSummary() {
    // Get the container
    const container = $("#payout-history-container");

    // Get current theme for styling
    const theme = getCurrentTheme();

    // Clear the container first
    container.empty();

    // Create a base container for the summary
    const summaryElement = $(`
        <div id="payout-summary" class="mb-3 p-2">
            <h6 style="color:${theme.PRIMARY};margin-bottom:8px; font-weight: bold; font-size: 18px; text-align: center;">Last Payout Summary</h6>
            <div id="summary-content"></div>
        </div>
    `);

    // Prepare the content area
    const contentArea = summaryElement.find("#summary-content");

    // Check if we have any payout history
    if (!lastPayoutTracking.payoutHistory || lastPayoutTracking.payoutHistory.length === 0) {
        contentArea.html('<p class="text-muted">No payout history available yet.</p>');

        // Add to container
        container.append(summaryElement);
        return;
    }

    // Get the most recent payout (which is the first one in the array since it's sorted newest first)
    const lastPayout = lastPayoutTracking.payoutHistory[0];

    // If no payout found (shouldn't happen but just in case), show a message
    if (!lastPayout) {
        contentArea.html('<p class="text-muted">No payout information available.</p>');
        container.append(summaryElement);
        return;
    }

    // Format date for better display
    const payoutDate = formatPayoutDate(lastPayout.timestamp);

    // Format the BTC amount
    const btcAmount = formatBTC(lastPayout.amountBTC);

    // Format fiat value using current currency and exchange rate
    let fiatValueStr = "N/A";
    if (lastPayout.amountBTC !== undefined) {
        // Get current user currency and exchange rate from latestMetrics
        const currency = latestMetrics?.currency || 'USD';
        const exchangeRate = (latestMetrics?.exchange_rates && latestMetrics.exchange_rates[currency])
            ? latestMetrics.exchange_rates[currency]
            : 1.0;

        // Calculate fiat value using current BTC price
        const btcPrice = latestMetrics?.btc_price || 0;
        if (btcPrice > 0) {
            const fiatValue = parseFloat(lastPayout.amountBTC) * btcPrice;
            const symbol = getCurrencySymbol(currency);
            fiatValueStr = `${symbol}${numberWithCommas(fiatValue.toFixed(2))}`;
        }
        // Fallback to stored fiat value if available
        else if (lastPayout.fiat_value !== undefined && lastPayout.rate !== undefined) {
            const fiatValue = lastPayout.fiat_value;
            const symbol = getCurrencySymbol(currency);
            fiatValueStr = `${symbol}${numberWithCommas(fiatValue.toFixed(2))}`;
        }
    }


    // Format transaction status and link if available
    let statusDisplay = lastPayout.status || "pending";
    const statusClass = lastPayout.verified ? "text-success" : "text-warning";

    // Build HTML for the transaction link
    let txLink = '';
    if (lastPayout.officialId) {
        txLink = `
            <a href="https://mempool.guide/tx/${lastPayout.officialId}" 
               target="_blank" 
               class="btn btn-sm btn-secondary ms-2"
               style="font-size: 12px; width: 90px;"
               title="View transaction on mempool.guide">
                <i class="fa-solid fa-external-link-alt"></i> View TX
            </a>`;
    }

    // Update the inner content area of the summary with dashboard-consistent styling
    contentArea.html(`
        <div style="font-size: 14px;">
            <div style="display: flex; justify-content: center;">
                <div style="width: 100%; max-width: 200px;">
                    <p>
                        <strong>Date:</strong>
                        <span class="metric-value white">${payoutDate}</span>
                    </p>
                    <p>
                        <strong>Amount:</strong>
                        <span class="metric-value yellow">${btcAmount} BTC</span>
                    </p>
                    <p>
                        <strong>Fiat Value:</strong>
                        <span class="metric-value green">${fiatValueStr}</span>
                    </p>
                    <p>
                        <strong>Average Payout Interval:</strong>
                        <span class="metric-value yellow">${lastPayoutTracking.avgDays ? lastPayoutTracking.avgDays.toFixed(2) + ' days' : 'N/A'}</span>
                    </p>
                    <p>
                        <strong>Status:</strong>
                        <span class="metric-value ${lastPayout.verified ? 'green' : 'yellow'}">${statusDisplay}</span>
                        ${txLink}
                    </p>
                </div>
            </div>
        </div>
    `);

    // Add to container
    container.append(summaryElement);

    // Add view more link to the earnings page
    const viewMoreLink = $("<div class='text-center'></div>");
    const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    viewMoreLink.html(`
        <a href='/earnings' class='btn btn-sm' style='background-color:${theme.PRIMARY};color:${isDeepSea ? 'white' : 'black'};'>
            Complete Payout History
        </a>
    `);
    container.append(viewMoreLink);

    // Add CSS styling for the container
    $("<style>").text(`
    #payout-history-container {
        background-color: var(--bg-color);
        padding: 0.5rem;
        margin-top: 1rem;
        margin-bottom: 1rem;
        border: 1px solid var(--primary-color);
        box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.2);
        position: relative;
    }

    #payout-history-container::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px);
        pointer-events: none;
        z-index: 1;
    }

    #payout-summary {
        position: relative;
        z-index: 1;
        margin-bottom: 0.75rem;
    }

    /* DeepSea specific styling for payout content */
    .deepsea-theme #payout-history-container {
        position: relative;
        z-index: 1;
    }

    /* Theme-specific styling for the "Complete Payout History" button */
    .deepsea-theme #payout-history-container .btn {
        color: white !important;
    }
    .bitcoin-theme #payout-history-container .btn, 
    html:not(.deepsea-theme) #payout-history-container .btn {
        color: black !important;
    }

    /* Make payout text respect the DeepSea overlay opacity */  
    .deepsea-theme #payout-history-container .metric-value {
        position: relative;
        z-index: 1;
        opacity: 0.85;
    }
    `).appendTo("head");
}

// Add these utility functions from earnings.js for better date formatting
function formatPayoutDate(timestamp) {
    // Use timezone-aware formatting consistent with earnings.js
    const timezone = window.dashboardTimezone || 'America/Los_Angeles';
    
    return new Date(timestamp).toLocaleString('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// Function to format BTC values consistently
function formatBTC(btcValue) {
    return parseFloat(btcValue).toFixed(8);
}

// Enhanced function to verify and enrich payout history with data from earnings
function verifyPayoutsAgainstOfficial() {
    // Fetch the official payment history from the earnings endpoint
    $.ajax({
        url: '/api/earnings',
        method: 'GET',
        success: function (data) {
            if (!data || !data.payments || !data.payments.length) return;

            // Store average days between payouts if available
            if (data.avg_days_between_payouts !== undefined && data.avg_days_between_payouts !== null) {
                lastPayoutTracking.avgDays = data.avg_days_between_payouts;
            }

            // Get official payment records - newest first
            const officialPayments = data.payments.sort((a, b) =>
                new Date(b.date) - new Date(a.date)
            );

            // Get our detected payouts
            const detectedPayouts = lastPayoutTracking.payoutHistory;

            // 1. First match detected payouts with official records
            detectedPayouts.forEach(detectedPayout => {
                const payoutDate = new Date(detectedPayout.timestamp);

                const matchingPayment = officialPayments.find(payment => {
                    const paymentDate = new Date(payment.date);
                    return Math.abs(paymentDate - payoutDate) < (2 * 60 * 60 * 1000) &&
                        Math.abs(parseFloat(payment.amount_btc) - parseFloat(detectedPayout.amountBTC)) < 0.00001;
                });

                if (matchingPayment) {
                    detectedPayout.verified = true;
                    detectedPayout.officialId = matchingPayment.txid || '';
                    detectedPayout.status = matchingPayment.status || 'confirmed';

                    if (matchingPayment.rate) {
                        detectedPayout.rate = matchingPayment.rate;
                        detectedPayout.fiat_value = parseFloat(detectedPayout.amountBTC) * matchingPayment.rate;
                    }
                } else {
                    detectedPayout.verified = false;
                }
            });

            // 2. Add any official records that weren't detected
            // Find records from past 30 days that don't have matching detected payouts
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            officialPayments.forEach(payment => {
                const paymentDate = new Date(payment.date);
                if (paymentDate < thirtyDaysAgo) return; // Skip older than 30 days

                // Check if we already have this payment in our detected list
                const exists = detectedPayouts.some(payout => {
                    if (payout.officialId && payment.txid) {
                        return payout.officialId === payment.txid;
                    }

                    const payoutDate = new Date(payout.timestamp);
                    return Math.abs(paymentDate - payoutDate) < (2 * 60 * 60 * 1000) &&
                        Math.abs(parseFloat(payment.amount_btc) - parseFloat(payout.amountBTC)) < 0.00001;
                });

                if (!exists) {
                    const syntheticPayout = {
                        timestamp: paymentDate,
                        amountBTC: payment.amount_btc,
                        verified: true,
                        officialId: payment.txid || '',
                        status: payment.status || 'confirmed',
                        officialRecordOnly: true
                    };

                    // Add exchange rate data if available
                    if (payment.rate) {
                        syntheticPayout.rate = payment.rate;
                        syntheticPayout.fiat_value = parseFloat(payment.amount_btc) * payment.rate;
                    }

                    // Add to our history
                    lastPayoutTracking.payoutHistory.push(syntheticPayout);
                }
            });

            // Sort the combined list by date (newest first)
            lastPayoutTracking.payoutHistory.sort((a, b) =>
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            // Limit to most recent 30 entries to prevent unbounded growth
            if (lastPayoutTracking.payoutHistory.length > 30) {
                lastPayoutTracking.payoutHistory = lastPayoutTracking.payoutHistory.slice(0, 30);
            }

            // Update the display with enriched data if it's visible
            if ($("#payout-history-container").is(":visible")) {
                displayPayoutSummary();
            }

            // Save the updated history
            try {
                localStorage.setItem('payoutHistory', JSON.stringify(lastPayoutTracking.payoutHistory));
                fetch('/api/payout-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ history: lastPayoutTracking.payoutHistory })
                });
            } catch (e) {
                console.error("Error saving enriched payout history to localStorage:", e);
            }
        },
        error: function (error) {
            console.error("Failed to fetch earnings data:", error);
        }
    });
}

// SSE Connection with Error Handling and Reconnection Logic
function setupEventSource() {
    console.log("Setting up EventSource connection...");

    if (window.eventSource) {
        console.log("Closing existing EventSource connection");
        window.eventSource.close();
        window.eventSource = null;
    }

    // Reload chart points preference in case the variable was reset
    try {
        const storedPreference = localStorage.getItem('chartPointsPreference');
        if (storedPreference) {
            const points = parseInt(storedPreference, 10);
            if ([30, 60, 180].includes(points)) {
                chartPoints = points;
            }
        }
    } catch (e) {
        console.error("Error loading chart points preference", e);
    }

    // Always use absolute URL with origin to ensure it works from any path
    const baseUrl = window.location.origin;
    // The server now always streams the full history so no points parameter is needed
    const streamUrl = `${baseUrl}/stream`;

    console.log('Setting up EventSource using shared history');

    // Clear any existing ping interval
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }

    // Clear any connection lost timeout
    if (connectionLostTimeout) {
        clearTimeout(connectionLostTimeout);
        connectionLostTimeout = null;
    }

    try {
        const eventSource = new EventSource(streamUrl);

        eventSource.onopen = function (e) {
            console.log("EventSource connection opened successfully");
            connectionRetryCount = 0; // Reset retry count on successful connection
            reconnectionDelay = 1000; // Reset reconnection delay
            hideConnectionIssue();

            // Add this line to hide the loading overlay immediately when connected
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.remove();

            // Start ping interval to detect dead connections
            lastPingTime = Date.now();
            pingInterval = setInterval(function () {
                const now = Date.now();
                if (now - lastPingTime > 60000) { // 60 seconds without data
                    console.warn("No data received for 60 seconds, reconnecting...");
                    showConnectionIssue("Connection stalled");
                    eventSource.close();
                    setupEventSource();
                }
            }, 30000); // Check every 30 seconds
        };

        eventSource.onmessage = function (e) {
            lastPingTime = Date.now(); // Update ping time on any message

            try {
                const data = JSON.parse(e.data);

                // Handle different message types
                if (data.type === "ping") {
                    // Update connection count if available
                    if (data.connections !== undefined) {
                        console.log(`Active connections: ${data.connections}`);
                    }
                    return;
                }

                if (data.type === "timeout_warning") {
                    console.log(`Connection timeout warning: ${data.remaining}s remaining`);
                    // If less than 30 seconds remaining, prepare for reconnection
                    if (data.remaining < 30) {
                        console.log("Preparing for reconnection due to upcoming timeout");
                    }
                    return;
                }

                if (data.type === "timeout") {
                    console.log("Connection timeout from server:", data.message);
                    eventSource.close();
                    // If reconnect flag is true, reconnect immediately
                    if (data.reconnect) {
                        console.log("Server requested reconnection");
                        setTimeout(setupEventSource, 500);
                    } else {
                        setupEventSource();
                    }
                    return;
                }

                if (data.error) {
                    console.error("Server reported error:", data.error);
                    showConnectionIssue(data.error);

                    // If retry time provided, use it, otherwise use default
                    const retryTime = data.retry || 5000;
                    setTimeout(function () {
                        manualRefresh();
                    }, retryTime);
                    return;
                }

                // Process regular data update
                latestMetrics = data;
                updateUI();
                hideConnectionIssue();

                // Notify BitcoinMinuteRefresh that we did a refresh
                BitcoinMinuteRefresh.notifyRefresh();
            } catch (err) {
                console.error("Error processing SSE data:", err);
                showConnectionIssue("Data processing error");
            }
        };

        eventSource.onerror = function (e) {
            console.error("SSE connection error", e);
            showConnectionIssue("Connection lost");

            eventSource.close();

            // Implement exponential backoff for reconnection
            connectionRetryCount++;

            if (connectionRetryCount > maxRetryCount) {
                console.log("Maximum retry attempts reached, switching to polling mode");
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }

                // Switch to regular polling
                showConnectionIssue("Using polling mode");
                setInterval(manualRefresh, 30000); // Poll every 30 seconds
                manualRefresh(); // Do an immediate refresh
                return;
            }

            // Exponential backoff with jitter
            const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
            reconnectionDelay = Math.min(30000, reconnectionDelay * 1.5 * jitter);

            console.log(`Reconnecting in ${(reconnectionDelay / 1000).toFixed(1)} seconds... (attempt ${connectionRetryCount}/${maxRetryCount})`);
            setTimeout(setupEventSource, reconnectionDelay);
        };

        window.eventSource = eventSource;

        // Set a timeout to detect if connection is established
        connectionLostTimeout = setTimeout(function () {
            if (eventSource.readyState !== 1) { // 1 = OPEN
                console.warn("Connection not established within timeout, switching to manual refresh");
                showConnectionIssue("Connection timeout");
                eventSource.close();
                manualRefresh();
            }
        }, 30000); // 30 seconds timeout to establish connection

    } catch (error) {
        console.error("Failed to create EventSource:", error);
        showConnectionIssue("Connection setup failed");
        setTimeout(setupEventSource, 5000); // Try again in 5 seconds
    }

    // Add page visibility change listener
    // This helps reconnect when user returns to the tab after it's been inactive
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
}

// Handle page visibility changes
function handleVisibilityChange() {
    if (!document.hidden) {
        console.log("Page became visible, checking connection");
        if (!window.eventSource || window.eventSource.readyState !== 1) {
            console.log("Connection not active, reestablishing");
            setupEventSource();
        }
        manualRefresh(); // Always refresh data when page becomes visible
    }
}

// Helper function to show connection issues to the user
function showConnectionIssue(message) {
    const theme = getCurrentTheme();
    let $connectionStatus = $("#connectionStatus");
    if (!$connectionStatus.length) {
        $("body").append(`<div id="connectionStatus" style="position: fixed; top: 10px; right: 10px; background: rgba(255,0,0,0.7); color: white; padding: 10px; z-index: 9999;"></div>`);
        $connectionStatus = $("#connectionStatus");
    }
    $connectionStatus.html(`<i class="fas fa-exclamation-triangle"></i> ${message}`).show();

    // Show manual refresh button with theme color
    $("#refreshButton").css('background-color', theme.PRIMARY).show();
}

// Helper function to hide connection issue message
function hideConnectionIssue() {
    $("#connectionStatus").hide();
    $("#refreshButton").hide();
}

// Improved manual refresh function as fallback
function manualRefresh() {
    console.log("Manually refreshing data...");

    // Prepare arrow indicators for a new refresh cycle
    arrowIndicator.prepareForRefresh();

    $.ajax({
        url: '/api/metrics',
        method: 'GET',
        dataType: 'json',
        timeout: 15000, // 15 second timeout
        success: function (data) {
            console.log("Manual refresh successful");
            lastPingTime = Date.now();
            latestMetrics = data;

            updateUI();
            hideConnectionIssue();

            // Notify BitcoinMinuteRefresh that we've refreshed the data
            BitcoinMinuteRefresh.notifyRefresh();
        },
        error: function (xhr, status, error) {
            console.error("Manual refresh failed:", error);
            showConnectionIssue("Manual refresh failed");

            // Try again with exponential backoff
            const retryDelay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(5, connectionRetryCount)));
            connectionRetryCount++;
            setTimeout(manualRefresh, retryDelay);
        }
    });
}

// Modify the initializeChart function to use blue colors for the chart
function initializeChart() {
    try {
        const ctx = document.getElementById('trendGraph').getContext('2d');
        if (!ctx) {
            console.error("Could not find trend graph canvas");
            return null;
        }

        if (!window.Chart) {
            console.error("Chart.js not loaded");
            return null;
        }

        // Get the current theme colors
        const theme = getCurrentTheme();

        // Check if annotation plugin is available
        const hasAnnotationPlugin = window.simpleAnnotationPlugin !== undefined;

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'HASHRATE TREND (TH/s)',
                    data: [],
                    borderWidth: 2,
                    borderColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return theme.PRIMARY;
                        }
                        // Create gradient for line
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, theme.CHART.GRADIENT_START);
                        gradient.addColorStop(1, theme.CHART.GRADIENT_END);
                        return gradient;
                    },
                    backgroundColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return `rgba(${theme.PRIMARY_RGB}, 0.1)`;
                        }
                        // Create gradient for fill
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, `rgba(${theme.PRIMARY_RGB}, 0.3)`);
                        gradient.addColorStop(0.5, `rgba(${theme.PRIMARY_RGB}, 0.2)`);
                        gradient.addColorStop(1, `rgba(${theme.PRIMARY_RGB}, 0.05)`);
                        return gradient;
                    },
                    fill: true,
                    tension: 0.3,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 0 // Disable animations for better performance
                },
                scales: {
                    x: {
                        display: true,
                        ticks: {
                            maxTicksLimit: 8, // Limit number of x-axis labels
                            maxRotation: 0,   // Don't rotate labels
                            autoSkip: true,   // Automatically skip some labels
                            color: '#FFFFFF',
                            font: {
                                family: "'VT323', monospace", // Terminal font
                                size: 14
                            }
                        },
                        grid: {
                            color: '#333333',
                            lineWidth: 0.5
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'HASHRATE (TH/S)',
                            color: theme.PRIMARY,
                            font: {
                                family: "'VT323', monospace",
                                size: 16,
                                weight: 'bold'
                            }
                        },
                        ticks: {
                            color: '#FFFFFF',
                            maxTicksLimit: 6, // Limit total number of ticks
                            precision: 1,     // Control decimal precision
                            autoSkip: true,   // Skip labels to prevent overcrowding
                            autoSkipPadding: 10, // Padding between skipped labels
                            font: {
                                family: "'VT323', monospace", // Terminal font
                                size: 14
                            },
                            callback: function (value) {
                                // For zero, just return 0
                                if (value === 0) return '0';

                                // For large values (1000+ TH/s), show in PH/s
                                if (value >= 1000) {
                                    return (value / 1000).toFixed(1) + ' PH';
                                }
                                // For values between 10 and 1000 TH/s
                                else if (value >= 10) {
                                    return Math.round(value);
                                }
                                // For small values, limit decimal places
                                else if (value >= 1) {
                                    return value.toFixed(1);
                                }
                                // For tiny values, use appropriate precision
                                else {
                                    return value.toPrecision(2);
                                }
                            }
                        },
                        grid: {
                            color: '#333333',
                            lineWidth: 0.5,
                            drawBorder: false,
                            zeroLineColor: '#555555',
                            zeroLineWidth: 1,
                            drawTicks: false
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: theme.PRIMARY,
                        bodyColor: '#FFFFFF',
                        titleFont: {
                            family: "'VT323', monospace",
                            size: 16,
                            weight: 'bold'
                        },
                        bodyFont: {
                            family: "'VT323', monospace",
                            size: 14
                        },
                        padding: 10,
                        cornerRadius: 0,
                        displayColors: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                return tooltipItems[0].label.toUpperCase();
                            },
                            label: function (context) {
                                // Format tooltip values with appropriate unit
                                const value = context.raw;
                                return 'HASHRATE: ' + formatHashrateForDisplay(value).toUpperCase();
                            }
                        }
                    },
                    legend: { display: false },
                    annotation: hasAnnotationPlugin ? {
                        annotations: {
                            averageLine: {
                                type: 'line',
                                yMin: 0,
                                yMax: 0,
                                borderColor: theme.CHART.ANNOTATION,
                                borderWidth: 3,
                                borderDash: [8, 4],
                                shadowColor: `rgba(${theme.PRIMARY_RGB}, 0.5)`,
                                shadowBlur: 8,
                                shadowOffsetX: 0,
                                shadowOffsetY: 0,
                                label: {
                                    enabled: true,
                                    content: '24HR AVG: 0 TH/S',
                                    backgroundColor: 'rgba(0,0,0,0.8)',
                                    color: theme.CHART.ANNOTATION,
                                    font: {
                                        family: "'VT323', monospace",
                                        size: 16,
                                        weight: 'bold'
                                    },
                                    padding: { top: 4, bottom: 4, left: 8, right: 8 },
                                    borderRadius: 0,
                                    position: 'start'
                                }
                            }
                        }
                    } : {}
                }
            }
        });
    } catch (error) {
        console.error("Error initializing chart:", error);
        return null;
    }
}

// Helper function to safely format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Server time update via polling
function updateServerTime() {
    $.ajax({
        url: "/api/time",
        method: "GET",
        timeout: 5000,
        success: function (data) {
            // Calculate the offset between server time and local time
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();

            // Update BitcoinMinuteRefresh with server time info
            BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);

            console.log("Server time synchronized. Offset:", serverTimeOffset, "ms");
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", textStatus, errorThrown);
        }
    });
}

// Update UI indicators (arrows) - replaced with ArrowIndicator call
function updateIndicators(newMetrics) {
    arrowIndicator.updateIndicators(newMetrics);
}

// Helper function to safely update element text content
function updateElementText(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
    }
}

// Helper function to safely update element HTML content
function updateElementHTML(elementId, html) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = html;
    }
}

// Update workers_hashing value from metrics, but don't try to access worker details
function updateWorkersCount() {
    if (latestMetrics && latestMetrics.workers_hashing !== undefined) {
        $("#workers_hashing").text(latestMetrics.workers_hashing || 0);

        // Update miner status with online/offline indicator based on worker count
        if (latestMetrics.workers_hashing > 0) {
            updateElementHTML("miner_status", "<span class='status-green'>ONLINE</span> <span class='retro-led'></span>");
        } else {
            updateElementHTML("miner_status", "<span class='status-red'>OFFLINE</span> <span class='retro-led-offline'></span>");
        }

        // Update DATUM GATEWAY status with satellite dish icon
        if (latestMetrics.pool_fees_percentage !== undefined && latestMetrics.pool_fees_percentage >= 0.9 && latestMetrics.pool_fees_percentage <= 1.3) {
            updateElementHTML("datum_status", "<span class='status-green'>CONNECTED</span> <i class='fa-solid fa-satellite-dish satellite-dish satellite-dish-connected'></i>");
        } else {
            updateElementHTML("datum_status", "<span class='status-red'>OFFLINE</span> <i class='fa-solid fa-satellite-dish satellite-dish satellite-dish-offline'></i>");
        }
    }
}

// Check for block updates and show congratulatory messages
function checkForBlockUpdates(data) {
    if (previousMetrics.last_block_height !== undefined &&
        data.last_block_height !== previousMetrics.last_block_height) {
        showCongrats("Congrats! New Block Found: " + data.last_block_height);
        if (trendChart && trendChart.data && trendChart.data.labels.length > 0) {
            const label = trendChart.data.labels[trendChart.data.labels.length - 1];
            blockAnnotations.push(label);
            saveBlockAnnotations();
            updateBlockAnnotations(trendChart);
        }
    }

    if (previousMetrics.blocks_found !== undefined &&
        data.blocks_found !== previousMetrics.blocks_found) {
        showCongrats("Congrats! Blocks Found updated: " + data.blocks_found);
    }
}

// Enhanced function to show congratulatory messages with DeepSea theme effects
function showCongrats(message) {
    // Get or create the congrats message element
    let $congrats = $("#congratsMessage");

    if ($congrats.length === 0) {
        $('body').append('<div id="congratsMessage"></div>');
        $congrats = $("#congratsMessage");
    }

    // Clear any existing content and stop any ongoing animations
    $congrats.empty().stop(true, true);

    // Add timestamp to the message
    const now = new Date(Date.now() + serverTimeOffset);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    const timeString = now.toLocaleTimeString('en-US', options);

    // Format the message with the timestamp
    const messageWithTimestamp = `${message} [${timeString}]`;

    // Check if DeepSea theme is active
    const isDeepSea = $('html').hasClass('deepsea-theme');

    // For DeepSea theme, add bubbles and special effects
    if (isDeepSea) {
        // Create bubble container
        const $bubbleContainer = $('<div class="congrats-bubbles"></div>');

        // Add several bubbles with random sizes and positions
        const isMobile = window.innerWidth < 768;
        const bubbleCount = isMobile ? 3 : 8; // Fewer bubbles on mobile

        for (let i = 0; i < bubbleCount; i++) {
            const size = Math.floor(Math.random() * 8) + 4; // 4-12px
            const left = Math.floor(Math.random() * 100); // 0-100%
            const animDuration = (Math.random() * 3) + 2; // 2-5s
            const delay = Math.random() * 1.5; // 0-1.5s
            const drift = Math.random() * 10 - 5; // -5 to 5 drift

            $('<div class="congrats-bubble"></div>')
                .css({
                    'width': size + 'px',
                    'height': size + 'px',
                    'left': left + '%',
                    '--drift': drift,
                    'animation-duration': animDuration + 's',
                    'animation-delay': delay + 's'
                })
                .appendTo($bubbleContainer);
        }

        // Add bubbles to the congrats message
        $congrats.append($bubbleContainer);
    }

    // Add the message text
    $congrats
        .append(`<span class="congrats-text">${messageWithTimestamp}</span>`)
        .fadeIn(500);

    // Set auto-hide timer
    setTimeout(function () {
        $congrats.fadeOut(800);
    }, 15000); // 15 seconds display time

    // Add click to dismiss
    $congrats.off('click').on('click', function () {
        $(this).fadeOut(500);
    });
}

// Enhanced Chart Update Function to handle temporary hashrate spikes
// Modified the updateChartWithNormalizedData function to ensure the 24hr avg line is visible in low hashrate mode
// Enhanced Chart Update Function with localStorage persistence
function updateChartWithNormalizedData(chart, data) {
    if (!chart || !data) {
        console.warn("Cannot update chart - chart or data is null");
        return;
    }

    try {
        // Try to load lowHashrate state from localStorage first
        const storedLowHashrateState = localStorage.getItem('lowHashrateState');

        // Initialize mode state by combining stored state with defaults
        if (!chart.lowHashrateState) {
            const defaultState = {
                isLowHashrateMode: false,
                highHashrateSpikeTime: 0,
                spikeCount: 0,
                lowHashrateConfirmTime: 0,
                modeSwitchTimeoutId: null,
                lastModeChange: 0,
                stableModePeriod: 600000
            };

            // If we have stored state, use it
            if (storedLowHashrateState) {
                try {
                    const parsedState = JSON.parse(storedLowHashrateState);
                    chart.lowHashrateState = {
                        ...defaultState,
                        ...parsedState,
                        // Reset any volatile state that shouldn't persist
                        highHashrateSpikeTime: parsedState.highHashrateSpikeTime || 0,
                        modeSwitchTimeoutId: null
                    };
                    console.log("Restored low hashrate mode from localStorage:", chart.lowHashrateState.isLowHashrateMode);
                } catch (e) {
                    console.error("Error parsing stored low hashrate state:", e);
                    chart.lowHashrateState = defaultState;
                }
            } else {
                chart.lowHashrateState = defaultState;
            }
        }

        // Get values with enhanced stability
        let useHashrate3hr = false;
        const currentTime = Date.now();
        const LOW_HASHRATE_THRESHOLD = 0.01; // TH/s 
        const HIGH_HASHRATE_THRESHOLD = 20.0; // TH/s
        const MODE_SWITCH_DELAY = 120000;     // Increase to 2 minutes for more stability
        const CONSECUTIVE_SPIKES_THRESHOLD = 3; // Increase to require more consistent high readings
        const MIN_MODE_STABILITY_TIME = 120000; // 2 minutes minimum between mode switches

        // Check if we changed modes recently - enforce a minimum stability period
        const timeSinceLastModeChange = currentTime - chart.lowHashrateState.lastModeChange;
        const enforceStabilityPeriod = timeSinceLastModeChange < MIN_MODE_STABILITY_TIME;

        // IMPORTANT: Calculate normalized hashrate values 
        const normalizedHashrate60sec = normalizeHashrate(data.hashrate_60sec || 0, data.hashrate_60sec_unit || 'th/s');
        const normalizedHashrate3hr = normalizeHashrate(data.hashrate_3hr || 0, data.hashrate_3hr_unit || 'th/s');
        const normalizedAvg = normalizeHashrate(data.hashrate_24hr || 0, data.hashrate_24hr_unit || 'th/s');

        // First check if we should use 3hr data based on the stored state
        useHashrate3hr = chart.lowHashrateState.isLowHashrateMode;

        // Case 1: Currently in low hashrate mode
        if (chart.lowHashrateState.isLowHashrateMode) {
            // Default to staying in low hashrate mode
            useHashrate3hr = true;

            // If we're enforcing stability, don't even check for mode change
            if (!enforceStabilityPeriod && normalizedHashrate60sec >= HIGH_HASHRATE_THRESHOLD) {
                // Only track spikes if we aren't in stability enforcement period
                if (!chart.lowHashrateState.highHashrateSpikeTime) {
                    chart.lowHashrateState.highHashrateSpikeTime = currentTime;
                    console.log("High hashrate spike detected in low hashrate mode");
                }

                // Increment spike counter
                chart.lowHashrateState.spikeCount++;
                console.log(`Spike count: ${chart.lowHashrateState.spikeCount}/${CONSECUTIVE_SPIKES_THRESHOLD}`);

                // Check if spikes have persisted long enough
                const spikeElapsedTime = currentTime - chart.lowHashrateState.highHashrateSpikeTime;

                if (chart.lowHashrateState.spikeCount >= CONSECUTIVE_SPIKES_THRESHOLD &&
                    spikeElapsedTime > MODE_SWITCH_DELAY) {
                    useHashrate3hr = false;
                    chart.lowHashrateState.isLowHashrateMode = false;
                    chart.lowHashrateState.highHashrateSpikeTime = 0;
                    chart.lowHashrateState.spikeCount = 0;
                    chart.lowHashrateState.lastModeChange = currentTime;
                    console.log("Exiting low hashrate mode after sustained high hashrate");

                    // Save state changes to localStorage
                    saveLowHashrateState(chart.lowHashrateState);
                } else {
                    console.log(`Remaining in low hashrate mode despite spike (waiting: ${Math.round(spikeElapsedTime / 1000)}/${MODE_SWITCH_DELAY / 1000}s, count: ${chart.lowHashrateState.spikeCount}/${CONSECUTIVE_SPIKES_THRESHOLD})`);
                }
            } else {
                // Don't reset counters immediately on every drop - make the counter more persistent
                if (chart.lowHashrateState.spikeCount > 0 && normalizedHashrate60sec < HIGH_HASHRATE_THRESHOLD) {
                    // Don't reset immediately, use a gradual decay approach
                    if (Math.random() < 0.2) { // 20% chance to decrement counter each update
                        chart.lowHashrateState.spikeCount--;
                        console.log("Spike counter decayed to:", chart.lowHashrateState.spikeCount);

                        // Save state changes to localStorage
                        saveLowHashrateState(chart.lowHashrateState);
                    }
                }
            }
        }
        // Case 2: Currently in normal mode
        else {
            // Default to staying in normal mode
            useHashrate3hr = false;

            // Don't switch to low hashrate mode immediately if we recently switched modes
            if (!enforceStabilityPeriod && normalizedHashrate60sec < LOW_HASHRATE_THRESHOLD && normalizedHashrate3hr > LOW_HASHRATE_THRESHOLD) {
                // Record when low hashrate condition was first observed
                if (!chart.lowHashrateState.lowHashrateConfirmTime) {
                    chart.lowHashrateState.lowHashrateConfirmTime = currentTime;
                    console.log("Low hashrate condition detected");

                    // Save state changes to localStorage
                    saveLowHashrateState(chart.lowHashrateState);
                }

                // Require at least 60 seconds of low hashrate before switching modes
                const lowHashrateTime = currentTime - chart.lowHashrateState.lowHashrateConfirmTime;
                if (lowHashrateTime > 60000) { // 1 minute
                    useHashrate3hr = true;
                    chart.lowHashrateState.isLowHashrateMode = true;
                    chart.lowHashrateState.lastModeChange = currentTime;
                    console.log("Entering low hashrate mode after persistent low hashrate condition");

                    // Save state changes to localStorage
                    saveLowHashrateState(chart.lowHashrateState);
                } else {
                    console.log(`Low hashrate detected but waiting for persistence: ${Math.round(lowHashrateTime / 1000)}/60s`);
                }
            } else {
                // Only reset the confirmation timer if we've been above threshold consistently
                if (chart.lowHashrateState.lowHashrateConfirmTime &&
                    currentTime - chart.lowHashrateState.lowHashrateConfirmTime > 30000) { // 30 seconds above threshold
                    chart.lowHashrateState.lowHashrateConfirmTime = 0;
                    console.log("Low hashrate condition cleared after consistent normal hashrate");

                    // Save state changes to localStorage
                    saveLowHashrateState(chart.lowHashrateState);
                } else if (chart.lowHashrateState.lowHashrateConfirmTime) {
                    console.log("Brief hashrate spike, maintaining low hashrate detection timer");
                }
            }
        }

        // Helper function to save lowHashrateState to localStorage
        function saveLowHashrateState(state) {
            try {
                // Create a clean copy without circular references or functions
                const stateToSave = {
                    isLowHashrateMode: state.isLowHashrateMode,
                    highHashrateSpikeTime: state.highHashrateSpikeTime,
                    spikeCount: state.spikeCount,
                    lowHashrateConfirmTime: state.lowHashrateConfirmTime,
                    lastModeChange: state.lastModeChange,
                    stableModePeriod: state.stableModePeriod
                };
                localStorage.setItem('lowHashrateState', JSON.stringify(stateToSave));
                console.log("Saved low hashrate state:", state.isLowHashrateMode);
            } catch (e) {
                console.error("Error saving low hashrate state to localStorage:", e);
            }
        }

        /**
         * Process history data with comprehensive validation, unit normalization, and performance optimizations
         * @param {Object} data - The metrics data containing hashrate history
         * @param {Object} chart - The Chart.js chart instance to update
         * @param {boolean} useHashrate3hr - Whether to use 3hr average data instead of 60sec data
         * @param {number} normalizedAvg - The normalized 24hr average hashrate for reference
         */
        if (data.arrow_history && data.arrow_history.hashrate_60sec) {
            // Validate history data
            try {
                const perfStart = performance.now(); // Performance measurement

                // Determine which history data to use (3hr or 60sec) with proper fallback
                let historyData;
                let dataSource;

                if (useHashrate3hr && data.arrow_history.hashrate_3hr && data.arrow_history.hashrate_3hr.length > 0) {
                    historyData = data.arrow_history.hashrate_3hr;
                    dataSource = "3hr";
                    chart.data.datasets[0].label = 'Hashrate Trend (3HR AVG)';
                } else {
                    historyData = data.arrow_history.hashrate_60sec;
                    dataSource = "60sec";
                    chart.data.datasets[0].label = 'Hashrate Trend (60SEC AVG)';

                    // If we wanted 3hr data but it wasn't available, log a warning
                    if (useHashrate3hr) {
                        console.warn("3hr data requested but not available, falling back to 60sec data");
                    }
                }

                console.log(`Using ${dataSource} history data with ${historyData?.length || 0} points`);

                if (historyData && historyData.length > 0) {
                    // Pre-process history data to filter out invalid entries
                    const validHistoryData = historyData.filter(item => {
                        return item &&
                            (typeof item.value !== 'undefined') &&
                            !isNaN(parseFloat(item.value)) &&
                            (parseFloat(item.value) >= 0) &&
                            typeof item.time === 'string';
                    });

                    if (validHistoryData.length < historyData.length) {
                        console.warn(`Filtered out ${historyData.length - validHistoryData.length} invalid data points`);
                    }

                    if (validHistoryData.length === 0) {
                        console.warn("No valid history data points after filtering");
                        useSingleDataPoint();
                        return;
                    }

                    // Format time labels more efficiently (do this once, not in a map callback)
                    const timeZone = dashboardTimezone || 'America/Los_Angeles';
                    const now = new Date();
                    const yearMonthDay = {
                        year: now.getFullYear(),
                        month: now.getMonth(),
                        day: now.getDate()
                    };

                    // Create time formatter function with consistent options
                    const timeFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: timeZone,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });

                    // Format all time labels at once
                    const formattedLabels = validHistoryData.map(item => {
                        const timeStr = item.time;
                        try {
                            // Parse time efficiently
                            let hours = 0, minutes = 0, seconds = 0;

                            if (timeStr.length === 8 && timeStr.indexOf(':') !== -1) {
                                // Format: HH:MM:SS
                                const parts = timeStr.split(':');
                                hours = parseInt(parts[0], 10);
                                minutes = parseInt(parts[1], 10);
                                seconds = parseInt(parts[2], 10);
                            } else if (timeStr.length === 5 && timeStr.indexOf(':') !== -1) {
                                // Format: HH:MM
                                const parts = timeStr.split(':');
                                hours = parseInt(parts[0], 10);
                                minutes = parseInt(parts[1], 10);
                            } else {
                                return timeStr; // Use original if format is unexpected
                            }

                            // Create time date with validation
                            if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) ||
                                hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
                                return timeStr; // Use original for invalid times
                            }

                            const timeDate = new Date(yearMonthDay.year, yearMonthDay.month, yearMonthDay.day,
                                hours, minutes, seconds);

                            // Format using the formatter
                            const formatted = timeFormatter.format(timeDate);
                            return formatted.replace(/\s[AP]M$/i, ''); // Remove AM/PM
                        } catch (e) {
                            console.error("Time formatting error:", e);
                            return timeStr; // Use original on error
                        }
                    });

                    chart.data.labels = formattedLabels;

                    // Process and normalize hashrate values with validation (optimize by avoiding multiple iterations)
                    const hashrateValues = [];
                    const validatedData = new Array(validHistoryData.length);

                    // Enhanced unit validation
                    const validUnits = new Set(['th/s', 'ph/s', 'eh/s', 'gh/s', 'mh/s', 'zh/s']);

                    // Process all data points with error boundaries around each item
                    for (let i = 0; i < validHistoryData.length; i++) {
                        try {
                            const item = validHistoryData[i];

                            // Safety conversion in case value is a string
                            const val = parseFloat(item.value);

                            // Get unit with better validation
                            let unit = (item.unit || 'th/s').toLowerCase().trim();

                            // Use storeHashrateWithUnit to properly handle unit conversions for large values
                            // This increases chart precision by storing values in appropriate units
                            if (typeof window.storeHashrateWithUnit === 'function') {
                                // Use our specialized function if available
                                const storedFormat = window.storeHashrateWithUnit(val, unit);
                                const normalizedValue = normalizeHashrate(val, unit);

                                // Store the properly adjusted values for tooltip display
                                item.storageValue = storedFormat.value;
                                item.storageUnit = storedFormat.unit;
                                item.originalValue = val;
                                item.originalUnit = unit;

                                validatedData[i] = normalizedValue;

                                // Collect valid values for statistics
                                if (normalizedValue > 0) {
                                    hashrateValues.push(normalizedValue);
                                }
                            } else {
                                // Original approach if storeHashrateWithUnit isn't available
                                const normalizedValue = normalizeHashrate(val, unit);

                                // Store original values for tooltip reference
                                item.originalValue = val;
                                item.originalUnit = unit;

                                validatedData[i] = normalizedValue;

                                // Collect valid values for statistics
                                if (normalizedValue > 0) {
                                    hashrateValues.push(normalizedValue);
                                }
                            }
                        } catch (err) {
                            console.error(`Error processing hashrate at index ${i}:`, err);
                            validatedData[i] = 0; // Use 0 as a safe fallback
                        }
                    }
                    // Limit the data points based on the selected chartPoints (30, 60, or 180)
                    const limitedData = validatedData.slice(-chartPoints);
                    chart.data.datasets[0].data = limitedData;

                    // Similarly, limit the labels
                    const limitedLabels = formattedLabels.slice(-chartPoints);
                    chart.data.labels = limitedLabels;

                    // Store the full datasets for reference, but don't overwrite the displayed data
                    chart.fullData = validatedData;
                    chart.originalData = validHistoryData; // Store for tooltip reference

                    // Update tooltip callback to display proper units
                    chart.options.plugins.tooltip.callbacks.label = function (context) {
                        // Calculate the correct index in the original data array based on display data length
                        let index = context.dataIndex;

                        // If we're in limited view mode (30m or 60m), adjust the index
                        if (chart.data.labels.length < chart.originalData.length) {
                            // Calculate the offset - we need to look at the last N points of the original data
                            const offset = chart.originalData.length - chart.data.labels.length;
                            index = offset + context.dataIndex;
                        }

                        const originalData = chart.originalData?.[index];

                        if (originalData) {
                            if (originalData.storageValue !== undefined && originalData.storageUnit) {
                                return `HASHRATE: ${originalData.storageValue} ${originalData.storageUnit.toUpperCase()}`;
                            }
                            else if (originalData.originalValue !== undefined && originalData.originalUnit) {
                                return `HASHRATE: ${originalData.originalValue} ${originalData.originalUnit.toUpperCase()}`;
                            }
                        }

                        // Last resort fallback
                        return 'HASHRATE: ' + formatHashrateForDisplay(context.raw).toUpperCase();
                    };

                    // Calculate statistics for anomaly detection with optimization
                    if (hashrateValues.length > 1) {
                        // Calculate mean, min, max in a single pass for efficiency
                        let sum = 0, min = Infinity, max = -Infinity;

                        for (let i = 0; i < hashrateValues.length; i++) {
                            const val = hashrateValues[i];
                            sum += val;
                            if (val < min) min = val;
                            if (val > max) max = val;
                        }

                        const mean = sum / hashrateValues.length;

                        // Enhanced outlier detection
                        const standardDeviation = calculateStandardDeviation(hashrateValues, mean);
                        const outlierThreshold = 3; // Standard deviations

                        // Check for outliers using both range and statistical methods
                        const hasOutliersByRange = (max > mean * 10 || min < mean / 10);
                        const hasOutliersByStats = hashrateValues.some(v => Math.abs(v - mean) > outlierThreshold * standardDeviation);

                        // Log more helpful diagnostics for outliers
                        if (hasOutliersByRange || hasOutliersByStats) {
                            console.warn("WARNING: Hashrate variance detected in chart data. Possible unit inconsistency.");
                            console.warn(`Stats: Min: ${min.toFixed(2)}, Max: ${max.toFixed(2)}, Mean: ${mean.toFixed(2)}, StdDev: ${standardDeviation.toFixed(2)} TH/s`);

                            // Give more specific guidance
                            if (max > 1000 && min < 10) {
                                console.warn("ADVICE: Data contains mixed units (likely TH/s and PH/s). Check API response consistency.");
                            }
                        }

                        // Log performance timing for large datasets
                        if (hashrateValues.length > 100) {
                            const perfEnd = performance.now();
                            console.log(`Processed ${hashrateValues.length} hashrate points in ${(perfEnd - perfStart).toFixed(1)}ms`);
                        }
                    }

                    // Find filtered valid values for y-axis limits (more efficient than creating a new array)
                    let activeValues = 0, yMin = Infinity, yMax = -Infinity;
                    for (let i = 0; i < validatedData.length; i++) {
                        const v = validatedData[i];
                        if (!isNaN(v) && v !== null && v > 0) {
                            activeValues++;
                            if (v < yMin) yMin = v;
                            if (v > yMax) yMax = v;
                        }
                    }

                    if (activeValues > 0) {
                        // Optimized y-axis range calculation with padding
                        const padding = useHashrate3hr ? 0.5 : 0.2; // More padding in low hashrate mode

                        // When in low hashrate mode, ensure the y-axis includes the 24hr average
                        if (useHashrate3hr && normalizedAvg > 0) {
                            // Ensure the 24-hour average is visible with adequate padding
                            const minPadding = normalizedAvg * padding;
                            const maxPadding = normalizedAvg * padding;

                            chart.options.scales.y.min = Math.min(yMin * (1 - padding), normalizedAvg - minPadding);
                            chart.options.scales.y.max = Math.max(yMax * (1 + padding), normalizedAvg + maxPadding);

                            console.log(`Low hashrate mode: Y-axis range [${chart.options.scales.y.min.toFixed(2)}, ${chart.options.scales.y.max.toFixed(2)}] TH/s`);
                        } else {
                            // Normal mode scaling with smarter padding (less padding for large ranges)
                            const dynamicPadding = Math.min(0.2, 10 / yMax); // Reduce padding as max increases
                            chart.options.scales.y.min = Math.max(0, yMin * (1 - dynamicPadding)); // Never go below zero
                            chart.options.scales.y.max = yMax * (1 + dynamicPadding);
                        }

                        // Set appropriate step size based on range - improved algorithm
                        const range = chart.options.scales.y.max - chart.options.scales.y.min;

                        // Dynamic target ticks based on chart height for better readability
                        const chartHeight = chart.height || 300;
                        const targetTicks = Math.max(4, Math.min(8, Math.floor(chartHeight / 50)));

                        // Calculate ideal step size
                        const rawStepSize = range / targetTicks;

                        // Find a "nice" step size that's close to the raw step size
                        const stepSize = calculateNiceStepSize(rawStepSize);

                        // Set the calculated stepSize
                        chart.options.scales.y.ticks.stepSize = stepSize;

                        // Log the chosen stepSize 
                        console.log(`Y-axis range: ${range.toFixed(2)} TH/s, using stepSize: ${stepSize} (target ticks: ${targetTicks})`);
                    }
                } else {
                    console.warn("No history data items available");
                    useSingleDataPoint();
                }
            } catch (historyError) {
                console.error("Error processing hashrate history data:", historyError);
                // Fall back to single datapoint if history processing fails
                useSingleDataPoint();
            }
        } else {
            // No history data, use single datapoint
            useSingleDataPoint();
        }

        /**
         * Calculate standard deviation of an array of values
         * @param {Array<number>} values - Array of numeric values
         * @param {number} mean - Pre-calculated mean (optional)
         * @returns {number} - Standard deviation
         */
        function calculateStandardDeviation(values, precalculatedMean = null) {
            if (!values || values.length <= 1) return 0;

            // Calculate mean if not provided
            const mean = precalculatedMean !== null ? precalculatedMean :
                values.reduce((sum, val) => sum + val, 0) / values.length;

            // Calculate sum of squared differences
            const squaredDiffSum = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);

            // Calculate standard deviation
            return Math.sqrt(squaredDiffSum / values.length);
        }

        /**
         * Calculate a "nice" step size close to the raw step size
         * @param {number} rawStepSize - The mathematically ideal step size
         * @returns {number} - A rounded, human-friendly step size
         */
        function calculateNiceStepSize(rawStepSize) {
            if (rawStepSize <= 0) return 1; // Safety check

            // Get order of magnitude
            const magnitude = Math.pow(10, Math.floor(Math.log10(rawStepSize)));
            const normalized = rawStepSize / magnitude;

            // Choose a nice step size
            let niceStepSize;
            if (normalized < 1.5) niceStepSize = 1;
            else if (normalized < 3) niceStepSize = 2;
            else if (normalized < 7) niceStepSize = 5;
            else niceStepSize = 10;

            return niceStepSize * magnitude;
        }

        // Handle single datapoint display when no history is available
        function useSingleDataPoint() {
            try {
                // Format current time
                const now = new Date();
                let currentTime;
                try {
                    currentTime = now.toLocaleTimeString('en-US', {
                        timeZone: dashboardTimezone || 'America/Los_Angeles',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    }).replace(/\s[AP]M$/i, '');
                } catch (e) {
                    console.error("Error formatting current time:", e);
                    currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                }

                // Choose which current hashrate to display with validation
                let currentValue, currentUnit, normalizedValue;

                if (useHashrate3hr) {
                    currentValue = parseFloat(data.hashrate_3hr || 0);
                    currentUnit = data.hashrate_3hr_unit || 'th/s';
                    chart.data.datasets[0].label = 'Hashrate Trend (3HR AVG)';
                } else {
                    currentValue = parseFloat(data.hashrate_60sec || 0);
                    currentUnit = data.hashrate_60sec_unit || 'th/s';
                    chart.data.datasets[0].label = 'Hashrate Trend (60SEC AVG)';
                }

                // Guard against invalid values
                if (isNaN(currentValue)) {
                    console.warn("Invalid hashrate value, using 0");
                    normalizedValue = 0;
                } else {
                    normalizedValue = normalizeHashrate(currentValue, currentUnit);
                }

                chart.data.labels = [currentTime];
                chart.data.datasets[0].data = [normalizedValue];

                // MODIFICATION: For single datapoint in low hashrate mode, ensure 24hr avg is visible
                if (useHashrate3hr && normalizedAvg > 0) {
                    const yMin = Math.min(normalizedValue * 0.8, normalizedAvg * 0.5);
                    const yMax = Math.max(normalizedValue * 1.2, normalizedAvg * 1.5);

                    chart.options.scales.y.min = yMin;
                    chart.options.scales.y.max = yMax;
                    console.log(`Low hashrate mode (single point): Adjusting y-axis to include 24hr avg: [${yMin.toFixed(2)}, ${yMax.toFixed(2)}]`);
                }
            } catch (err) {
                console.error("Error setting up single datapoint:", err);
                chart.data.labels = ["Now"];
                chart.data.datasets[0].data = [0];
            }
        }

        // Show low hashrate indicator as needed
        if (useHashrate3hr) {
            // Add indicator text to the chart
            if (!chart.lowHashrateIndicator) {
                // Create the indicator element if it doesn't exist
                const graphContainer = document.getElementById('graphContainer');
                if (graphContainer) {
                    const theme = getCurrentTheme();
                    const indicator = document.createElement('div');
                    indicator.id = 'lowHashrateIndicator';
                    indicator.style.position = 'absolute';
                    indicator.style.top = '10px';
                    indicator.style.right = '10px';
                    indicator.style.background = 'rgba(0,0,0,0.7)';
                    indicator.style.color = theme.PRIMARY;
                    indicator.style.padding = '5px 10px';
                    indicator.style.borderRadius = '3px';
                    indicator.style.fontSize = '12px';
                    indicator.style.zIndex = '10';
                    indicator.style.fontWeight = 'bold';
                    indicator.textContent = 'LOW HASHRATE MODE: SHOWING 3HR AVG';
                    graphContainer.appendChild(indicator);
                    chart.lowHashrateIndicator = indicator;
                }
            } else {
                chart.lowHashrateIndicator.style.color = getCurrentTheme().PRIMARY;
                chart.lowHashrateIndicator.style.display = 'block';
            }
        } else if (chart.lowHashrateIndicator) {
            chart.lowHashrateIndicator.style.display = 'none';
        }

        // UPDATE THE 24HR AVERAGE LINE ANNOTATION - THIS WAS MISSING
        if (chart.options && chart.options.plugins && chart.options.plugins.annotation &&
            chart.options.plugins.annotation.annotations && chart.options.plugins.annotation.annotations.averageLine) {

            // Get current theme for styling
            const theme = getCurrentTheme();

            // Update the position of the average line to match the 24hr hashrate
            chart.options.plugins.annotation.annotations.averageLine.yMin = normalizedAvg;
            chart.options.plugins.annotation.annotations.averageLine.yMax = normalizedAvg;

            // Update the annotation label
            const formattedAvg = formatHashrateForDisplay(data.hashrate_24hr, data.hashrate_24hr_unit);
            chart.options.plugins.annotation.annotations.averageLine.label.content =
                `24HR AVG: ${formattedAvg}`;

            // Set the color based on current theme
            chart.options.plugins.annotation.annotations.averageLine.borderColor = theme.CHART.ANNOTATION;
            chart.options.plugins.annotation.annotations.averageLine.label.color = theme.CHART.ANNOTATION;

            console.log(`Updated 24hr average line: ${normalizedAvg.toFixed(2)} TH/s`);
        } else {
            console.warn("Chart annotation plugin not properly configured");
        }

        updateBlockAnnotations(chart);
        // Finally update the chart with a safe non-animating update
        chart.update('none');
    } catch (chartError) {
        console.error("Error updating chart:", chartError);
    }
}

// Modify the pool fee calculation to use actual last block earnings
function calculatePoolFeeInSats(poolFeePercentage, lastBlockEarnings) {
    if (poolFeePercentage === undefined || poolFeePercentage === null ||
        lastBlockEarnings === undefined || lastBlockEarnings === null) {
        return null;
    }

    // Log the raw values for debugging
    console.log("Pool Fee %:", poolFeePercentage, "Last Block Earnings:", lastBlockEarnings);

    // Calculate how many SATS were taken as fees from the last block
    // Pool fee is a percentage, so we divide by 100 to get the actual rate
    const feeAmount = (poolFeePercentage / 100) * lastBlockEarnings;

    // Return as a negative number since it represents a cost
    return -Math.round(feeAmount);
}

// Main UI update function with currency support
function updateUI() {
    function ensureElementStyles() {
        // Create a style element if it doesn't exist
        if (!document.getElementById('customMetricStyles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'customMetricStyles';
            styleEl.textContent = `
        /* Ensure rows have consistent layout */
        .card-body p {
            position: relative;
            display: grid;
            grid-template-columns: auto auto 1fr;
            align-items: center;
            margin: 0.25rem 0;
            line-height: 1.2;
            gap: 0.25rem;
        }
        
        /* Label style */
        .card-body strong {
            grid-column: 1;
        }
        
        /* Main metric container */
        .main-metric {
            grid-column: 2;
            display: flex;
            align-items: center;
            white-space: nowrap;
        }
        
        /* All dividers */
        .metric-divider-container {
            grid-column: 3;
            justify-self: end;
            display: flex;
            align-items: center;
        }
        
        .metric-divider {
            display: inline-flex;
            align-items: center;
            margin-left: 1rem;
            padding-left: 0.75rem;
            height: 1.5em;
            white-space: nowrap;
        }
        
        .metric-divider-value {
            font-size: 0.85em;
            font-weight: normal;
            margin-right: 0.5rem;
            animation: pulse 2s infinite;
        }
        
        .metric-divider-note {
            font-size: 0.85em;
            opacity: 0.7;
            color: white;
            font-weight: normal;
        }
        
        span[id^="indicator_"] {
            margin-left: 0.25rem;
            width: 1rem;
            display: inline-flex;
        }
        `;
            document.head.appendChild(styleEl);
        }
    }

    // Helper function to create dividers with consistent horizontal alignment
    function createDivider(valueId, valueText, labelText, valueClass = "yellow") {
        const dividerContainer = document.createElement("span");
        dividerContainer.className = "metric-divider";

        // Value element
        const valueSpan = document.createElement("span");
        valueSpan.id = valueId;
        valueSpan.className = `metric-value metric-divider-value ${valueClass}`;
        valueSpan.textContent = valueText;
        dividerContainer.appendChild(valueSpan);

        // Label element
        const labelSpan = document.createElement("span");
        labelSpan.className = "metric-divider-note";
        labelSpan.textContent = labelText;
        dividerContainer.appendChild(labelSpan);

        return dividerContainer;
    }

    // Helper to attach a 3hr variance divider to a metric row
    function updateVarianceDivider(metricId, varianceId, varianceValue) {
        const para = document.getElementById(metricId).parentNode;
        ensureElementStyles();

        if (!para.querySelector('.main-metric')) {
            const metricEl = document.getElementById(metricId);
            const indicatorEl = document.getElementById(`indicator_${metricId}`);

            const mainMetric = document.createElement('span');
            mainMetric.className = 'main-metric';

            if (metricEl && indicatorEl) {
                let node = metricEl.nextSibling;
                while (node && node !== indicatorEl) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) {
                        para.removeChild(node);
                    }
                    node = nextNode;
                }

                metricEl.parentNode.insertBefore(mainMetric, metricEl);
                mainMetric.appendChild(metricEl);
                mainMetric.appendChild(indicatorEl);
            }

            const dividerContainer = document.createElement('span');
            dividerContainer.className = 'metric-divider-container';
            para.appendChild(dividerContainer);
        }

        let container = para.querySelector('.metric-divider-container');
        if (!container) {
            container = document.createElement('span');
            container.className = 'metric-divider-container';
            para.appendChild(container);
        }

        let formatted;
        const needsData = varianceValue === null || varianceValue === undefined;
        if (needsData) {
            formatted = 'Loading...';
        } else {
            formatted = (varianceValue >= 0 ? '+' : '') +
                numberWithCommas(Math.round(varianceValue)) + ' SATS';
        }

        const existing = document.getElementById(varianceId);
        if (existing) {
            existing.textContent = formatted;
            if (needsData) {
                existing.setAttribute('title', 'Variance requires about 3 hours of data');
            } else {
                existing.removeAttribute('title');
            }
        } else {
            const div = createDivider(varianceId, formatted, '[3hr \u0394]');
            container.appendChild(div);
            const valueSpan = div.querySelector('#' + varianceId);
            if (needsData) {
                valueSpan.setAttribute('title', 'Variance requires about 3 hours of data');
            }
        }
    }

    if (!latestMetrics) {
        console.warn("No metrics data available");
        return;
    }

    try {
        const data = latestMetrics;

        // Get currency and exchange rate information
        const currency = data.currency || 'USD';
        const exchangeRate = data.exchange_rates && data.exchange_rates[currency] ?
            data.exchange_rates[currency] : 1.0;

        // Update only the currency earnings header, not SATOSHI EARNINGS
        function updateDashboardHeaders(currency, powerEstimated) {
            // Find card headers but exclude "SATOSHI EARNINGS"
            const earningsHeaders = document.querySelectorAll('.card-header');
            earningsHeaders.forEach(header => {
                // Check if it's a currency header (contains EARNINGS but isn't SATOSHI EARNINGS)
                if (header.textContent.includes('EARNINGS') &&
                    !header.textContent.includes('SATOSHI EARNINGS')) {
                    header.textContent = `${powerEstimated ? 'Est. ' : ''}${currency} EARNINGS`;
                }
            });
        }

        // Call this inside the updateUI function where currency is processed
        updateDashboardHeaders(currency, data.power_usage_estimated);

        // If this is the initial load, force a reset of all arrows
        if (initialLoad) {
            arrowIndicator.forceApplyArrows();
            initialLoad = false;
        }

        // Format each hashrate with proper normalization
        // Pool Hashrate
        let formattedPoolHashrate = "N/A";
        if (data.pool_total_hashrate != null) {
            formattedPoolHashrate = formatHashrateForDisplay(
                data.pool_total_hashrate,
                data.pool_total_hashrate_unit || 'th/s'
            );
        }
        updateElementText("pool_total_hashrate", formattedPoolHashrate);

        // Add pool luck calculation right after pool_total_hashrate
        if (data.daily_mined_sats && data.estimated_earnings_per_day_sats) {
            const poolLuck = calculatePoolLuck(
                parseFloat(data.daily_mined_sats),
                parseFloat(data.estimated_earnings_per_day_sats)
            );

            // Add pool_luck to the metrics data for arrow indicators
            if (poolLuck !== null) {
                data.pool_luck = poolLuck;
            }

            const poolLuckValue = poolLuck !== null ? formatLuckPercentage(poolLuck) : "N/A";

            // Get the pool_total_hashrate element's parent paragraph
            const poolHashratePara = document.getElementById("pool_total_hashrate").parentNode;

            // Ensure grid layout and structure
            ensureElementStyles();

            // Structure parent for proper grid layout (similar to the other metrics)
            if (!poolHashratePara.querySelector('.main-metric')) {
                const poolHashrate = document.getElementById("pool_total_hashrate");
                const indicatorPoolHashrate = document.getElementById("indicator_pool_total_hashrate");

                // Create the main metric container
                const mainMetric = document.createElement("span");
                mainMetric.className = "main-metric";

                // Move the metric and its indicator inside the container
                if (poolHashrate && indicatorPoolHashrate) {
                    // Clear any existing text nodes between the elements
                    let node = poolHashrate.nextSibling;
                    while (node && node !== indicatorPoolHashrate) {
                        const nextNode = node.nextSibling;
                        if (node.nodeType === 3) { // Text node
                            poolHashratePara.removeChild(node);
                        }
                        node = nextNode;
                    }

                    poolHashrate.parentNode.insertBefore(mainMetric, poolHashrate);
                    mainMetric.appendChild(poolHashrate);
                    mainMetric.appendChild(indicatorPoolHashrate);
                }

                // Create divider container for pool hashrate row
                const dividerContainer = document.createElement("span");
                dividerContainer.className = "metric-divider-container";
                poolHashratePara.appendChild(dividerContainer);
            }

            // Get or create the divider container
            let poolDividerContainer = poolHashratePara.querySelector('.metric-divider-container');
            if (!poolDividerContainer) {
                poolDividerContainer = document.createElement("span");
                poolDividerContainer.className = "metric-divider-container";
                poolHashratePara.appendChild(poolDividerContainer);
            }

            // Check if the "pool_luck" element already exists
            const existingLuck = document.getElementById("pool_luck");
            if (existingLuck) {
                // Update existing element
                existingLuck.textContent = poolLuckValue;

                // Apply appropriate color class based on luck value
                existingLuck.className = "metric-value metric-divider-value";
                if (poolLuck !== null) {
                    if (poolLuck > 110) {
                        existingLuck.classList.add("very-lucky");
                    } else if (poolLuck > 100) {
                        existingLuck.classList.add("lucky");
                    } else if (poolLuck >= 90) {
                        existingLuck.classList.add("normal-luck");
                    } else {
                        existingLuck.classList.add("unlucky");
                    }
                }
            } else {
                // Create the divider if it doesn't exist
                const poolLuckDiv = createDivider("pool_luck", poolLuckValue, "Earning Efficiency");

                // Apply appropriate color class
                const valueSpan = poolLuckDiv.querySelector('#pool_luck');
                if (valueSpan && poolLuck !== null) {
                    if (poolLuck > 110) {
                        valueSpan.classList.add("very-lucky");
                    } else if (poolLuck > 100) {
                        valueSpan.classList.add("lucky");
                    } else if (poolLuck >= 90) {
                        valueSpan.classList.add("normal-luck");
                    } else {
                        valueSpan.classList.add("unlucky");
                    }
                }

                // Add to divider container
                poolDividerContainer.appendChild(poolLuckDiv);
            }
        }

        // Update pool fees in SATS (as negative value)
        if (data.pool_fees_percentage !== undefined && data.last_block_earnings !== undefined) {
            // Parse the last_block_earnings (removing any "+" prefix if present)
            const lastBlockEarnings = parseFloat(data.last_block_earnings.toString().replace(/^\+/, ''));
            const poolFeeSats = calculatePoolFeeInSats(
                parseFloat(data.pool_fees_percentage),
                lastBlockEarnings
            );

            // Find the pool_fees_percentage element
            const poolFeesPercentage = document.getElementById("pool_fees_percentage");

            if (poolFeesPercentage) {
                // Format the pool fee in SATS with commas
                const formattedPoolFee = poolFeeSats !== null ?
                    numberWithCommas(poolFeeSats) + " SATS" : "N/A";

                // Check if pool_fees_sats span already exists
                let poolFeesSats = document.getElementById("pool_fees_sats");

                if (!poolFeesSats) {
                    // Create a new span for the fees in SATS if it doesn't exist
                    poolFeesSats = document.createElement("span");
                    poolFeesSats.id = "pool_fees_sats";
                    poolFeesSats.className = "metric-value";

                    // Insert immediately after the pool_fees_percentage element
                    poolFeesPercentage.insertAdjacentElement('afterend', poolFeesSats);
                }

                // Update the text and styling
                poolFeesSats.textContent = " (" + formattedPoolFee + ")";
                poolFeesSats.setAttribute("style", "color: #ff5555 !important; font-weight: bold !important; margin-left: 6px;");
            }
        }

        // 24hr Hashrate
        let formatted24hrHashrate = "N/A";
        if (data.hashrate_24hr != null) {
            formatted24hrHashrate = formatHashrateForDisplay(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_24hr", formatted24hrHashrate);

        // Update the block time section with consistent addition logic
        let blockTime = "N/A"; // Default value
        if (data.hashrate_24hr != null && data.network_hashrate != null) {
            blockTime = calculateBlockTime(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s',
                data.network_hashrate
            );
        }

        // Find the hashrate_24hr element's parent paragraph
        const hashrate24hrPara = document.getElementById("hashrate_24hr").parentNode;

        // Structure parent for proper grid layout
        if (!hashrate24hrPara.querySelector('.main-metric')) {
            const hashrate24hr = document.getElementById("hashrate_24hr");
            const indicator24hr = document.getElementById("indicator_hashrate_24hr");

            // Create the main metric container
            const mainMetric = document.createElement("span");
            mainMetric.className = "main-metric";

            // Move the metric and its indicator inside the container
            if (hashrate24hr && indicator24hr) {
                // Clear any existing text nodes between the elements
                let node = hashrate24hr.nextSibling;
                while (node && node !== indicator24hr) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) { // Text node
                        hashrate24hrPara.removeChild(node);
                    }
                    node = nextNode;
                }

                hashrate24hr.parentNode.insertBefore(mainMetric, hashrate24hr);
                mainMetric.appendChild(hashrate24hr);
                mainMetric.appendChild(indicator24hr);
            }

            // Create divider container
            const dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate24hrPara.appendChild(dividerContainer);
        }

        // Get or create the divider container
        let dividerContainer = hashrate24hrPara.querySelector('.metric-divider-container');
        if (!dividerContainer) {
            dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate24hrPara.appendChild(dividerContainer);
        }

        // Check if the "block_time" element already exists
        const existingBlockTime = document.getElementById("block_time");
        if (existingBlockTime) {
            // Find the containing metric-divider
            let dividerElement = existingBlockTime.closest('.metric-divider');
            if (dividerElement) {
                // Just update the text
                existingBlockTime.textContent = blockTime;
            } else {
                // If structure is broken, recreate it
                const blockTimeDiv = createDivider("block_time", blockTime, "[Time to ₿]");
                dividerContainer.innerHTML = ''; // Clear container
                dividerContainer.appendChild(blockTimeDiv);
            }
        } else {
            // Create the "Time to ₿" divider
            const blockTimeDiv = createDivider("block_time", blockTime, "[Time to ₿]");
            dividerContainer.appendChild(blockTimeDiv);
        }

        // 3hr Hashrate
        let formatted3hrHashrate = "N/A";
        if (data.hashrate_3hr != null) {
            formatted3hrHashrate = formatHashrateForDisplay(
                data.hashrate_3hr,
                data.hashrate_3hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_3hr", formatted3hrHashrate);

        // Same for 3hr data with blockOdds
        const hashrate3hrPara = document.getElementById("hashrate_3hr").parentNode;

        // Structure parent for proper grid layout
        if (!hashrate3hrPara.querySelector('.main-metric')) {
            const hashrate3hr = document.getElementById("hashrate_3hr");
            const indicator3hr = document.getElementById("indicator_hashrate_3hr");

            // Create the main metric container
            const mainMetric = document.createElement("span");
            mainMetric.className = "main-metric";

            // Move the metric and its indicator inside the container
            if (hashrate3hr && indicator3hr) {
                // Clear any existing text nodes between the elements
                let node = hashrate3hr.nextSibling;
                while (node && node !== indicator3hr) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) { // Text node
                        hashrate3hrPara.removeChild(node);
                    }
                    node = nextNode;
                }

                hashrate3hr.parentNode.insertBefore(mainMetric, hashrate3hr);
                mainMetric.appendChild(hashrate3hr);
                mainMetric.appendChild(indicator3hr);
            }

            // Create divider container
            const dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate3hrPara.appendChild(dividerContainer);
        }

        // Get or create the divider container
        let odds3hrContainer = hashrate3hrPara.querySelector('.metric-divider-container');
        if (!odds3hrContainer) {
            odds3hrContainer = document.createElement("span");
            odds3hrContainer.className = "metric-divider-container";
            hashrate3hrPara.appendChild(odds3hrContainer);
        }

        // Apply the same consistent approach for the block odds section
        if (data.hashrate_24hr != null && data.network_hashrate != null) {
            const blockProbability = calculateBlockProbability(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s',
                data.network_hashrate
            );

            // Update the element if it already exists
            const existingProbability = document.getElementById("block_odds_3hr");
            if (existingProbability) {
                existingProbability.textContent = blockProbability;
            } else {
                // For block odds after 3hr hashrate
                const blockOddsDiv = createDivider("block_odds_3hr", blockProbability, "[₿ Odds]");
                odds3hrContainer.appendChild(blockOddsDiv);
            }
        }

        // 10min Hashrate
        let formatted10minHashrate = "N/A";
        if (data.hashrate_10min != null) {
            formatted10minHashrate = formatHashrateForDisplay(
                data.hashrate_10min,
                data.hashrate_10min_unit || 'th/s'
            );
        }
        updateElementText("hashrate_10min", formatted10minHashrate);

        // 60sec Hashrate
        let formatted60secHashrate = "N/A";
        if (data.hashrate_60sec != null) {
            formatted60secHashrate = formatHashrateForDisplay(
                data.hashrate_60sec,
                data.hashrate_60sec_unit || 'th/s'
            );
        }
        updateElementText("hashrate_60sec", formatted60secHashrate);

        // Update other non-hashrate metrics
        updateElementText("block_number", numberWithCommas(data.block_number));

        // Update BTC price with currency conversion and symbol
        if (data.btc_price != null) {
            const btcPriceValue = data.btc_price;
            const symbol = getCurrencySymbol(currency);

            updateElementText("btc_price", formatCurrencyValue(btcPriceValue, currency));
        } else {
            updateElementText("btc_price", formatCurrencyValue(0, currency));
        }

        // Update last block earnings
        if (data.last_block_earnings !== undefined) {
            // Format with "+" prefix and "SATS" suffix
            updateElementText("last_block_earnings",
                "+" + numberWithCommas(data.last_block_earnings) + " SATS");
        }

        // Network hashrate (already in EH/s but verify)
        // Improved version with ZH/s support:
        if (data.network_hashrate >= 1000) {
            // Convert to Zettahash if over 1000 EH/s
            updateElementText("network_hashrate",
                (data.network_hashrate / 1000).toFixed(2) + " ZH/s");
        } else {
            // Use regular EH/s formatting
            updateElementText("network_hashrate",
                numberWithCommas(Math.round(data.network_hashrate)) + " EH/s");
        }
        updateElementText("difficulty", numberWithCommas(Math.round(data.difficulty)));

        // Daily revenue with currency conversion
        if (data.daily_revenue != null) {
            const dailyRevenue = data.daily_revenue;
            updateElementText("daily_revenue", formatCurrencyValue(dailyRevenue, currency));
        } else {
            updateElementText("daily_revenue", formatCurrencyValue(0, currency));
        }

        // Daily power cost with currency conversion
        if (data.daily_power_cost != null) {
            const dailyPowerCost = data.daily_power_cost;
            updateElementText("daily_power_cost", formatCurrencyValue(dailyPowerCost, currency));
        } else {
            updateElementText("daily_power_cost", formatCurrencyValue(0, currency));
        }

        // Daily profit with currency conversion and color
        if (data.daily_profit_usd != null) {
            const dailyProfit = data.daily_profit_usd;
            const dailyProfitElement = document.getElementById("daily_profit_usd");
            if (dailyProfitElement) {
                dailyProfitElement.textContent = formatCurrencyValue(dailyProfit, currency);
                if (dailyProfit < 0) {
                    // Use setAttribute to properly set the style with !important
                    dailyProfitElement.setAttribute("style", "color: #ff5555 !important; font-weight: bold !important;");
                } else {
                    // Clear the style attribute completely
                    dailyProfitElement.removeAttribute("style");
                }
            }
        }

        // Monthly profit with currency conversion and color
        if (data.monthly_profit_usd != null) {
            const monthlyProfit = data.monthly_profit_usd;
            const monthlyProfitElement = document.getElementById("monthly_profit_usd");
            if (monthlyProfitElement) {
                monthlyProfitElement.textContent = formatCurrencyValue(monthlyProfit, currency);
                if (monthlyProfit < 0) {
                    // Use setAttribute to properly set the style with !important
                    monthlyProfitElement.setAttribute("style", "color: #ff5555 !important; font-weight: bold !important;");
                } else {
                    // Clear the style attribute completely
                    monthlyProfitElement.removeAttribute("style");
                }
            }
        }

        updateElementText("daily_mined_sats", numberWithCommas(data.daily_mined_sats) + " SATS");
        updateElementText("monthly_mined_sats", numberWithCommas(data.monthly_mined_sats) + " SATS");

        // Update worker count from metrics (just the number, not full worker data)
        updateWorkersCount();

        updateElementText("unpaid_earnings", data.unpaid_earnings.toFixed(8) + " BTC");

        // Update payout estimation with color coding
        const payoutText = data.est_time_to_payout;
        updateElementText("est_time_to_payout", payoutText);

        // Check for "next block" in any case format
        if (payoutText && /next\s+block/i.test(payoutText)) {
            $("#est_time_to_payout").attr("style", "color: #32CD32 !important; animation: pulse 1s infinite !important; text-transform: uppercase !important;");
        } else {
            // Trim any extra whitespace
            const cleanText = payoutText ? payoutText.trim() : "";
            // Update your regex to handle hours-only format as well
            const regex = /(?:(\d+)\s*days?(?:,?\s*(\d+)\s*hours?)?)|(?:(\d+)\s*hours?)/i;
            const match = cleanText.match(regex);

            let totalDays = NaN;
            if (match) {
                if (match[1]) {
                    // Format: "X days" or "X days, Y hours"
                    const days = parseFloat(match[1]);
                    const hours = match[2] ? parseFloat(match[2]) : 0;
                    totalDays = days + (hours / 24);
                } else if (match[3]) {
                    // Format: "X hours"
                    const hours = parseFloat(match[3]);
                    totalDays = hours / 24;
                }
                console.log("Total days computed:", totalDays);  // Debug output
            }

            if (!isNaN(totalDays)) {
                if (totalDays < 4) {
                    $("#est_time_to_payout").attr("style", "color: #32CD32 !important; animation: none !important;");
                } else if (totalDays > 20) {
                    $("#est_time_to_payout").attr("style", "color: #ff5555 !important; animation: none !important;");
                } else {
                    $("#est_time_to_payout").attr("style", "color: #ffd700 !important; animation: none !important;");
                }
            } else {
                $("#est_time_to_payout").attr("style", "color: #ffd700 !important; animation: none !important;");
            }
        }

        updateElementText("last_block_height", data.last_block_height ? numberWithCommas(data.last_block_height) : "N/A");
        updateElementText("last_block_time", data.last_block_time || "");
        updateElementText("blocks_found", data.blocks_found || "0");
        updateElementText("last_share", data.total_last_share || "");

        // Update Estimated Earnings metrics
        updateElementText("estimated_earnings_per_day_sats", numberWithCommas(data.estimated_earnings_per_day_sats) + " SATS");
        updateElementText("estimated_earnings_next_block_sats", numberWithCommas(data.estimated_earnings_next_block_sats) + " SATS");
        updateElementText("estimated_rewards_in_window_sats", numberWithCommas(data.estimated_rewards_in_window_sats) + " SATS");

        // Add 3hr variance dividers for estimated earnings metrics
        if (data.estimated_earnings_per_day_sats_variance_3hr !== undefined) {
            updateVarianceDivider(
                "estimated_earnings_per_day_sats",
                "variance_earnings_day",
                data.estimated_earnings_per_day_sats_variance_3hr
            );
        }
        if (data.estimated_earnings_next_block_sats_variance_3hr !== undefined) {
            updateVarianceDivider(
                "estimated_earnings_next_block_sats",
                "variance_earnings_block",
                data.estimated_earnings_next_block_sats_variance_3hr
            );
        }
        if (data.estimated_rewards_in_window_sats_variance_3hr !== undefined) {
            updateVarianceDivider(
                "estimated_rewards_in_window_sats",
                "variance_rewards_window",
                data.estimated_rewards_in_window_sats_variance_3hr
            );
        }

        // Update last updated timestamp
        try {
            // Get the configured timezone with fallback
            const configuredTimezone = window.dashboardTimezone || 'America/Los_Angeles';

            // Use server timestamp from metrics if available, otherwise use adjusted local time
            const timestampToUse = latestMetrics && latestMetrics.server_timestamp ?
                new Date(latestMetrics.server_timestamp) :
                new Date(Date.now() + (serverTimeOffset || 0));

            // Format with explicit timezone
            const options = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: configuredTimezone // Explicitly set timezone
            };

            // Update the lastUpdated element
            updateElementHTML("lastUpdated",
                "<strong>Last Updated:</strong> " +
                timestampToUse.toLocaleString('en-US', options) +
                "<span id='terminal-cursor'></span>");

            console.log(`Last updated timestamp shown using timezone: ${configuredTimezone}`);
        } catch (error) {
            console.error("Error formatting last updated timestamp:", error);
            // Fallback to basic timestamp if there's an error
            const now = new Date();
            updateElementHTML("lastUpdated",
                "<strong>Last Updated:</strong> " +
                now.toLocaleString() +
                "<span id='terminal-cursor'></span>");
        }

        // Update chart with normalized data if it exists
        if (trendChart) {
            // Use the enhanced chart update function with normalization
            updateChartWithNormalizedData(trendChart, data);
        }

        // Update indicators and check for block updates
        updateIndicators(data);
        checkForBlockUpdates(data);

        // Add this call before storing current metrics as previous metrics
        trackPayoutPerformance(data);

        // Store current metrics for next comparison
        previousMetrics = { ...data };

    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

// Update unread notifications badge in navigation with animation effects
function updateNotificationBadge() {
    $.ajax({
        url: "/api/notifications/unread_count",
        method: "GET",
        success: function (data) {
            const unreadCount = data.unread_count;
            const badge = $("#nav-unread-badge");

            // Store the previous count to detect increases
            const previousCount = badge.text() ? parseInt(badge.text()) : 0;

            if (unreadCount > 0) {
                badge.text(unreadCount);
                badge.addClass('has-unread');

                // Add animation when count increases
                if (unreadCount > previousCount) {
                    // Remove animation if it's already applied
                    badge.removeClass('badge-pulse');

                    // Force DOM reflow to restart animation
                    void badge[0].offsetWidth;

                    // Apply animation
                    badge.addClass('badge-pulse');
                }
            } else {
                badge.text('');
                badge.removeClass('has-unread badge-pulse');
            }
        },
        error: function (xhr, status, error) {
            console.error("Error fetching notification count:", error);
        }
    });
}

// Update unread notifications badge in navigation
function updateNotificationBadge() {
    $.ajax({
        url: "/api/notifications/unread_count",
        method: "GET",
        success: function (data) {
            const unreadCount = data.unread_count;
            const badge = $("#nav-unread-badge");

            if (unreadCount > 0) {
                badge.text(unreadCount).show();
            } else {
                badge.hide();
            }
        }
    });
}

// Initialize notification badge checking
function initNotificationBadge() {
    // Update immediately
    updateNotificationBadge();

    // Update every 60 seconds
    setInterval(updateNotificationBadge, 60000);
}

// Add keyboard event listener for Alt+W to reset wallet address
$(document).keydown(function (event) {
    // Check if Alt+W is pressed (key code 87 is 'W')
    if (event.altKey && event.keyCode === 87) {
        resetWalletAddress();

        // Prevent default browser behavior
        event.preventDefault();
    }
});

// Function to reset wallet address in configuration and clear chart data
function resetWalletAddress() {
    if (confirm("Are you sure you want to reset your wallet address? This will also clear all chart data and redirect you to the configuration page.")) {
        // First clear chart data using the existing API endpoint
        $.ajax({
            url: '/api/reset-chart-data',
            method: 'POST',
            success: function () {
                console.log("Chart data reset successfully");

                // Then reset the chart display locally
                if (trendChart) {
                    trendChart.data.labels = [];
                    trendChart.data.datasets[0].data = [];
                    trendChart.update('none');
                }

                // Clear payout history data from localStorage
                try {
                    localStorage.removeItem('payoutHistory');
                    lastPayoutTracking.payoutHistory = [];
                    console.log("Payout history cleared for wallet change");
                    fetch('/api/payout-history', { method: 'DELETE' });

                    // Remove any visible payout comparison elements
                    $("#payout-comparison").remove();
                    $("#payout-history-container").empty().hide();
                } catch (e) {
                    console.error("Error clearing payout history:", e);
                }

                // Then reset wallet address
                fetch('/api/config')
                    .then(response => response.json())
                    .then(config => {
                        // Reset the wallet address to default
                        config.wallet = "yourwallethere";
                        // Add special flag to indicate config reset
                        config.config_reset = true;

                        // Save the updated configuration
                        return fetch('/api/config', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(config)
                        });
                    })
                    .then(response => response.json())
                    .then(data => {
                        console.log("Wallet address reset successfully:", data);
                        // Also clear arrow indicator states
                        arrowIndicator.clearAll();
                        // Redirect to the boot page for reconfiguration
                        window.location.href = window.location.origin + "/";
                    })
                    .catch(error => {
                        console.error("Error resetting wallet address:", error);
                        alert("There was an error resetting your wallet address. Please try again.");
                    });
            },
            error: function (xhr, status, error) {
                console.error("Error clearing chart data:", error);
                // Continue with wallet reset even if chart reset fails
                resetWalletAddressOnly();
            }
        });
    }
}

// Fallback function if chart reset fails - also updated to clear payout history
function resetWalletAddressOnly() {
    // Clear payout history data from localStorage
    try {
        localStorage.removeItem('payoutHistory');
        lastPayoutTracking.payoutHistory = [];
        console.log("Payout history cleared for wallet change");
        fetch('/api/payout-history', { method: 'DELETE' });

        // Remove any visible payout comparison elements
        $("#payout-comparison").remove();
        $("#payout-history-container").empty().hide();
    } catch (e) {
        console.error("Error clearing payout history:", e);
    }

    fetch('/api/config')
        .then(response => response.json())
        .then(config => {
            config.wallet = "yourwallethere";
            return fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config)
            });
        })
        .then(response => response.json())
        .then(data => {
            console.log("Wallet address reset successfully (without chart reset):", data);
            window.location.href = window.location.origin + "/";
        })
        .catch(error => {
            console.error("Error resetting wallet address:", error);
            alert("There was an error resetting your wallet address. Please try again.");
        });
}

// Function to show a helpful notification to the user about hashrate normalization
function showHashrateNormalizeNotice() {
    // Only show if the notification doesn't already exist on the page
    if ($("#hashrateNormalizeNotice").length === 0) {
        const theme = getCurrentTheme();

        // Create notification element with theme-appropriate styling
        const notice = $(`
            <div id="hashrateNormalizeNotice" style="
                position: fixed;
                bottom: 30px;
                right: 30px;
                background-color: rgba(0, 0, 0, 0.85);
                color: ${theme.PRIMARY};
                border: 1px solid ${theme.PRIMARY};
                padding: 15px 20px;
                z-index: 9999;
                max-width: 300px;
                font-family: 'VT323', monospace;
                font-size: 16px;
                box-shadow: 0 0 15px rgba(0, 0, 0, 0.5);
            ">
                <div style="display: flex; align-items: flex-start;">
                    <div style="margin-right: 10px;">
                        <i class="fas fa-chart-line" style="font-size: 22px;"></i>
                    </div>
                    <div>
                        <div style="font-weight: bold; margin-bottom: 5px; text-transform: uppercase;">Hashrate Chart Notice</div>
                        <div>Please wait 2-3 minutes for the chart to collect data and normalize for your hashrate pattern.</div>
                    </div>
                </div>
                <div style="text-align: right; margin-top: 10px;">
                    <button id="hashrateNoticeClose" style="
                        background: none; 
                        border: none; 
                        color: ${theme.PRIMARY}; 
                        cursor: pointer;
                        font-family: inherit;
                        text-decoration: underline;
                    ">Dismiss</button>
                    <label style="margin-left: 10px;">
                        <input type="checkbox" id="dontShowAgain" style="vertical-align: middle;"> 
                        <span style="font-size: 0.8em; vertical-align: middle;">Don't show again</span>
                    </label>
                </div>
            </div>
        `);

        // Add to body and handle close button
        $("body").append(notice);

        // Handler for the close button
        $("#hashrateNoticeClose").on("click", function () {
            // Check if "Don't show again" is checked
            if ($("#dontShowAgain").is(":checked")) {
                // Remember permanently in localStorage
                localStorage.setItem('hideHashrateNotice', 'true');
                console.log("User chose to permanently hide hashrate notice");
            } else {
                // Only remember for this session
                sessionStorage.setItem('hideHashrateNoticeSession', 'true');
                console.log("User dismissed hashrate notice for this session");
            }

            // Hide and remove the notice
            $("#hashrateNormalizeNotice").fadeOut(300, function () {
                $(this).remove();
            });
        });

        // Auto-hide after 60 seconds
        setTimeout(function () {
            if ($("#hashrateNormalizeNotice").length) {
                $("#hashrateNormalizeNotice").fadeOut(500, function () {
                    $(this).remove();
                });
            }
        }, 60000); // Changed to 60 seconds for better visibility
    }
}

// Helper function to check if we should show the notice (call this during page initialization)
function checkAndShowHashrateNotice() {
    // Check if user has permanently hidden the notice
    const permanentlyHidden = localStorage.getItem('hideHashrateNotice') === 'true';

    // Check if user has hidden the notice for this session
    const sessionHidden = sessionStorage.getItem('hideHashrateNoticeSession') === 'true';

    // Also check low hashrate mode state (to potentially show a different message)
    const inLowHashrateMode = localStorage.getItem('lowHashrateState') ?
        JSON.parse(localStorage.getItem('lowHashrateState')).isLowHashrateMode : false;

    if (!permanentlyHidden && !sessionHidden) {
        // Show the notice with a short delay to ensure the page is fully loaded
        setTimeout(function () {
            showHashrateNormalizeNotice();
        }, 2000);
    } else {
        console.log("Hashrate notice will not be shown: permanently hidden = " +
            permanentlyHidden + ", session hidden = " + sessionHidden);
    }
}

// Currency conversion functions
function getCurrencySymbol(currency) {
    const symbols = {
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'JPY': '¥',
        'CAD': 'CA$',
        'AUD': 'A$',
        'CNY': '¥',
        'KRW': '₩',
        'BRL': 'R$',
        'CHF': 'Fr'
    };
    return symbols[currency] || '$';
}

function formatCurrencyValue(value, currency) {
    if (value == null || isNaN(value)) return "N/A";

    const symbol = getCurrencySymbol(currency);

    // For JPY and KRW, show without decimal places
    if (currency === 'JPY' || currency === 'KRW') {
        return `${symbol}${numberWithCommas(Math.round(value))}`;
    }

    return `${symbol}${numberWithCommas(value.toFixed(2))}`;
}

// Update the BTC price and earnings card header with the selected currency
function updateCurrencyLabels(currency, powerEstimated) {
    const earningsHeader = document.querySelector('.card-header:contains("USD EARNINGS")');
    if (earningsHeader) {
        earningsHeader.textContent = `${powerEstimated ? 'Est. ' : ''}${currency} EARNINGS`;
    }
}

$(document).ready(function () {
    // Apply theme based on stored preference - moved to beginning for better initialization
    try {
        const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        if (useDeepSea) {
            applyDeepSeaTheme();
        }
        // Setup theme change listener
        setupThemeChangeListener();
        loadBlockAnnotations();
    } catch (e) {
        console.error("Error handling theme:", e);
    }

    // Initialize chart points preference from localStorage
    try {
        const storedPreference = localStorage.getItem('chartPointsPreference');
        if (storedPreference) {
            const points = parseInt(storedPreference, 10);
            if ([30, 60, 180].includes(points)) {
                chartPoints = points;
            }
        }
    } catch (e) {
        console.error("Error loading chart points preference", e);
    }
    updateChartPointsButtons();

    // Modify the initializeChart function to use blue colors for the chart
    function initializeChart() {
        try {
            const ctx = document.getElementById('trendGraph').getContext('2d');
            if (!ctx) {
                console.error("Could not find trend graph canvas");
                return null;
            }

            if (!window.Chart) {
                console.error("Chart.js not loaded");
                return null;
            }

            // Get the current theme colors
            const theme = getCurrentTheme();

            // Check if annotation plugin is available
            const hasAnnotationPlugin = window.simpleAnnotationPlugin !== undefined;

            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'HASHRATE TREND (TH/s)',
                        data: [],
                        borderWidth: 2,
                        borderColor: function (context) {
                            const chart = context.chart;
                            const { ctx, chartArea } = chart;
                            if (!chartArea) {
                                return theme.PRIMARY;
                            }
                            // Create gradient for line
                            const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                            gradient.addColorStop(0, theme.CHART.GRADIENT_START);
                            gradient.addColorStop(1, theme.CHART.GRADIENT_END);
                            return gradient;
                        },
                        backgroundColor: function (context) {
                            const chart = context.chart;
                            const { ctx, chartArea } = chart;
                            if (!chartArea) {
                                return `rgba(${theme.PRIMARY_RGB}, 0.1)`;
                            }
                            // Create gradient for fill
                            const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                            gradient.addColorStop(0, `rgba(${theme.PRIMARY_RGB}, 0.3)`);
                            gradient.addColorStop(0.5, `rgba(${theme.PRIMARY_RGB}, 0.2)`);
                            gradient.addColorStop(1, `rgba(${theme.PRIMARY_RGB}, 0.05)`);
                            return gradient;
                        },
                        fill: true,
                        tension: 0.3,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 0 // Disable animations for better performance
                    },
                    scales: {
                        x: {
                            display: true,
                            ticks: {
                                maxTicksLimit: 8, // Limit number of x-axis labels
                                maxRotation: 0,   // Don't rotate labels
                                autoSkip: true,   // Automatically skip some labels
                                color: '#FFFFFF',
                                font: {
                                    family: "'VT323', monospace", // Terminal font
                                    size: 14
                                }
                            },
                            grid: {
                                color: '#333333',
                                lineWidth: 0.5
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'HASHRATE (TH/S)',
                                color: theme.PRIMARY,
                                font: {
                                    family: "'VT323', monospace",
                                    size: 16,
                                    weight: 'bold'
                                }
                            },
                            ticks: {
                                color: '#FFFFFF',
                                maxTicksLimit: 6, // Limit total number of ticks
                                precision: 1,     // Control decimal precision
                                autoSkip: true,   // Skip labels to prevent overcrowding
                                autoSkipPadding: 10, // Padding between skipped labels
                                font: {
                                    family: "'VT323', monospace", // Terminal font
                                    size: 14
                                },
                                callback: function (value) {
                                    // For zero, just return 0
                                    if (value === 0) return '0';

                                    // For very large values (1M+ TH/s = 1000+ PH/s)
                                    if (value >= 1000000) {
                                        return (value / 1000000).toFixed(1) + 'E'; // Show as EH/s
                                    }
                                    // For large values (1000+ TH/s), show in PH/s
                                    else if (value >= 1000) {
                                        return (value / 1000).toFixed(1) + 'P'; // Show as PH/s
                                    }
                                    // For values between 10 and 1000 TH/s
                                    else if (value >= 10) {
                                        return Math.round(value);
                                    }
                                    // For small values, limit decimal places
                                    else if (value >= 1) {
                                        return value.toFixed(1);
                                    }
                                    // For tiny values, use appropriate precision
                                    else {
                                        return value.toPrecision(2);
                                    }
                                }
                            },
                            grid: {
                                color: '#333333',
                                lineWidth: 0.5,
                                drawBorder: false,
                                zeroLineColor: '#555555',
                                zeroLineWidth: 1,
                                drawTicks: false
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: theme.PRIMARY,
                            bodyColor: '#FFFFFF',
                            titleFont: {
                                family: "'VT323', monospace",
                                size: 16,
                                weight: 'bold'
                            },
                            bodyFont: {
                                family: "'VT323', monospace",
                                size: 14
                            },
                            padding: 10,
                            cornerRadius: 0,
                            displayColors: false,
                            callbacks: {
                                title: function (tooltipItems) {
                                    return tooltipItems[0].label.toUpperCase();
                                },
                                label: function (context) {
                                    // Format tooltip values with appropriate unit
                                    const value = context.raw;
                                    return 'HASHRATE: ' + formatHashrateForDisplay(value).toUpperCase();
                                }
                            }
                        },
                        legend: { display: false },
                        annotation: hasAnnotationPlugin ? {
                            annotations: {
                                averageLine: {
                                    type: 'line',
                                    yMin: 0,
                                    yMax: 0,
                                    borderColor: theme.CHART.ANNOTATION,
                                    borderWidth: 3,
                                    borderDash: [8, 4],
                                    shadowColor: `rgba(${theme.PRIMARY_RGB}, 0.5)`,
                                    shadowBlur: 8,
                                    shadowOffsetX: 0,
                                    shadowOffsetY: 0,
                                    label: {
                                        enabled: true,
                                        content: '24HR AVG: 0 TH/S',
                                        backgroundColor: 'rgba(0,0,0,0.8)',
                                        color: theme.CHART.ANNOTATION,
                                        font: {
                                            family: "'VT323', monospace",
                                            size: 16,
                                            weight: 'bold'
                                        },
                                        padding: { top: 4, bottom: 4, left: 8, right: 8 },
                                        borderRadius: 0,
                                        position: 'start'
                                    }
                                }
                            }
                        } : {}
                    }
                }
            });
            updateBlockAnnotations(chart);
            return chart;
        } catch (error) {
            console.error("Error initializing chart:", error);
            return null;
        }
    }

    // Add this function to the document ready section
    function setupThemeChangeListener() {
        window.addEventListener('storage', function (event) {
            if (event.key === 'useDeepSeaTheme') {
                if (trendChart) {
                    // Save all font configurations
                    const fontConfig = {
                        xTicks: { ...trendChart.options.scales.x.ticks.font },
                        yTicks: { ...trendChart.options.scales.y.ticks.font },
                        yTitle: { ...trendChart.options.scales.y.title.font },
                        tooltip: {
                            title: { ...trendChart.options.plugins.tooltip.titleFont },
                            body: { ...trendChart.options.plugins.tooltip.bodyFont }
                        }
                    };

                    // No need to create a copy of lowHashrateState here, 
                    // as we'll load it from localStorage after chart recreation

                    // Save the low hashrate indicator element if it exists
                    const wasInLowHashrateMode = trendChart.lowHashrateState &&
                        trendChart.lowHashrateState.isLowHashrateMode;

                    // Check if we're on mobile (viewport width < 768px)
                    const isMobile = window.innerWidth < 768;

                    // Store the original sizes before destroying chart
                    const xTicksFontSize = fontConfig.xTicks.size || 14;
                    const yTicksFontSize = fontConfig.yTicks.size || 14;
                    const yTitleFontSize = fontConfig.yTitle.size || 16;

                    // Recreate the chart with new theme colors
                    trendChart.destroy();
                    trendChart = initializeChart();

                    // The state will be automatically loaded from localStorage in updateChartWithNormalizedData

                    // Ensure font sizes are explicitly set to original values
                    // This is especially important for mobile
                    if (isMobile) {
                        // On mobile, set explicit font sizes (based on the originals)
                        trendChart.options.scales.x.ticks.font = {
                            ...fontConfig.xTicks,
                            size: xTicksFontSize
                        };

                        trendChart.options.scales.y.ticks.font = {
                            ...fontConfig.yTicks,
                            size: yTicksFontSize
                        };

                        trendChart.options.scales.y.title.font = {
                            ...fontConfig.yTitle,
                            size: yTitleFontSize
                        };

                        // Also set tooltip font sizes explicitly
                        trendChart.options.plugins.tooltip.titleFont = {
                            ...fontConfig.tooltip.title,
                            size: fontConfig.tooltip.title.size || 16
                        };

                        trendChart.options.plugins.tooltip.bodyFont = {
                            ...fontConfig.tooltip.body,
                            size: fontConfig.tooltip.body.size || 14
                        };

                        console.log('Mobile device detected: Setting explicit font sizes for chart labels');
                    } else {
                        // On desktop, use the full font config objects as before
                        trendChart.options.scales.x.ticks.font = fontConfig.xTicks;
                        trendChart.options.scales.y.ticks.font = fontConfig.yTicks;
                        trendChart.options.scales.y.title.font = fontConfig.yTitle;
                        trendChart.options.plugins.tooltip.titleFont = fontConfig.tooltip.title;
                        trendChart.options.plugins.tooltip.bodyFont = fontConfig.tooltip.body;
                    }

                    // Update with data and force an immediate chart update
                    updateChartWithNormalizedData(trendChart, latestMetrics);
                    updateBlockAnnotations(trendChart);
                    trendChart.update('none');
                }

                // Update refresh button color
                updateRefreshButtonColor();

                // Trigger custom event
                $(document).trigger('themeChanged');
            }
        });
    }

    setupThemeChangeListener();

    // Remove the existing refreshUptime container to avoid duplicates
    $('#refreshUptime').hide();

    // Create a shared timing object that both systems can reference
    window.sharedTimingData = {
        serverTimeOffset: serverTimeOffset,
        serverStartTime: serverStartTime,
        lastRefreshTime: Date.now()
    };

    // Override the updateServerTime function to update the shared object
    const originalUpdateServerTime = updateServerTime;
    updateServerTime = function () {
        originalUpdateServerTime();

        // Update shared timing data after the original function runs
        setTimeout(function () {
            window.sharedTimingData.serverTimeOffset = serverTimeOffset;
            window.sharedTimingData.serverStartTime = serverStartTime;

            // Make sure BitcoinMinuteRefresh uses the same timing information
            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }
        }, 100);
    };

    // Function to fix the Last Block line in the payout card
    function fixLastBlockLine() {
        // Add the style to fix the Last Block line
        $("<style>")
            .prop("type", "text/css")
            .html(`
      /* Fix for Last Block line to keep all elements on one line */
      .card-body p.last-block-line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
      }
      
      .card-body p.last-block-line > strong {
        flex-shrink: 0;
      }
      
      .card-body p.last-block-line > span,
      .card-body p.last-block-line > #indicator_last_block {
        display: inline-block;
        margin-right: 5px;
      }
    `)
            .appendTo("head");

        // Apply the class to the Last Block line
        $("#payoutMiscCard .card-body p").each(function () {
            const strongElem = $(this).find("strong");
            if (strongElem.length && strongElem.text().includes("Last Block")) {
                $(this).addClass("last-block-line");
            }
        });
    }

    // Call this function
    fixLastBlockLine();

    // Check if we should show the hashrate normalization notice
    checkAndShowHashrateNotice();

    // Also show notice when entering low hashrate mode for the first time in a session
    // Track when we enter low hashrate mode to show specialized notification
    const originalUpdateChartWithNormalizedData = updateChartWithNormalizedData;
    window.updateChartWithNormalizedData = function (chart, data) {
        const wasInLowHashrateMode = chart && chart.lowHashrateState &&
            chart.lowHashrateState.isLowHashrateMode;

        // Call original function
        originalUpdateChartWithNormalizedData(chart, data);

        // Check if we just entered low hashrate mode
        if (chart && chart.lowHashrateState &&
            chart.lowHashrateState.isLowHashrateMode && !wasInLowHashrateMode) {

            console.log("Entered low hashrate mode - showing notification");

            // Show the notice if it hasn't been permanently hidden
            if (localStorage.getItem('hideHashrateNotice') !== 'true' &&
                !$("#hashrateNormalizeNotice").length) {
                showHashrateNormalizeNotice();
            }
        }
    };

    // Initialize payout tracking
    initPayoutTracking();

    // Add this to the setupThemeChangeListener function or document.ready
    $(document).on('themeChanged', function () {
        // Refresh payout history display with new theme
        if ($("#payout-history-container").is(":visible")) {
            displayPayoutSummary();
        }

        // Refresh any visible payout comparison with new theme
        if (lastPayoutTracking.payoutHistory.length > 0) {
            const latest = lastPayoutTracking.payoutHistory[0];
            displayPayoutComparison(latest);
        }
    });

    // Load timezone setting early
    (function loadTimezoneEarly() {
        // First try to get from localStorage for instant access
        try {
            const storedTimezone = localStorage.getItem('dashboardTimezone');
            if (storedTimezone) {
                window.dashboardTimezone = storedTimezone;
                console.log(`Using cached timezone: ${storedTimezone}`);
            }
        } catch (e) {
            console.error("Error reading timezone from localStorage:", e);
        }

        // Then fetch from server to ensure we have the latest setting
        fetch('/api/timezone')
            .then(response => response.json())
            .then(data => {
                if (data && data.timezone) {
                    window.dashboardTimezone = data.timezone;
                    console.log(`Set timezone from server: ${data.timezone}`);

                    // Cache for future use
                    try {
                        localStorage.setItem('dashboardTimezone', data.timezone);
                    } catch (e) {
                        console.error("Error storing timezone in localStorage:", e);
                    }
                }
            })
            .catch(error => {
                console.error("Error fetching timezone:", error);
            });
    })();

    // Floating Oracle tab logic
    function showYouTubeFloatingTab() {
        // Prevent multiple tabs
        if (document.getElementById('youtubeFloatingTab')) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'youtubeFloatingTab';
        overlay.className = 'floating-tab-overlay';

        // Create tab container
        const tab = document.createElement('div');
        tab.className = 'floating-tab';

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'floating-tab-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = function () {
            overlay.remove();
        };

        // Iframe for UTXO Oracle
        const iframe = document.createElement('iframe');
        iframe.width = "560";
        iframe.height = "315";
        iframe.src = "https://utxo.live/oracle/";
        iframe.title = "UTXO Oracle";
        iframe.frameBorder = "0";
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.allowFullscreen = true;

        // Add required permissions explicitly
        iframe.setAttribute('allow', 'autoplay; encrypted-media');

        // Assemble
        tab.appendChild(closeBtn);
        tab.appendChild(iframe);
        overlay.appendChild(tab);
        document.body.appendChild(overlay);
    }

    // Attach click handler
    $(document).on('click', '#btc_price', function () {
        showYouTubeFloatingTab();
    });

    // Override the manualRefresh function to update the shared lastRefreshTime
    const originalManualRefresh = manualRefresh;
    window.manualRefresh = function () {
        // Update the shared timing data
        window.sharedTimingData.lastRefreshTime = Date.now();

        // Call the original function
        originalManualRefresh();

        // Notify BitcoinMinuteRefresh about the refresh
        if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
            BitcoinMinuteRefresh.notifyRefresh();
        }
    };

    // Initialize the chart
    trendChart = initializeChart();

    // Add keyboard event listener for Shift+R
    $(document).keydown(function (event) {
        // Check if Shift+R is pressed (key code 82 is 'R')
        if (event.shiftKey && event.keyCode === 82) {
            resetDashboardChart();

            // Prevent default browser behavior (e.g., reload with Shift+R in some browsers)
            event.preventDefault();
        }
    });

    // Apply any saved arrows to DOM on page load
    arrowIndicator.forceApplyArrows();

    // Initialize BitcoinMinuteRefresh with our refresh function
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);

        // Immediately update it with our current server time information
        if (serverTimeOffset && serverStartTime) {
            BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
        }
    }

    // Update BitcoinProgressBar theme when theme changes
    $(document).on('themeChanged', function () {
        if (typeof BitcoinMinuteRefresh !== 'undefined' &&
            typeof BitcoinMinuteRefresh.updateTheme === 'function') {
            BitcoinMinuteRefresh.updateTheme();
        }
    });

    // Set up event source for SSE
    setupEventSource();

    // Start server time polling
    updateServerTime();
    setInterval(updateServerTime, 30000);

    // Update the manual refresh button color
    $("body").append('<button id="refreshButton" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #0088cc; color: white; border: none; padding: 8px 16px; display: none; cursor: pointer;">Refresh Data</button>');

    $("#refreshButton").on("click", function () {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);
        manualRefresh();
        setTimeout(function () {
            $("#refreshButton").text("Refresh Data");
            $("#refreshButton").prop("disabled", false);
        }, 5000);
    });

    // Force a data refresh when the page loads
    manualRefresh();

    // Add emergency refresh button functionality
    $("#forceRefreshBtn").show().on("click", function () {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);

        $.ajax({
            url: '/api/force-refresh',
            method: 'POST',
            timeout: 15000,
            success: function (data) {
                console.log("Force refresh successful:", data);
                manualRefresh(); // Immediately get the new data
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
            },
            error: function (xhr, status, error) {
                console.error("Force refresh failed:", error);
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
                alert("Refresh failed: " + error);
            }
        });
    });

    // Add stale data detection
    setInterval(function () {
        if (latestMetrics && latestMetrics.server_timestamp) {
            const lastUpdate = new Date(latestMetrics.server_timestamp);
            const timeSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
            if (timeSinceUpdate > 120) { // More than 2 minutes
                showConnectionIssue(`Data stale (${timeSinceUpdate}s old). Use Force Refresh.`);
                $("#forceRefreshBtn").show();
            }
        }
    }, 30000); // Check every 30 seconds

    // Initialize notification badge
    initNotificationBadge();
});
