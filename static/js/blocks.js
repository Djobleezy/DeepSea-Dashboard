"use strict";

// Constants for configuration
const REFRESH_INTERVAL = 60000; // 60 seconds
const TOAST_DISPLAY_TIME = 3000; // 3 seconds
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const SATOSHIS_PER_BTC = 100000000;
const MAX_CACHE_SIZE = 20; // Number of block heights to cache
const BLOCKS_PER_PAGE = 15;          // Blocks displayed in the grid
const CHART_BLOCKS_COUNT = 25;       // Blocks used for miner distribution chart

// POOL configuration
const POOL_CONFIG = {
    oceanPools: ['ocean', 'oceanpool', 'oceanxyz', 'ocean.xyz'],
    oceanColor: '#00ffff',
    defaultUnknownColor: '#999999'
};

// Global variables
let currentStartHeight = null;        // height currently displayed at the top of the grid
let latestBlockHeight = null;         // most recent block height fetched

// Primary and fallback mempool API URLs
const MEMPOOL_GUIDE_BASE_URL = "https://mempool.guide";
const MEMPOOL_SPACE_BASE_URL = "https://mempool.space";
const mempoolLinkBaseUrl = MEMPOOL_GUIDE_BASE_URL; // links should still point to mempool.guide
let blocksCache = {};
let isLoading = false;
let minerChart = null;
let notificationIntervalId = null;  // interval for notification badge
let refreshIntervalId = null;       // interval for block refresh

// Determine legend position based on screen size
function getLegendPosition() {
    return window.innerWidth <= 576 ? 'bottom' : 'left';
}

