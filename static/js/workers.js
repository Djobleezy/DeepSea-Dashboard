"use strict";

// Global variables for workers dashboard
let workerData = null;
let refreshTimer;
const pageLoadTime = Date.now();
let lastManualRefreshTime = 0;
const filterState = {
    currentFilter: 'all',
    searchTerm: ''
};
let miniChart = null;
let connectionRetryCount = 0;

// Pagination variables
const WORKERS_PER_PAGE = 20; // Show 20 workers per page
let currentPage = 1;
let totalPages = 1;
let filteredWorkers = [];

// Server time variables for uptime calculation - synced with main dashboard
let serverTimeOffset = 0;
let serverStartTime = null;

// New variable to track custom refresh timing
const MIN_REFRESH_INTERVAL = 10000; // Minimum 10 seconds between refreshes

// Hashrate Normalization Utilities
// Helper function to normalize hashrate to TH/s for consistent graphing
function normalizeHashrate(value, unit = 'th/s') {
    if (!value || isNaN(value)) return 0;

    unit = unit.toLowerCase();
    const unitConversion = {
        'ph/s': 1000,
        'eh/s': 1000000,
        'gh/s': 1 / 1000,
        'mh/s': 1 / 1000000,
        'kh/s': 1 / 1000000000,
        'h/s': 1 / 1000000000000
    };

    return unitConversion[unit] !== undefined ? value * unitConversion[unit] : value;
}

// Helper function to format hashrate values for display
function formatHashrateForDisplay(value, unit) {
    if (isNaN(value) || value === null || value === undefined) return "N/A";

    const normalizedValue = unit ? normalizeHashrate(value, unit) : value;
    const unitRanges = [
        { threshold: 1000000, unit: 'EH/s', divisor: 1000000 },
        { threshold: 1000, unit: 'PH/s', divisor: 1000 },
        { threshold: 1, unit: 'TH/s', divisor: 1 },
        { threshold: 0.001, unit: 'GH/s', divisor: 1 / 1000 },
        { threshold: 0, unit: 'MH/s', divisor: 1 / 1000000 }
    ];

    for (const range of unitRanges) {
        if (normalizedValue >= range.threshold) {
            return (normalizedValue / range.divisor).toFixed(2) + ' ' + range.unit;
        }
    }
    return (normalizedValue * 1000000).toFixed(2) + ' MH/s';
}

// ASIC model power efficiency data (TH/s per Watt)
const ASIC_EFFICIENCY_DATA = {
    // S19 Series
    "Bitmain Antminer S19": { efficiency: 0.03, defaultWatts: 3250 },
    "Bitmain Antminer S19 Pro": { efficiency: 0.034, defaultWatts: 3250 },
    "Bitmain Antminer S19j Pro": { efficiency: 0.033, defaultWatts: 3150 },
    "Bitmain Antminer S19k Pro": { efficiency: 0.034, defaultWatts: 3050 },
    "Bitmain Antminer S19 XP": { efficiency: 0.039, defaultWatts: 3010 },
    "Bitmain Antminer S19j": { efficiency: 0.029, defaultWatts: 3050 },

    // S21 Series 
    "Bitmain Antminer S21": { efficiency: 0.049, defaultWatts: 3500 },
    "Bitmain Antminer S21 Pro": { efficiency: 0.053, defaultWatts: 3450 },
    "Bitmain Antminer T21": { efficiency: 0.039, defaultWatts: 3276 },

    // M Series (MicroBT Whatsminer)
    "MicroBT Whatsminer M30S": { efficiency: 0.031, defaultWatts: 3400 },
    "MicroBT Whatsminer M30S+": { efficiency: 0.034, defaultWatts: 3400 },
    "MicroBT Whatsminer M30S++": { efficiency: 0.035, defaultWatts: 3472 },
    "MicroBT Whatsminer M31S": { efficiency: 0.030, defaultWatts: 3220 },
    "MicroBT Whatsminer M31S+": { efficiency: 0.032, defaultWatts: 3312 },
    "MicroBT Whatsminer M50": { efficiency: 0.046, defaultWatts: 3500 },

    // Avalon Series
    "Canaan Avalon A1246": { efficiency: 0.029, defaultWatts: 3010 },
    "Canaan Avalon A1166": { efficiency: 0.027, defaultWatts: 3196 },
    "Canaan Avalon A1346": { efficiency: 0.035, defaultWatts: 3276 },

    // BitAxe and DIY Mining Devices (much smaller scale)
    "BitAxe": { efficiency: 0.005, defaultWatts: 35 },
    "BitAxe 2.0": { efficiency: 0.006, defaultWatts: 30 },
    "BitAxe 3.0": { efficiency: 0.007, defaultWatts: 28 },
    "BitAxe BM1368": { efficiency: 0.0075, defaultWatts: 32 },
    "BitAxe BM1397": { efficiency: 0.0065, defaultWatts: 30 },
    "ESP32 BM1387": { efficiency: 0.0035, defaultWatts: 15 },
    "DIY Single-chip": { efficiency: 0.004, defaultWatts: 20 },

    // USB ASIC Miners
    "Gekkoscience Newpac": { efficiency: 0.0024, defaultWatts: 12 },
    "Futurebit Moonlander 2": { efficiency: 0.0018, defaultWatts: 10 },
    "GoldShell Mini-DOGE": { efficiency: 0.0029, defaultWatts: 233 },

    // Default for unknown models
    "Default ASIC": { efficiency: 0.034, defaultWatts: 3100 }
};

