"use strict";

/**
 * chart-manager.js - Chart.js setup, config, updates, and chart data points control
 */

// Register local annotation plugin if available
if (window.simpleAnnotationPlugin) {
    Chart.register(window.simpleAnnotationPlugin);
}

// ===== Chart Data Points Control =====
let chartPoints = 180; // Default to 180 points, Infinity = all data

function updateChartPointsButtons() {
    document.getElementById('btn-30').classList.toggle('active', chartPoints === 30);
    document.getElementById('btn-60').classList.toggle('active', chartPoints === 60);
    document.getElementById('btn-180').classList.toggle('active', chartPoints === 180);
    document.getElementById('btn-all').classList.toggle('active', chartPoints === Infinity);
}

function setChartPoints(points) {
    if (points === 'all') {
        points = Infinity;
    }
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

// Modify the initializeChart function to use blue colors for the chart
function initializeChart() {
    try {
        const canvas = document.getElementById('trendGraph');
        if (!canvas) {
            console.error("Could not find trend graph canvas");
            return null;
        }
        const ctx = canvas.getContext('2d');

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
                    pointRadius: extendedHistoryEnabled && chartPoints === Infinity ? 0 : 3,
                    pointHoverRadius: extendedHistoryEnabled && chartPoints === Infinity ? 0 : 3,
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
                stableModePeriod: 600000,
                lastSpikeDecayTime: 0
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
                        modeSwitchTimeoutId: null,
                        lastSpikeDecayTime: parsedState.lastSpikeDecayTime || 0
                    };
                    delete chart.lowHashrateState.stableModePeriod;
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
        // Front-end low hashrate mode uses fixed thresholds independent of
        // configuration to avoid accidental interference with notification
        // settings.
        const LOW_HASHRATE_THRESHOLD = 0.01; // TH/s
        const HIGH_HASHRATE_THRESHOLD = 20.0; // TH/s
        const MODE_SWITCH_DELAY = 120000;     // Increase to 2 minutes for more stability
        const CONSECUTIVE_SPIKES_THRESHOLD = 3; // Increase to require more consistent high readings
        const MIN_MODE_STABILITY_TIME = 120000; // 2 minutes minimum between mode switches
        const SPIKE_DECAY_INTERVAL = 30000; // interval before spike counter decreases

        // Gradually decay spike count even across reloads
        if (chart.lowHashrateState.spikeCount > 0) {
            const elapsed = currentTime - chart.lowHashrateState.lastSpikeDecayTime;
            if (elapsed >= SPIKE_DECAY_INTERVAL) {
                const decaySteps = Math.floor(elapsed / SPIKE_DECAY_INTERVAL);
                chart.lowHashrateState.spikeCount = Math.max(
                    0,
                    chart.lowHashrateState.spikeCount - decaySteps
                );
                chart.lowHashrateState.lastSpikeDecayTime += decaySteps * SPIKE_DECAY_INTERVAL;
                saveLowHashrateState(chart.lowHashrateState);
            }
        }

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

                // Increment spike counter and reset decay timer
                chart.lowHashrateState.spikeCount++;
                chart.lowHashrateState.lastSpikeDecayTime = currentTime;
                console.log(`Spike count: ${chart.lowHashrateState.spikeCount}/${CONSECUTIVE_SPIKES_THRESHOLD}`);

                // Check if spikes have persisted long enough
                const spikeElapsedTime = currentTime - chart.lowHashrateState.highHashrateSpikeTime;

                if (chart.lowHashrateState.spikeCount >= CONSECUTIVE_SPIKES_THRESHOLD &&
                    spikeElapsedTime > MODE_SWITCH_DELAY) {
                    useHashrate3hr = false;
                    chart.lowHashrateState.isLowHashrateMode = false;
                    chart.lowHashrateState.highHashrateSpikeTime = 0;
                    chart.lowHashrateState.spikeCount = 0;
                    chart.lowHashrateState.lastSpikeDecayTime = currentTime;
                    chart.lowHashrateState.lastModeChange = currentTime;
                    console.log("Exiting low hashrate mode after sustained high hashrate");

                    // Save state changes to localStorage
                    saveLowHashrateState(chart.lowHashrateState);
                } else {
                    console.log(`Remaining in low hashrate mode despite spike (waiting: ${Math.round(spikeElapsedTime / 1000)}/${MODE_SWITCH_DELAY / 1000}s, count: ${chart.lowHashrateState.spikeCount}/${CONSECUTIVE_SPIKES_THRESHOLD})`);
                }
            } else {
                // Decrease spike counter after a set interval when hashrate drops
                if (chart.lowHashrateState.spikeCount > 0 && normalizedHashrate60sec < HIGH_HASHRATE_THRESHOLD) {
                    const decayElapsed = currentTime - chart.lowHashrateState.lastSpikeDecayTime;
                    if (decayElapsed >= SPIKE_DECAY_INTERVAL) {
                        chart.lowHashrateState.spikeCount = Math.max(0, chart.lowHashrateState.spikeCount - 1);
                        chart.lowHashrateState.lastSpikeDecayTime = currentTime;
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
                    stableModePeriod: state.stableModePeriod,
                    lastSpikeDecayTime: state.lastSpikeDecayTime
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
                    const endTime = data.server_timestamp ?
                        new Date(data.server_timestamp) : new Date();
                    const labelTimestamps = validHistoryData.map((_, idx) => {
                        const offset = (validHistoryData.length - 1 - idx) * 60000;
                        return new Date(endTime.getTime() - offset);
                    });

                    const labelInfo = formatChartLabels(labelTimestamps, timeZone);
                    chart.data.labels = labelInfo.labels;
                    chart.labelTimestamps = labelTimestamps;

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
                    // Limit the data points based on the selected chartPoints (30, 60, 180 or all)
                    const limitedData = validatedData.slice(-chartPoints);
                    chart.data.datasets[0].data = limitedData;

                    // Similarly, limit the labels and timestamps
                    // Slice the already formatted labels based on the desired number of points
                    const limitedLabels = labelInfo.labels.slice(-chartPoints);
                    const limitedTimestamps = labelTimestamps.slice(-chartPoints);
                    chart.data.labels = limitedLabels;
                    chart.labelTimestamps = limitedTimestamps;

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
                chart.labelTimestamps = [now];

                // MODIFICATION: For single datapoint in low hashrate mode, ensure 24hr avg is visible
                if (useHashrate3hr && normalizedAvg > 0) {
                    const yMin = Math.min(normalizedValue * 0.8, normalizedAvg * 0.5);
                    const yMax = Math.max(normalizedValue * 1.2, normalizedAvg * 1.5);

                    chart.options.scales.y.min = yMin;
                    chart.options.scales.y.max = yMax;
                    console.log(`Low hashrate mode (single point): Adjusting y-axis to include 24hr avg: [${yMin.toFixed(2)}, ${yMax.toFixed(2)}]`);
                }
                updateDaySeparators(chart, chart.labelTimestamps);
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

        updateDaySeparators(chart, chart.labelTimestamps);
        updateBlockAnnotations(chart);

        if (chart.data && chart.data.datasets && chart.data.datasets.length > 0) {
            const removeMarkers = extendedHistoryEnabled && chartPoints === Infinity;
            chart.data.datasets[0].pointRadius = removeMarkers ? 0 : 3;
            chart.data.datasets[0].pointHoverRadius = removeMarkers ? 0 : 3;
        }

        // Finally update the chart with a safe non-animating update
        chart.update('none');
    } catch (chartError) {
        console.error("Error updating chart:", chartError);
    }
}