// Helper function for debouncing
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Helper function to fetch from mempool.guide with a fallback to mempool.space
function fetchMempoolApi(endpoint) {
    function fetchJson(baseUrl) {
        return fetch(`${baseUrl}${endpoint}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            });
    }

    return fetchJson(MEMPOOL_GUIDE_BASE_URL)
        .catch(() => fetchJson(MEMPOOL_SPACE_BASE_URL));
}

// Helper function to validate block height
function isValidBlockHeight(height) {
    height = parseInt(height);
    if (isNaN(height) || height < 0) {
        showToast("Please enter a valid block height");
        return false;
    }
    return height;
}

// Helper function to add items to cache with size management
function addToCache(height, data) {
    blocksCache[height] = data;

    // Remove oldest entries if cache exceeds maximum size
    const cacheKeys = Object.keys(blocksCache).map(Number).sort((a, b) => a - b);
    if (cacheKeys.length > MAX_CACHE_SIZE) {
        const keysToRemove = cacheKeys.slice(0, cacheKeys.length - MAX_CACHE_SIZE);
        keysToRemove.forEach(key => delete blocksCache[key]);
    }
}

// Recursively fetch additional blocks until the desired count is reached
function fetchAdditionalBlocks(height, remaining) {
    if (remaining <= 0) return Promise.resolve([]);
    return fetchMempoolApi(`/api/v1/blocks/${height}`).then(data => {
        if (!Array.isArray(data) || data.length === 0) {
            return [];
        }
        if (data.length >= remaining) {
            return data.slice(0, remaining);
        }
        const nextHeight = data[data.length - 1].height - 1;
        return fetchAdditionalBlocks(nextHeight, remaining - data.length)
            .then(more => data.concat(more));
    }).catch(() => []);
}

// Prepare data for the miner distribution chart using up to CHART_BLOCKS_COUNT blocks
function prepareChartData(initialBlocks) {
    if (!Array.isArray(initialBlocks) || initialBlocks.length === 0) {
        updateMinerDistributionChart([]);
        return;
    }

    if (initialBlocks.length >= CHART_BLOCKS_COUNT) {
        updateMinerDistributionChart(initialBlocks.slice(0, CHART_BLOCKS_COUNT));
    } else {
        const lastHeight = initialBlocks[initialBlocks.length - 1].height - 1;
        fetchAdditionalBlocks(lastHeight, CHART_BLOCKS_COUNT - initialBlocks.length)
            .then(extra => {
                const combined = initialBlocks.concat(extra).slice(0, CHART_BLOCKS_COUNT);
                updateMinerDistributionChart(combined);
            })
            .catch(() => updateMinerDistributionChart(initialBlocks));
    }
}

// Clean up event handlers when refreshing or navigating
function cleanupEventHandlers(preserve_chart = false) {
    $(window).off("click.blockModal");
    $(document).off("keydown.blockModal");
    $(window).off('resize');
    if (notificationIntervalId) {
        clearInterval(notificationIntervalId);
        notificationIntervalId = null;
    }
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }
    if (!preserve_chart && minerChart) {
        if (typeof minerChart.destroy === 'function') {
            minerChart.destroy();
        }
        minerChart = null;
    }
}

// Setup keyboard navigation for modal
function setupModalKeyboardNavigation() {
    $(document).on('keydown.blockModal', function (e) {
        const modal = $("#block-modal");
        if (modal.css('display') === 'block') {
            if (e.keyCode === 27) { // ESC key
                closeModal();
            }
        }
    });
}

// DOM ready initialization
$(document).ready(function () {
    console.log("Blocks page initialized");

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

    // Initialize notification badge
    initNotificationBadge();

    // Load the latest blocks on page load
    loadLatestBlocks();

    // Set up event listeners
    $("#load-blocks").on("click", function () {
        const height = isValidBlockHeight($("#block-height").val());
        if (height !== false) {
            loadBlocksFromHeight(height);
        }
    });

    $("#latest-blocks").on("click", loadLatestBlocks);

    // Handle Enter key on the block height input with debouncing
    $("#block-height").on("keypress", debounce(function (e) {
        if (e.which === 13) {
            const height = isValidBlockHeight($(this).val());
            if (height !== false) {
                loadBlocksFromHeight(height);
            }
        }
    }, 300));

    // Close the modal when clicking the X or outside the modal
    $(".block-modal-close").on("click", closeModal);
    $(window).on("click.blockModal", function (event) {
        if ($(event.target).hasClass("block-modal")) {
            closeModal();
        }
    });

    // Register refresh function for the system monitor and initialize it
    // This ensures the monitor can trigger manual data reloads
    window.manualRefresh = loadLatestBlocks;
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);
        console.log("BitcoinMinuteRefresh initialized with refresh function");
    }

    // Setup keyboard navigation for modals
    setupModalKeyboardNavigation();

    // Adjust chart legend on resize
    $(window).on('resize', debounce(function () {
        if (minerChart) {
            minerChart.options.plugins.legend.position = getLegendPosition();
            minerChart.update();
        }
    }, 200));

    // Cleanup before unload
    $(window).on('beforeunload', cleanupEventHandlers);
});

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
    notificationIntervalId = setInterval(updateNotificationBadge, 60000);
}

// Add keyboard event listener for Alt+W to reset wallet address
$(document).keydown(function (event) {
    // Check if Alt+W is pressed (key code 87 is 'W')
    if (event.altKey && event.keyCode === 87) {
        resetWalletAddress();
        $.ajax({
            url: "/api/notifications/clear",
            method: "POST",
            data: JSON.stringify({}),
            contentType: "application/json",
            success: function () {
                if (typeof updateNotificationBadge === 'function') {
                    updateNotificationBadge();
                }
            },
            error: function (xhr, status, error) {
                console.error("Error clearing notifications:", error);
            }
        });

        // Prevent default browser behavior
        event.preventDefault();
    }
});

// Function to reset wallet address in configuration and clear chart data
function resetWalletAddress() {
    if (confirm("Are you sure you want to reset your wallet address? This will also clear all chart data and redirect you to the configuration page.")) {
        // First clear chart data using the existing API endpoint
        $.ajax({
            url: '/api/reset-chart-data?full=1',
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

// Helper function to format timestamps as readable dates
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: window.dashboardTimezone || DEFAULT_TIMEZONE // Use global timezone setting
    };
    return date.toLocaleString('en-US', options);
}

// Helper function to format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Helper function to format file sizes
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
    else return (bytes / 1048576).toFixed(2) + " MB";
}

// Helper function to create common info items
function createInfoItem(label, value, valueClass = '') {
    const item = $("<div>", { class: "block-info-item" });

    item.append($("<div>", {
        class: "block-info-label",
        text: label
    }));

    item.append($("<div>", {
        class: `block-info-value ${valueClass}`,
        text: value
    }));

    return item;
}

// Helper function for creating detail items
function createDetailItem(label, value, valueClass = '') {
    const item = $("<div>", { class: "block-detail-item" });

    item.append($("<div>", {
        class: "block-detail-label",
        text: label
    }));

    item.append($("<div>", {
        class: `block-detail-value ${valueClass}`,
        text: value
    }));

    return item;
}

// Helper function to show toast messages
function showToast(message) {
    // Check if we already have a toast container
    let toastContainer = $(".toast-container");
    if (toastContainer.length === 0) {
        // Create a new toast container
        toastContainer = $("<div>", {
            class: "toast-container",
            css: {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                zIndex: 9999
            }
        }).appendTo("body");
    }

    // Create a new toast
    const toast = $("<div>", {
        class: "toast",
        text: message,
        css: {
            backgroundColor: "#f7931a",
            color: "#000",
            padding: "10px 15px",
            borderRadius: "5px",
            marginTop: "10px",
            boxShadow: "0 0 10px rgba(247, 147, 26, 0.5)",
            fontFamily: "var(--terminal-font)",
            opacity: 0,
            transition: "opacity 0.3s ease"
        }
    }).appendTo(toastContainer);

    // Show the toast
    setTimeout(() => {
        toast.css("opacity", 1);

        // Hide and remove the toast after the configured time
        setTimeout(() => {
            toast.css("opacity", 0);
            setTimeout(() => toast.remove(), 300);
        }, TOAST_DISPLAY_TIME);
    }, 100);
}

// Pool color mapping function - add this after your existing helper functions
function getPoolColor(poolName) {
    // Normalize the pool name (lowercase and remove special characters)
    const normalizedName = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Define color mappings for common mining pools with Ocean pool featured prominently
    const poolColors = {
        // OCEAN pool with a distinctive bright cyan color for prominence
        'ocean': POOL_CONFIG.oceanColor,
        'oceanpool': POOL_CONFIG.oceanColor,
        'oceanxyz': POOL_CONFIG.oceanColor,
        'ocean.xyz': POOL_CONFIG.oceanColor,

        // Other common mining pools with more muted colors
        'f2pool': '#1a9eff',               // Blue
        'antpool': '#ff7e33',              // Orange
        'binancepool': '#f3ba2f',          // Binance gold
        'foundryusa': '#b150e2',           // Purple
        'viabtc': '#ff5c5c',               // Red
        'luxor': '#2bae2b',                // Green
        'slushpool': '#3355ff',            // Bright blue
        'btccom': '#ff3355',               // Pink
        'poolin': '#ffaa22',               // Amber
        'sbicrypto': '#cc9933',            // Bronze
        'mara': '#8844cc',                 // Violet
        'ultimuspool': '#09c7be',          // Teal
        'unknown': POOL_CONFIG.defaultUnknownColor  // Grey for unknown pools
    };

    // Check for partial matches in pool names (for variations like "F2Pool" vs "F2pool.com")
    for (const [key, color] of Object.entries(poolColors)) {
        if (normalizedName.includes(key)) {
            return color;
        }
    }

    // If no match is found, generate a consistent color based on the pool name
    let hash = 0;
    for (let i = 0; i < poolName.length; i++) {
        hash = poolName.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate HSL color with fixed saturation and lightness for readability
    // Use the hash to vary the hue only (0-360)
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
}

// Function to check if a pool is an Ocean pool
function isOceanPool(poolName) {
    const normalizedName = poolName.toLowerCase();
    return POOL_CONFIG.oceanPools.some(name => normalizedName.includes(name));
}

// Function to create a block card
function createBlockCard(block) {
    const timestamp = formatTimestamp(block.timestamp);
    const formattedSize = formatFileSize(block.size);
    const formattedTxCount = numberWithCommas(block.tx_count);

    // Get the pool name or "Unknown"
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";

    // Get pool color
    const poolColor = getPoolColor(poolName);

    // Check if this is an Ocean pool block for special styling
    const isPoolOcean = isOceanPool(poolName);

    // Calculate total fees in BTC
    const totalFees = block.extras ? (block.extras.totalFees / SATOSHIS_PER_BTC).toFixed(8) : "N/A";

    // Create the block card with accessibility attributes
    const blockCard = $("<div>", {
        class: "block-card",
        "data-height": block.height,
        "data-hash": block.id,
        tabindex: "0", // Make focusable
        role: "button",
        "aria-label": `Block ${block.height} mined by ${poolName} on ${timestamp}`
    });

    // Apply pool color border - with special emphasis for Ocean pool
    if (isPoolOcean) {
        // Give Ocean pool blocks a more prominent styling
        blockCard.css({
            "border": `2px solid ${poolColor}`,
            "box-shadow": `0 0 10px ${poolColor}`,
            "background": `linear-gradient(to bottom, rgba(0, 255, 255, 0.1), rgba(0, 0, 0, 0))`
        });
    } else {
        // Standard styling for other pools
        blockCard.css({
            "border-left": `4px solid ${poolColor}`,
            "border-top": `1px solid ${poolColor}30`,
            "border-right": `1px solid ${poolColor}30`,
            "border-bottom": `1px solid ${poolColor}30`
        });
    }

    // Create the block header
    const blockHeader = $("<div>", {
        class: "block-header"
    });

    blockHeader.append($("<div>", {
        class: "block-height",
        text: "#" + block.height
    }));

    blockHeader.append($("<div>", {
        class: "block-time",
        text: timestamp
    }));

    blockCard.append(blockHeader);

    // Create the block info section
    const blockInfo = $("<div>", {
        class: "block-info"
    });

    // Determine transaction count color based on thresholds
    let txCountClass = "green"; // Default for high transaction counts (2000+)
    if (block.tx_count < 500) {
        txCountClass = "red"; // Less than 500 transactions
    } else if (block.tx_count < 2000) {
        txCountClass = "yellow"; // Between 500 and 1999 transactions
    }

    // Add transaction count using helper
    blockInfo.append(createInfoItem("Transactions", formattedTxCount, txCountClass));

    // Add size using helper
    blockInfo.append(createInfoItem("Size", formattedSize, "white"));

    // Add miner/pool with custom color
    const minerItem = $("<div>", {
        class: "block-info-item"
    });
    minerItem.append($("<div>", {
        class: "block-info-label",
        text: "Miner"
    }));

    // Apply the custom pool color with special styling for Ocean pool
    const minerValue = $("<div>", {
        class: "block-info-value",
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isPoolOcean ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isPoolOcean ? "bold" : "normal"
        }
    });

    // Add a special indicator icon for Ocean pool
    if (isPoolOcean) {
        minerValue.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));
    }

    minerItem.append(minerValue);
    blockInfo.append(minerItem);

    // Add Avg Fee Rate using helper
    const feeRateText = block.extras && block.extras.avgFeeRate ? block.extras.avgFeeRate + " sat/vB" : "N/A";
    blockInfo.append(createInfoItem("Avg Fee Rate", feeRateText, "yellow"));

    blockCard.append(blockInfo);

    // Add event listeners for clicking and keyboard on the block card
    blockCard.on("click", function () {
        showBlockDetails(block);
    });

    blockCard.on("keypress", function (e) {
        if (e.which === 13 || e.which === 32) { // Enter or Space key
            showBlockDetails(block);
        }
    });

    return blockCard;
}

// Function to load blocks from a specific height
function loadBlocksFromHeight(height) {
    if (isLoading) return;

    // Convert to integer
    height = parseInt(height);
    if (isNaN(height) || height < 0) {
        showToast("Please enter a valid block height");
        return;
    }

    isLoading = true;
    currentStartHeight = height;

    // Check if we already have this data in cache
    if (blocksCache[height]) {
        const cached = blocksCache[height];
        displayBlocks(cached.slice(0, BLOCKS_PER_PAGE));
        prepareChartData(cached);
        if (cached.length > 0) {
            updateLatestBlockStats(cached[0]);
        }
        isLoading = false;
        return;
    }

    // Show loading state
    $("#blocks-grid").html('<div class="loader"><span class="loader-text">Loading blocks from height ' + height + '<span class="terminal-cursor"></span></span></div>');

    // Fetch blocks from the API
    fetchMempoolApi(`/api/v1/blocks/${height}`)
        .then(function (data) {
            // Cache the data using helper
            addToCache(height, data);

            // Display the blocks
            displayBlocks(data.slice(0, BLOCKS_PER_PAGE));

            // Update miner distribution chart with up to CHART_BLOCKS_COUNT blocks
            prepareChartData(data);


            // Update latest block stats
            if (data.length > 0) {
                updateLatestBlockStats(data[0]);
            }
        })
        .catch(function (error) {
            console.error("Error fetching blocks:", error);
            $("#blocks-grid").html('<div class="error">Error fetching blocks. Please try again later.</div>');

            // Show error toast
            showToast("Failed to load blocks. Please try again later.");
        })
        .finally(function () {
            isLoading = false;
        });
}

// Function to load the latest blocks and return a promise with the latest block height
function loadLatestBlocks() {
    if (isLoading) return Promise.resolve(null);

    isLoading = true;

    // Show loading state
    $("#blocks-grid").html('<div class="loader"><span class="loader-text">Loading latest blocks<span class="terminal-cursor"></span></span></div>');

    // Fetch the latest blocks from the API
    return fetchMempoolApi(`/api/v1/blocks`).then(function (data) {
            // Cache the data (use the first block's height as the key)
            if (data.length > 0) {
                currentStartHeight = data[0].height;
                latestBlockHeight = data[0].height;
                addToCache(currentStartHeight, data);

                // Update the block height input with the latest height
                $("#block-height").val(currentStartHeight);

                // Update latest block stats
                updateLatestBlockStats(data[0]);
            }

            // Display the blocks
            displayBlocks(data.slice(0, BLOCKS_PER_PAGE));
            // Update miner distribution chart
            prepareChartData(data);

            // Propagate the fetched data to the next promise chain
            return data;
        })
        .catch(function (error) {
            console.error("Error fetching latest blocks:", error);
            $("#blocks-grid").html('<div class="error">Error fetching blocks. Please try again later.</div>');

            // Show error toast
            showToast("Failed to load latest blocks. Please try again later.");

            // Return empty array so downstream handlers receive a consistent value
            return [];
        })
        .finally(function () {
            isLoading = false;
        })
        .then(data => data.length > 0 ? data[0].height : null);
}

// Refresh blocks page every 60 seconds if there are new blocks - with smart refresh
refreshIntervalId = setInterval(function () {
    console.log("Checking for new blocks at " + new Date().toLocaleTimeString());
    loadLatestBlocks().then(latestHeight => {
        if (latestHeight && latestHeight > currentStartHeight) {
            console.log("New blocks detected, loading latest blocks");
            // Instead of reloading the page, just load the latest blocks
            currentStartHeight = latestHeight;
            loadLatestBlocks();
            // Show a notification
            showToast("New blocks detected! View updated.");
        } else {
            console.log("No new blocks detected");
        }
    });
}, REFRESH_INTERVAL);

// Function to update the latest block stats section
function updateLatestBlockStats(block) {
    if (!block) return;

    $("#latest-height").text(block.height);
    $("#latest-time").text(formatTimestamp(block.timestamp));
    $("#latest-tx-count").text(numberWithCommas(block.tx_count));
    $("#latest-size").text(formatFileSize(block.size));
    $("#latest-difficulty").text(numberWithCommas(Math.round(block.difficulty)));

    // Pool info with color coding
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";
    const poolColor = getPoolColor(poolName);
    const isPoolOcean = isOceanPool(poolName);

    // Clear previous content of the pool span
    const poolSpan = $("#latest-pool");
    poolSpan.empty();

    // Create the pool name element with styling
    const poolElement = $("<span>", {
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isPoolOcean ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isPoolOcean ? "bold" : "normal"
        }
    });

    // Add star icon for Ocean pool
    if (isPoolOcean) {
        poolElement.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));
    }

    // Add the styled element to the DOM
    poolSpan.append(poolElement);

    // If this is the latest block from Ocean pool, add a subtle highlight to the stats card
    const statsCard = $(".latest-block-stats").closest(".card");
    if (isPoolOcean) {
        statsCard.css({
            "border": `2px solid ${poolColor}`,
            "box-shadow": `0 0 10px ${poolColor}`,
            "background": `linear-gradient(to bottom, rgba(0, 255, 255, 0.05), rgba(0, 0, 0, 0))`
        });
    } else {
        // Reset to default styling if not Ocean pool
        statsCard.css({
            "border": "",
            "box-shadow": "",
            "background": ""
        });
    }

    // Average Fee Rate
    if (block.extras && block.extras.avgFeeRate) {
        $("#latest-fee-rate").text(block.extras.avgFeeRate + " sat/vB");
    } else {
        $("#latest-fee-rate").text("N/A");
    }
}

// Update the miner distribution chart based on the provided blocks
function updateMinerDistributionChart(blocks) {
    if (!window.Chart || !Array.isArray(blocks)) return;

    const counts = {};
    blocks.forEach(block => {
        const poolName = block.extras && block.extras.pool ? block.extras.pool.name : 'Unknown';
        counts[poolName] = (counts[poolName] || 0) + 1;
    });

    // Group smaller pools under "Other" to keep the chart readable
    const grouped = {};
    const THRESHOLD = 2;
    let otherCount = 0;
    Object.entries(counts).forEach(([name, count]) => {
        if (count < THRESHOLD) {
            otherCount += count;
        } else {
            grouped[name] = count;
        }
    });
    if (otherCount > 0) {
        grouped['Other'] = otherCount;
    }

    const labels = Object.keys(grouped);
    const data   = labels.map(l => grouped[l]);
    const colors = labels.map(l => l === 'Other' ? POOL_CONFIG.defaultUnknownColor : getPoolColor(l));
    const total  = data.reduce((a, b) => a + b, 0);
    const theme  = getCurrentTheme();

    const legendPosition = getLegendPosition();
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
            legend: {
                position: legendPosition,
                labels: { color: theme.PRIMARY }
            },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const value = context.parsed;
                        const percentage = total ? ((value / total) * 100).toFixed(1) : 0;
                        return `${context.label}: ${value} blocks (${percentage}%)`;
                    }
                }
            }
        }
    };

    if (!minerChart) {
        const ctx = document.getElementById('minerChart').getContext('2d');
        minerChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{ data: data, backgroundColor: colors }]
            },
            options: options
        });
    } else {
        minerChart.data.labels = labels;
        minerChart.data.datasets[0].data = data;
        minerChart.data.datasets[0].backgroundColor = colors;
        minerChart.options = { ...minerChart.options, ...options };
        minerChart.update();
    }
}

// Function to display the blocks in the grid
function displayBlocks(blocks) {
    const blocksGrid = $("#blocks-grid");

    // Clear the grid
    blocksGrid.empty();

    if (!blocks || blocks.length === 0) {
        blocksGrid.html('<div class="no-blocks">No blocks found</div>');
        return;
    }

    // Use document fragment for batch DOM operations
    const fragment = document.createDocumentFragment();

    // Create a card for each block
    blocks.forEach(function (block) {
        const blockCard = createBlockCard(block);
        fragment.appendChild(blockCard[0]);
    });

    // Add all cards at once
    blocksGrid.append(fragment);

    // Add navigation controls if needed
    addNavigationControls(blocks);
}

// Function to add navigation controls to the blocks grid
function addNavigationControls(blocks) {
    // Get the height of the first and last block in the current view
    const firstBlockHeight = blocks[0].height;
    const lastBlockHeight = blocks[blocks.length - 1].height;

    // Create navigation controls
    const navControls = $("<div>", {
        class: "block-navigation"
    });

    // Newer blocks button (if not already at the latest blocks)
    if (latestBlockHeight && firstBlockHeight < latestBlockHeight) {
        const newerButton = $("<button>", {
            class: "block-button",
            text: "Newer Blocks",
            "aria-label": "Load newer blocks"
        });

        newerButton.on("click", function () {
            const nextHeight = Math.min(firstBlockHeight + 15, latestBlockHeight);
            loadBlocksFromHeight(nextHeight);
        });

        navControls.append(newerButton);
    }

    // Older blocks button
    const olderButton = $("<button>", {
        class: "block-button",
        text: "Older Blocks",
        "aria-label": "Load older blocks"
    });

    olderButton.on("click", function () {
        loadBlocksFromHeight(lastBlockHeight - 1);
    });

    navControls.append(olderButton);

    // Quick link to jump back to the latest blocks
    if (latestBlockHeight && firstBlockHeight < latestBlockHeight) {
        const latestButton = $("<button>", {
            class: "block-button",
            text: "Latest",
            "aria-label": "Load latest blocks"
        });

        latestButton.on("click", function () {
            loadLatestBlocks();
        });

        navControls.append(latestButton);
    }

    // Add the navigation controls to the blocks grid
    $("#blocks-grid").append(navControls);
}

// Function to show block details in a modal
function showBlockDetails(block) {
    const modal = $("#block-modal");
    const blockDetails = $("#block-details");

    // Clean up previous handlers but keep the chart
    cleanupEventHandlers(true);

    // Re-add scoped handlers
    setupModalKeyboardNavigation();

    // Clear the details
    blockDetails.empty();

    // Format the timestamp
    const timestamp = formatTimestamp(block.timestamp);

    // Create the block header section
    const headerSection = $("<div>", {
        class: "block-detail-section"
    });

    headerSection.append($("<div>", {
        class: "block-detail-title",
        text: "Block #" + block.height
    }));

    // Add block hash
    const hashItem = $("<div>", {
        class: "block-detail-item"
    });
    hashItem.append($("<div>", {
        class: "block-detail-label",
        text: "Block Hash"
    }));
    hashItem.append($("<div>", {
        class: "block-hash",
        text: block.id
    }));
    headerSection.append(hashItem);

    // Add mempool.guide link
    const linkItem = $("<div>", {
        class: "block-detail-item"
    });
    linkItem.append($("<div>", {
        class: "block-detail-label",
        text: "Explorer Link"
    }));

    const mempoolLink = $("<a>", {
        href: `${mempoolLinkBaseUrl}/block/${block.id}`,
        target: "_blank",
        class: "mempool-link",
        text: "View on mempool.guide",
        "aria-label": `View block ${block.height} on mempool.guide (opens in new window)`,
        css: {
            color: "#f7931a",
            textDecoration: "none"
        }
    });

    // Add icon or indicator that it's an external link
    mempoolLink.append($("<span>", {
        html: " ↗",
        css: {
            fontSize: "14px"
        }
    }));

    const linkContainer = $("<div>", {
        class: "block-detail-value"
    });
    linkContainer.append(mempoolLink);
    linkItem.append(linkContainer);

    headerSection.append(linkItem);

    // Add timestamp using helper
    headerSection.append(createDetailItem("Timestamp", timestamp));

    // Add merkle root
    const merkleItem = $("<div>", {
        class: "block-detail-item"
    });
    merkleItem.append($("<div>", {
        class: "block-detail-label",
        text: "Merkle Root"
    }));
    merkleItem.append($("<div>", {
        class: "block-hash",
        text: block.merkle_root
    }));
    headerSection.append(merkleItem);

    // Add previous block hash
    const prevHashItem = $("<div>", {
        class: "block-detail-item"
    });
    prevHashItem.append($("<div>", {
        class: "block-detail-label",
        text: "Previous Block"
    }));
    prevHashItem.append($("<div>", {
        class: "block-hash",
        text: block.previousblockhash
    }));
    headerSection.append(prevHashItem);

    blockDetails.append(headerSection);

    // Create the mining section
    const miningSection = $("<div>", {
        class: "block-detail-section"
    });

    miningSection.append($("<div>", {
        class: "block-detail-title",
        text: "Mining Details"
    }));

    // Add miner/pool with matching color
    const minerItem = $("<div>", {
        class: "block-detail-item"
    });
    minerItem.append($("<div>", {
        class: "block-detail-label",
        text: "Miner"
    }));
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";
    const poolColor = getPoolColor(poolName);
    const isPoolOcean = isOceanPool(poolName);

    // Apply special styling for Ocean pool in the modal
    const minerValue = $("<div>", {
        class: "block-detail-value",
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isPoolOcean ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isPoolOcean ? "bold" : "normal"
        }
    });

    // Add a special indicator icon for Ocean pool
    if (isPoolOcean) {
        minerValue.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));

        // Add a note for Ocean pool
        minerValue.append($("<div>", {
            text: "(Your Mining Pool)",
            css: {
                fontSize: "0.8em",
                marginTop: "3px",
                color: "#ffffffbb"
            }
        }));
    }

    minerItem.append(minerValue);
    miningSection.append(minerItem);

    // Add difficulty with helper
    miningSection.append(createDetailItem(
        "Difficulty",
        numberWithCommas(Math.round(block.difficulty))
    ));

    // Add nonce with helper
    miningSection.append(createDetailItem(
        "Nonce",
        numberWithCommas(block.nonce)
    ));

    // Add bits with helper
    miningSection.append(createDetailItem("Bits", block.bits));

    // Add version with helper
    miningSection.append(createDetailItem(
        "Version",
        "0x" + block.version.toString(16)
    ));

    blockDetails.append(miningSection);

    // Create the transaction section
    const txSection = $("<div>", {
        class: "block-detail-section"
    });

    txSection.append($("<div>", {
        class: "block-detail-title",
        text: "Transaction Details"
    }));

    // Add transaction count with helper
    txSection.append(createDetailItem(
        "Transaction Count",
        numberWithCommas(block.tx_count)
    ));

    // Add size with helper
    txSection.append(createDetailItem(
        "Size",
        formatFileSize(block.size)
    ));

    // Add weight with helper
    txSection.append(createDetailItem(
        "Weight",
        numberWithCommas(block.weight) + " WU"
    ));

    blockDetails.append(txSection);

    // Create the fee section if available
    if (block.extras) {
        const feeSection = $("<div>", {
            class: "block-detail-section"
        });

        feeSection.append($("<div>", {
            class: "block-detail-title",
            text: "Fee Details"
        }));

        // Add total fees with helper
        const totalFees = (block.extras.totalFees / SATOSHIS_PER_BTC).toFixed(8);
        feeSection.append(createDetailItem("Total Fees", totalFees + " BTC"));

        // Add reward with helper
        const reward = (block.extras.reward / SATOSHIS_PER_BTC).toFixed(8);
        feeSection.append(createDetailItem("Block Reward", reward + " BTC"));

        // Add median fee with helper
        feeSection.append(createDetailItem(
            "Median Fee Rate",
            block.extras.medianFee + " sat/vB"
        ));

        // Add average fee with helper
        feeSection.append(createDetailItem(
            "Average Fee",
            numberWithCommas(block.extras.avgFee) + " sat"
        ));

        // Add average fee rate with helper
        feeSection.append(createDetailItem(
            "Average Fee Rate",
            block.extras.avgFeeRate + " sat/vB"
        ));

        // Add fee range with visual representation
        if (block.extras.feeRange && block.extras.feeRange.length > 0) {
            const feeRangeItem = $("<div>", {
                class: "block-detail-item transaction-data"
            });

            feeRangeItem.append($("<div>", {
                class: "block-detail-label",
                text: "Fee Rate Percentiles (sat/vB)"
            }));

            const feeRangeText = $("<div>", {
                class: "block-detail-value",
                text: block.extras.feeRange.join(", ")
            });

            feeRangeItem.append(feeRangeText);

            // Add visual fee bar
            const feeBarContainer = $("<div>", {
                class: "fee-bar-container",
                "aria-label": "Fee rate range visualization"
            });

            const feeBar = $("<div>", {
                class: "fee-bar"
            });

            feeBarContainer.append(feeBar);
            feeRangeItem.append(feeBarContainer);

            // Animate the fee bar
            setTimeout(() => {
                feeBar.css("width", "100%");
            }, 100);

            feeSection.append(feeRangeItem);
        }

        blockDetails.append(feeSection);
    }

    // Show the modal with aria attributes
    modal.attr("aria-hidden", "false");
    modal.css("display", "block");
}

// Function to close the modal
function closeModal() {
    const modal = $("#block-modal");
    modal.css("display", "none");
    modal.attr("aria-hidden", "true");
    cleanupEventHandlers(true);
}