// Modified calculatePowerCost to better handle small miners with unique units
function calculatePowerCost(worker) {
    try {
        // Get power cost per kWh from config (via workerData)
        let powerCostPerKwh = workerData.power_cost || 0.12; // Default to $0.12/kWh if not available

        // Get actual power consumption if available
        let powerUsageWatts = worker.power_consumption;

        // Special handling for BitAxe and other small devices that might report in GH/s or MH/s 
        const isSmallMiner = worker.model &&
            (worker.model.toLowerCase().includes('bitaxe') ||
                worker.model.toLowerCase().includes('esp32') ||
                worker.model.toLowerCase().includes('diy') ||
                worker.model.toLowerCase().includes('gekko') ||
                worker.model.toLowerCase().includes('moonlander'));

        // If worker is offline but has no power consumption value, use 3hr hashrate to estimate
        if (worker.status === "offline" && (!powerUsageWatts || powerUsageWatts <= 0) && worker.hashrate_3hr > 0) {
            // Normalize hashrate to TH/s for calculations
            const hashrateThs = normalizeHashrate(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');

            // Find efficiency data for this model
            const modelEfficiency = ASIC_EFFICIENCY_DATA[worker.model] || ASIC_EFFICIENCY_DATA["Default ASIC"];

            // Calculate estimated power usage based on hashrate and efficiency
            // For offline workers, we use a scaling factor to represent reduced power (70% of normal)
            // This simulates a recent shutdown with some cooling components still active
            powerUsageWatts = Math.round((hashrateThs / modelEfficiency.efficiency) * 0.7);

            // Cap reasonable limits - different for small miners
            const minWatts = isSmallMiner ? 2 : 20;   // Lower minimum for small miners
            const maxWatts = isSmallMiner ? 50 : 1500; // Lower maximum for small miners when offline
            powerUsageWatts = Math.max(minWatts, Math.min(maxWatts, powerUsageWatts));
        } else if (worker.status !== "online" && (!powerUsageWatts || powerUsageWatts <= 0)) {
            // For truly offline workers with no hashrate history
            return {
                dailyCost: 0,
                monthlyCost: 0,
                powerUsage: 0
            };
        } else if (!powerUsageWatts || powerUsageWatts <= 0) {
            // For online workers with no power consumption data, estimate based on model and hashrate
            // Normalize hashrate to TH/s for calculations
            const hashrateThs = normalizeHashrate(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');

            // Find efficiency data for this model
            const modelEfficiency = ASIC_EFFICIENCY_DATA[worker.model] || ASIC_EFFICIENCY_DATA["Default ASIC"];

            // Calculate estimated power usage based on hashrate and efficiency
            // Formula: Power (W) = hashrate (TH/s) / efficiency (TH/W)
            powerUsageWatts = Math.round(hashrateThs / modelEfficiency.efficiency);

            // Cap reasonable limits to prevent extreme values - different for small miners
            const minWatts = isSmallMiner ? 5 : 30;   // Lower minimum for small miners
            const maxWatts = isSmallMiner ? 250 : 4500; // Lower maximum for small miners
            powerUsageWatts = Math.max(minWatts, Math.min(maxWatts, powerUsageWatts));
        }

        // Convert watts to kilowatts
        const powerUsageKw = powerUsageWatts / 1000;

        // Daily cost = power (kW) * 24 hours * cost per kWh
        const dailyCostUsd = powerUsageKw * 24 * powerCostPerKwh;

        // Monthly cost = daily cost * 30 days
        const monthlyCostUsd = dailyCostUsd * 30;

        return {
            dailyCost: dailyCostUsd,
            monthlyCost: monthlyCostUsd,
            powerUsage: powerUsageWatts
        };
    } catch (e) {
        console.error("Error calculating power cost:", e);
        return {
            dailyCost: 0,
            monthlyCost: 0,
            powerUsage: 0
        };
    }
}

// Calculate total power consumption for all workers
function calculateTotalPowerUsage(workers) {
    if (!workers || !Array.isArray(workers) || workers.length === 0) {
        return 0;
    }

    let totalPower = 0;

    workers.forEach(worker => {
        // Use the power usage calculated by calculatePowerCost or the raw value
        const powerData = calculatePowerCost(worker);
        totalPower += powerData.powerUsage || 0;
    });

    return Math.round(totalPower);
}

// Format power cost with currency symbol
function formatPowerCost(cost) {
    if (!workerData || cost === 0) return "$0.00";

    try {
        // Get currency info
        const configCurrency = workerData.currency || 'USD';
        const exchangeRates = workerData.exchange_rates || {};

        // Apply exchange rate if not USD
        let convertedCost = cost;
        if (configCurrency !== 'USD' && exchangeRates[configCurrency]) {
            convertedCost *= exchangeRates[configCurrency];
        }

        // Format the value
        const formattedValue = convertedCost.toFixed(2);

        // Set currency symbol
        let symbol = '$';
        switch (configCurrency) {
            case 'EUR': symbol = '€'; break;
            case 'GBP': symbol = '£'; break;
            case 'JPY': symbol = '¥'; break;
            case 'AUD':
            case 'CAD':
            case 'NZD':
            case 'USD': symbol = '$'; break;
            default: symbol = configCurrency + ' ';
        }

        return symbol + formattedValue;
    } catch (e) {
        console.error('Error formatting power cost:', e);
        return "$" + cost.toFixed(2);
    }
}

// Initialize the page
$(document).ready(function () {
    console.log("Worker page initializing...");

    initNotificationBadge();
    initializePage();
    updateServerTime();

    window.manualRefresh = fetchWorkerData;

    setTimeout(() => {
        if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
            BitcoinMinuteRefresh.initialize(window.manualRefresh);
            console.log("BitcoinMinuteRefresh initialized with refresh function");
        } else {
            console.warn("BitcoinMinuteRefresh not available");
        }
    }, 500);

    fetchWorkerData();

    $('.filter-button').click(function () {
        $('.filter-button').removeClass('active');
        $(this).addClass('active');
        filterState.currentFilter = $(this).data('filter');
        filterWorkers();
    });

    $('#worker-search').on('input', function () {
        filterState.searchTerm = $(this).val().toLowerCase();
        filterWorkers();
    });
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

// Initialize page elements
function initializePage() {
    console.log("Initializing page elements...");

    if (document.getElementById('total-hashrate-chart')) {
        initializeMiniChart();
    }

    $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-spinner fa-spin"></i> Loading worker data...</div>');

    // Hide pagination container initially until workers are loaded
    $('#pagination-container').hide();

    if (!$('#retry-button').length) {
        $('body').append('<button id="retry-button" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #f7931a; color: black; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Retry Loading Data</button>');

        $('#retry-button').on('click', function () {
            $(this).text('Retrying...').prop('disabled', true);
            fetchWorkerData(true);
            setTimeout(() => {
                $('#retry-button').text('Retry Loading Data').prop('disabled', false);
            }, 3000);
        });
    }
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

// Server time update via polling - enhanced to use shared storage
function updateServerTime() {
    console.log("Updating server time...");

    try {
        const storedOffset = localStorage.getItem('serverTimeOffset');
        const storedStartTime = localStorage.getItem('serverStartTime');

        if (storedOffset && storedStartTime) {
            serverTimeOffset = parseFloat(storedOffset);
            serverStartTime = parseFloat(storedStartTime);
            console.log("Using stored server time offset:", serverTimeOffset, "ms");

            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }
            return;
        }
    } catch (e) {
        console.error("Error reading stored server time:", e);
    }

    $.ajax({
        url: "/api/time",
        method: "GET",
        timeout: 5000,
        success: function (data) {
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();

            localStorage.setItem('serverTimeOffset', serverTimeOffset.toString());
            localStorage.setItem('serverStartTime', serverStartTime.toString());

            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }

            console.log("Server time synchronized. Offset:", serverTimeOffset, "ms");
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", textStatus, errorThrown);
        }
    });
}

// Utility functions to show/hide loader
function showLoader() {
    $("#loader").show();
    if (window.PageLoader) {
        PageLoader.show('Loading workers...');
    }
}

function hideLoader() {
    $("#loader").hide();
    if (window.PageLoader) {
        PageLoader.hide();
    }
}

// Modified to properly fetch and store currency data 
function fetchWorkerData(forceRefresh = false) {
    console.log("Fetching worker data...");
    lastManualRefreshTime = Date.now();
    $('#worker-grid').addClass('loading-fade');
    showLoader();

    // Reset to first page when fetching new data
    currentPage = 1;

    // For large datasets, better to use streaming or chunked approach
    // First fetch just the summary data and first page
    const initialRequest = $.ajax({
        url: `/api/workers?summary=true&page=1${forceRefresh ? '&force=true' : ''}`,
        method: 'GET',
        dataType: 'json',
        timeout: 15000
    });

    initialRequest.then(summaryData => {
        // Store summary stats immediately to update UI
        workerData = summaryData || {};
        workerData.workers = workerData.workers || [];

        // If currency data is missing, fetch it separately
        if (!workerData.currency || !workerData.btc_price) {
            $.ajax({
                url: '/api/metrics',
                method: 'GET',
                dataType: 'json'
            }).then(metrics => {
                if (metrics) {
                    workerData.currency = metrics.currency || 'USD';
                    workerData.btc_price = metrics.btc_price || 75000;
                    workerData.exchange_rates = metrics.exchange_rates || {};
                }

                // Continue with updates
                updateSummaryStats();
                updateMiniChart();
                updateLastUpdated();
                continueFetchingWorkers();
            }).catch(() => {
                // Even if metrics fetch fails, continue with worker data
                continueFetchingWorkers();
            });
        } else {
            // We already have currency data, continue directly
            updateSummaryStats();
            updateMiniChart();
            updateLastUpdated();
            continueFetchingWorkers();
        }
        
        // After receiving worker data, check if we need to fetch config
        if (!workerData.power_cost && !workerData.configFetched) {
            // Fetch configuration to get power cost
            $.ajax({
                url: '/api/config',
                method: 'GET',
                dataType: 'json'
            }).then(config => {
                if (config) {
                    // Add power cost to worker data
                    workerData.power_cost = config.power_cost || 0.12;
                    workerData.configFetched = true; // Flag to prevent refetching
                }

                // Continue with rendering the workers
                updateSummaryStats();
                updateMiniChart();
                updateLastUpdated();
                renderWorkersList();
            }).catch(error => {
                console.warn("Could not fetch power cost from config:", error);
                // Continue anyway with default values
                renderWorkersList();
            });
        } else {
            // Continue with rendering the workers
            renderWorkersList();
        }

    }).catch(error => {
        console.error("Error fetching initial worker data:", error);
        $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-exclamation-circle"></i> Error loading workers. <button class="retry-btn">Retry</button></div>');
        $('.retry-btn').on('click', () => fetchWorkerData(true));
        hideLoader();
        $('#worker-grid').removeClass('loading-fade');
        $('#pagination-container').hide();
    });

    // Function to continue fetching additional worker pages
    function continueFetchingWorkers() {
        const totalPages = Math.ceil((workerData.workers_total || 0) / 100); // Assuming 100 workers per page
        const pagesToFetch = Math.min(totalPages, 20); // Limit to 20 pages max

        if (pagesToFetch <= 1) {
            // We already have all the data from the first request
            finishWorkerLoad();
            return;
        }

        // Progress indicator
        const progressBar = $('<div class="worker-load-progress"><div class="progress-bar"></div><div class="progress-text">Loading workers: 1/' + pagesToFetch + '</div></div>');
        $('#worker-grid').html(progressBar);

        // Load remaining pages in batches to avoid overwhelming the browser
        loadWorkerPages(2, pagesToFetch, progressBar);
    }
}

// Load worker pages in batches
function loadWorkerPages(startPage, totalPages, progressBar) {
    const BATCH_SIZE = 3; // Number of pages to load in parallel
    const endPage = Math.min(startPage + BATCH_SIZE - 1, totalPages);
    const requests = [];

    for (let page = startPage; page <= endPage; page++) {
        requests.push(
            $.ajax({
                url: `/api/workers?page=${page}`,
                method: 'GET',
                dataType: 'json',
                timeout: 15000
            })
        );
    }

    Promise.all(requests)
        .then(pages => {
            // Process each page
            pages.forEach(pageData => {
                if (pageData && pageData.workers && pageData.workers.length > 0) {
                    // Append new workers to our list efficiently
                    workerData.workers = workerData.workers.concat(pageData.workers);
                }
            });

            // Update progress
            const progress = Math.min(endPage / totalPages * 100, 100);
            progressBar.find('.progress-bar').css('width', progress + '%');
            progressBar.find('.progress-text').text(`Loading workers: ${endPage}/${totalPages}`);

            if (endPage < totalPages) {
                // Continue with next batch
                setTimeout(() => loadWorkerPages(endPage + 1, totalPages, progressBar), 100);
            } else {
                // All pages loaded
                finishWorkerLoad();
            }
        })
        .catch(error => {
            console.error(`Error fetching worker pages ${startPage}-${endPage}:`, error);
            // Continue with what we have so far
            finishWorkerLoad();
        });
}

// Finish loading process with optimized rendering
function finishWorkerLoad() {
    // Deduplicate workers more efficiently with a Map
    const uniqueWorkersMap = new Map();
    workerData.workers.forEach(worker => {
        if (worker.name) {
            uniqueWorkersMap.set(worker.name, worker);
        }
    });
    workerData.workers = Array.from(uniqueWorkersMap.values());

    // Notify BitcoinMinuteRefresh
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
        BitcoinMinuteRefresh.notifyRefresh();
    }

    // Efficiently render workers with pagination
    renderWorkersList();

    $('#retry-button').hide();
    connectionRetryCount = 0;
    console.log(`Worker data updated successfully: ${workerData.workers.length} workers`);
    $('#worker-grid').removeClass('loading-fade');
    hideLoader();
}

// Modified renderWorkersList function to implement pagination
function renderWorkersList() {
    if (!workerData || !workerData.workers) {
        console.error("No worker data available");
        return;
    }

    const workerGrid = $('#worker-grid');
    workerGrid.empty();

    // Filter workers based on current filter state
    filteredWorkers = filterWorkersData(workerData.workers);

    if (filteredWorkers.length === 0) {
        workerGrid.html(`
            <div class="text-center p-5">
                <i class="fas fa-search"></i>
                <p>No workers match your filter criteria</p>
            </div>
        `);
        // Hide pagination when no results
        $('#pagination-container').hide();
        return;
    }

    // Calculate pagination
    totalPages = Math.ceil(filteredWorkers.length / WORKERS_PER_PAGE);

    // Ensure current page is within bounds after filtering
    if (currentPage > totalPages) {
        currentPage = totalPages;
    }

    // Calculate slice for current page
    const startIndex = (currentPage - 1) * WORKERS_PER_PAGE;
    const endIndex = Math.min(startIndex + WORKERS_PER_PAGE, filteredWorkers.length);

    // Get workers for current page only
    const workersToShow = filteredWorkers.slice(startIndex, endIndex);

    // Calculate max hashrate once for this batch
    const maxHashrate = calculateMaxHashrate();

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Render the current page of workers
    workersToShow.forEach(worker => {
        const card = createWorkerCard(worker, maxHashrate);
        fragment.appendChild(card[0]);
    });

    workerGrid.append(fragment);

    // Update pagination display
    updatePagination(startIndex, endIndex, filteredWorkers.length);

    // Show pagination controls if needed
    $('#pagination-container').toggle(filteredWorkers.length > WORKERS_PER_PAGE);
}

// New function for pagination controls
function updatePagination(startIndex, endIndex, totalItems) {
    // Generate pagination buttons
    const pagination = $('#pagination');
    pagination.empty();

    // Don't show pagination for small lists
    if (totalItems <= WORKERS_PER_PAGE) {
        return;
    }

    // Add previous button
    pagination.append(`
        <button class="pagination-button${currentPage === 1 ? ' disabled' : ''}" 
                data-page="prev"${currentPage === 1 ? ' disabled' : ''}>
            &laquo;
        </button>
    `);

    // Determine which page buttons to show (show up to 5 pages + first/last)
    const pagesToShow = [];

    // Always add first page
    pagesToShow.push(1);

    // Add pages around current page
    for (let i = Math.max(2, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
        pagesToShow.push(i);
    }

    // Always add last page if more than 1 page
    if (totalPages > 1) {
        pagesToShow.push(totalPages);
    }

    // Add ellipsis and page buttons
    let prevPage = 0;
    pagesToShow.forEach(page => {
        // Add ellipsis if needed
        if (page - prevPage > 1) {
            pagination.append('<span class="pagination-ellipsis">...</span>');
        }

        // Add page button
        pagination.append(`
            <button class="pagination-button${page === currentPage ? ' active' : ''}" 
                    data-page="${page}">
                ${page}
            </button>
        `);

        prevPage = page;
    });

    // Add next button
    pagination.append(`
        <button class="pagination-button${currentPage === totalPages ? ' disabled' : ''}" 
                data-page="next"${currentPage === totalPages ? ' disabled' : ''}>
            &raquo;
        </button>
    `);

    // Update counter text - now positioned below the pagination buttons
    $('#pagination-count').text(`Showing ${startIndex + 1}-${endIndex} of ${totalItems} workers`);

    // Add click handlers for pagination buttons
    $('.pagination-button').on('click', function () {
        if ($(this).hasClass('disabled')) return;

        const page = $(this).data('page');

        if (page === 'prev') {
            if (currentPage > 1) changePage(currentPage - 1);
        } else if (page === 'next') {
            if (currentPage < totalPages) changePage(currentPage + 1);
        } else {
            changePage(parseInt(page));
        }
    });
}

// New function for changing pages
function changePage(newPage) {
    if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;

    currentPage = newPage;
    renderWorkersList();

    // Scroll to top of worker grid for better UX
    $('#worker-grid')[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Render a batch of workers efficiently
function renderWorkerBatch(workers, container) {
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Calculate max hashrate once for this batch
    const maxHashrate = calculateMaxHashrate();

    workers.forEach(worker => {
        const card = createWorkerCard(worker, maxHashrate);
        fragment.appendChild(card[0]);
    });

    container.append(fragment);
}

// Calculate max hashrate once to avoid recalculating for each worker
function calculateMaxHashrate() {
    let maxHashrate = 125; // Default fallback

    // First check if global hashrate data is available
    if (workerData && workerData.hashrate_24hr) {
        const globalHashrate = normalizeHashrate(workerData.hashrate_24hr, workerData.hashrate_24hr_unit || 'th/s');
        if (globalHashrate > 0) {
            return Math.max(5, globalHashrate * 1.2);
        }
    }

    // If no global data, calculate from workers efficiently
    if (workerData && workerData.workers && workerData.workers.length > 0) {
        const onlineWorkers = workerData.workers.filter(w => w.status === 'online');

        if (onlineWorkers.length > 0) {
            // Collect all hashrates for statistical analysis
            const hashrateValues = [];

            // First pass - collect normalized hashrates
            onlineWorkers.forEach(w => {
                const hashrateValue = w.hashrate_24hr || w.hashrate_3hr || 0;
                const hashrateUnit = w.hashrate_24hr ?
                    (w.hashrate_24hr_unit || 'th/s') :
                    (w.hashrate_3hr_unit || 'th/s');
                const normalizedRate = normalizeHashrate(hashrateValue, hashrateUnit);

                if (normalizedRate > 0) {
                    hashrateValues.push(normalizedRate);
                }
            });

            // Only perform outlier detection if we have enough data points
            if (hashrateValues.length >= 4) {
                // Sort the values for quartile calculation
                hashrateValues.sort((a, b) => a - b);

                // Calculate quartiles for IQR (Interquartile Range) method
                const q1Index = Math.floor(hashrateValues.length * 0.25);
                const q3Index = Math.floor(hashrateValues.length * 0.75);
                const q1 = hashrateValues[q1Index];
                const q3 = hashrateValues[q3Index];
                const iqr = q3 - q1;

                // Define outlier threshold (1.5 * IQR is commonly used)
                const upperBound = q3 + (iqr * 1.5);

                // Filter out outliers and find maximum non-outlier value
                const filteredValues = hashrateValues.filter(v => v <= upperBound);
                const maxNonOutlierValue = Math.max(...filteredValues);

                // Log if outliers were removed
                if (filteredValues.length < hashrateValues.length) {
                    console.log(`Removed ${hashrateValues.length - filteredValues.length} outlier hashrate values`);
                }

                // Return max value with buffer
                if (maxNonOutlierValue > 0) {
                    return Math.max(5, maxNonOutlierValue * 1.2);
                }
            } else {
                // Not enough data points for outlier detection, use simple maximum
                let maxWorkerHashrate = Math.max(...hashrateValues, 0);

                if (maxWorkerHashrate > 0) {
                    return Math.max(5, maxWorkerHashrate * 1.2);
                }
            }
        }
    }

    // Fallback to total hashrate
    if (workerData && workerData.total_hashrate) {
        const totalHashrate = normalizeHashrate(workerData.total_hashrate, workerData.hashrate_unit || 'th/s');
        if (totalHashrate > 0) {
            return Math.max(5, totalHashrate * 1.2);
        }
    }

    return maxHashrate;
}

// Helper function to format currency values with HTML entity support
function formatCurrencyValue(sats) {
    // Default values
    let symbol = '$';
    let value = '0.00';

    try {
        // Get BTC price and currency info from workerData
        const btcPrice = workerData.btc_price || 75000;
        const configCurrency = workerData.currency || 'USD';
        const exchangeRates = workerData.exchange_rates || {};

        // Convert SATS to BTC then to USD
        const btcValue = sats / 100000000;
        let fiatValue = btcValue * btcPrice; // USD value

        // Apply exchange rate if not USD
        if (configCurrency !== 'USD' && exchangeRates[configCurrency]) {
            fiatValue *= exchangeRates[configCurrency];
        }

        // Format the value
        value = fiatValue.toFixed(2);

        // Set currency symbol using HTML entities or plain ASCII for better compatibility
        switch (configCurrency) {
            case 'EUR': symbol = '&euro;'; break;  // HTML entity for Euro
            case 'GBP': symbol = '&pound;'; break; // HTML entity for Pound
            case 'JPY': symbol = '&yen;'; break;   // HTML entity for Yen
            case 'AUD':
            case 'CAD':
            case 'NZD':
            case 'USD': symbol = '$'; break;       // Dollar sign is ASCII
            default: symbol = configCurrency + ' ';// Fallback to currency code
        }
    } catch (e) {
        console.error('Error formatting currency:', e);
    }

    return { symbol, value, isHTML: (symbol.indexOf('&') === 0) };
}

// Replace the existing createWorkerCard function with this updated version

function createWorkerCard(worker, maxHashrate) {
    const card = $('<div class="worker-card"></div>');

    card.addClass(worker.status === 'online' ? 'worker-card-online' : 'worker-card-offline');
    card.append(`<div class="worker-type">${worker.type}</div>`);
    card.append(`<div class="worker-name">${worker.name}</div>`);
    card.append(`<div class="status-badge ${worker.status === 'online' ? 'status-badge-online' : 'status-badge-offline'}">${worker.status.toUpperCase()}</div>`);

    // Use 3hr hashrate for display
    const normalizedHashrate = normalizeHashrate(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');
    const hashratePercent = Math.min(100, (normalizedHashrate / maxHashrate) * 100);
    const formattedHashrate = formatHashrateForDisplay(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');

    card.append(`
        <div class="worker-stats-row">
            <div class="worker-stats-label">Hashrate (3hr):</div>
            <div class="white-glow">${formattedHashrate}</div>
        </div>
        <div class="stats-bar-container">
            <div class="stats-bar" style="width: ${hashratePercent}%"></div>
        </div>
    `);

    // Format the last share using the proper method for timezone conversion
    let formattedLastShare = 'N/A';
    if (worker.last_share && typeof worker.last_share === 'string') {
        try {
            const dateWithoutTZ = new Date(worker.last_share + 'Z');
            formattedLastShare = dateWithoutTZ.toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: window.dashboardTimezone || 'America/Los_Angeles'
            });
        } catch (e) {
            formattedLastShare = worker.last_share;
        }
    }

    // Calculate earnings in SATS and get currency equivalent
    const earningsSats = Math.floor(worker.earnings * 100000000); // Convert BTC to SATS
    const currencyData = formatCurrencyValue(earningsSats);

    // Calculate power consumption costs
    const powerCostData = calculatePowerCost(worker);
    const dailyCostFormatted = formatPowerCost(powerCostData.dailyCost);
    const monthlyCostFormatted = formatPowerCost(powerCostData.monthlyCost);

    // Create the value display with proper handling of HTML entities
    let valueDisplay;
    if (currencyData.isHTML) {
        // Create a temporary element to handle the HTML entities
        const valueElement = $('<div></div>');
        valueElement.html(`${currencyData.symbol}${currencyData.value}`);
        valueDisplay = valueElement.html();
    } else {
        valueDisplay = `${currencyData.symbol}${currencyData.value}`;
    }

    // Add ASIC model info if available
    const modelInfo = worker.model ? `<div class="worker-stats-row">
        <div class="worker-stats-label">Model:</div>
        <div class="white-glow">${worker.model}</div>
    </div>` : '';

    // Display power consumption info with different styling for offline workers
    const powerConsumptionClass = worker.status === 'online' ? 'yellow-glow' : 'dim-glow';
    const powerConsumption = (powerCostData.powerUsage || worker.power_consumption || 'N/A') + ' W';

    card.append(`
        <div class="worker-stats">
            ${modelInfo}
            <div class="worker-stats-row">
                <div class="worker-stats-label">Last Share:</div>
                <div class="blue-glow">${formattedLastShare}</div>
            </div>
            <div class="worker-stats-row">
                <div class="worker-stats-label">₿ Earnings:</div>
                <div class="green-glow">${worker.earnings.toFixed(8)}</div>
            </div>
            <div class="worker-stats-row">
                <div class="worker-stats-label">Fiat Value:</div>
                <div style="color: limegreen !important;">${valueDisplay}</div>
            </div>
            <div class="worker-stats-row">
                <div class="worker-stats-label">Est. Power Usage:</div>
                <div class="${powerConsumptionClass}">${powerConsumption}</div>
            </div>
            <div class="worker-stats-row power-cost-row">
                <div class="worker-stats-label">Est. Power Cost/Day:</div>
                <div class="red-glow">${dailyCostFormatted}</div>
            </div>
            <div class="worker-stats-row power-cost-row">
                <div class="worker-stats-label">Est. Cost/Month:</div>
                <div class="red-glow">${monthlyCostFormatted}</div>
            </div>
        </div>
    `);

    return card;
}

// Modified filterWorkers function to reset page when filters change
function filterWorkers() {
    if (!workerData || !workerData.workers) return;

    // Reset to first page when filters change
    currentPage = 1;
    renderWorkersList();
}

// Modified filterWorkersData function to only include 'all', 'online', and 'offline' filters
function filterWorkersData(workers) {
    if (!workers) return [];

    return workers.filter(worker => {
        const workerName = (worker.name || '').toLowerCase();
        const isOnline = worker.status === 'online';

        // Modified to only handle 'all', 'online', and 'offline' filters
        const matchesFilter = filterState.currentFilter === 'all' ||
            (filterState.currentFilter === 'online' && isOnline) ||
            (filterState.currentFilter === 'offline' && !isOnline);

        // Improved search matching to check name, model and type
        const matchesSearch = filterState.searchTerm === '' ||
            workerName.includes(filterState.searchTerm) ||
            (worker.model && worker.model.toLowerCase().includes(filterState.searchTerm)) ||
            (worker.type && worker.type.toLowerCase().includes(filterState.searchTerm));

        return matchesFilter && matchesSearch;
    });
}

// Update summary stats with normalized hashrate display and total power usage
function updateSummaryStats() {
    if (!workerData) return;

    $('#workers-count').text(workerData.workers_total || 0);
    $('#workers-online').text(workerData.workers_online || 0);
    $('#workers-offline').text(workerData.workers_offline || 0);

    const onlinePercent = workerData.workers_total > 0 ? workerData.workers_online / workerData.workers_total : 0;
    $('.worker-ring').css('--online-percent', onlinePercent);

    const formattedHashrate = workerData.total_hashrate !== undefined ?
        formatHashrateForDisplay(workerData.total_hashrate, workerData.hashrate_unit || 'TH/s') :
        '0.0 TH/s';
    $('#total-hashrate').text(formattedHashrate);

    $('#total-earnings').text(`${(workerData.total_earnings || 0).toFixed(8)} BTC`);
    $('#daily-sats').text(`${numberWithCommas(workerData.daily_sats || 0)} SATS`);

    // Calculate and display total power usage
    if (workerData.workers && workerData.workers.length > 0) {
        const totalPowerWatts = calculateTotalPowerUsage(workerData.workers);
        const powerDisplay = totalPowerWatts >= 1000 ?
            `${(totalPowerWatts / 1000).toFixed(2)} kW` :
            `${totalPowerWatts} W`;
        $('#total-power-usage').text(powerDisplay);
    } else {
        $('#total-power-usage').text('N/A');
    }
}

// Initialize mini chart
function initializeMiniChart() {
    console.log("Initializing mini chart...");

    const ctx = document.getElementById('total-hashrate-chart');
    if (!ctx) {
        console.error("Mini chart canvas not found");
        return;
    }

    const labels = Array(24).fill('').map((_, i) => i);
    const data = Array(24).fill(0).map(() => Math.random() * 100 + 700);

    miniChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                borderColor: '#1137F5',
                backgroundColor: 'rgba(57, 255, 20, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 1.5,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false },
                y: {
                    display: false,
                    min: Math.min(...data) * 0.9,
                    max: Math.max(...data) * 1.1
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: false,
            elements: {
                line: {
                    tension: 0.4
                }
            }
        }
    });
}

// Update mini chart with real data and normalization
function updateMiniChart() {
    if (!miniChart || !workerData || !workerData.hashrate_history) {
        console.log("Skipping mini chart update - missing data");
        return;
    }

    const historyData = workerData.hashrate_history;
    if (!historyData || historyData.length === 0) {
        console.log("No hashrate history data available");
        return;
    }

    const values = historyData.map(item => normalizeHashrate(parseFloat(item.value) || 0, item.unit || workerData.hashrate_unit || 'th/s'));
    const labels = historyData.map(item => item.time);

    miniChart.data.labels = labels;
    miniChart.data.datasets[0].data = values;

    const min = Math.min(...values.filter(v => v > 0)) || 0;
    const max = Math.max(...values) || 1;
    miniChart.options.scales.y.min = min * 0.9;
    miniChart.options.scales.y.max = max * 1.1;

    miniChart.update('none');
}

// Update the last updated timestamp
function updateLastUpdated() {
    if (!workerData || !workerData.timestamp) return;

    try {
        const timestamp = new Date(workerData.timestamp);

        // Get the configured timezone with a fallback
        const configuredTimezone = window.dashboardTimezone || 'America/Los_Angeles';

        // Format with the configured timezone
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZone: configuredTimezone  // Explicitly use the configured timezone
        };

        // Format the timestamp and update the DOM
        const formattedTime = timestamp.toLocaleString('en-US', options);

        $("#lastUpdated").html("<strong>Last Updated:</strong> " +
            formattedTime + "<span id='terminal-cursor'></span>");

        console.log(`Last updated timestamp using timezone: ${configuredTimezone}`);
    } catch (e) {
        console.error("Error formatting timestamp:", e);
        // Fallback to basic timestamp if there's an error
        $("#lastUpdated").html("<strong>Last Updated:</strong> " +
            new Date().toLocaleString() + "<span id='terminal-cursor'></span>");
    }
}

// Format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
