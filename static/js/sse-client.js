"use strict";

/**
 * sse-client.js - SSE connection, reconnection, event handling, and manual refresh
 */

let connectionRetryCount = 0;
let maxRetryCount = 10;
let reconnectionDelay = 1000; // Start with 1 second
let pingInterval = null;
let lastPingTime = Date.now();
let connectionLostTimeout = null;

// Cleanup the existing SSE connection and related timers
function cleanupEventSource() {
    if (window.eventSource) {
        console.log("Closing existing EventSource connection");
        try {
            window.eventSource.close();
        } catch (err) {
            console.error("Error closing EventSource", err);
        }
        window.eventSource = null;
    }

    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }

    if (connectionLostTimeout) {
        clearTimeout(connectionLostTimeout);
        connectionLostTimeout = null;
    }
}

// SSE Connection with Error Handling and Reconnection Logic
function setupEventSource() {
    console.log("Setting up EventSource connection...");

    cleanupEventSource();

    if (window.eventSource) {
        console.log("Closing existing EventSource connection");
        window.eventSource.close();
        window.eventSource = null;
    }

    // Reload chart points preference in case the variable was reset
    try {
        const storedPreference = localStorage.getItem('chartPointsPreference');
        if (storedPreference) {
            if (storedPreference === 'Infinity' || storedPreference === 'all') {
                chartPoints = Infinity;
            } else {
                const points = parseInt(storedPreference, 10);
                if ([30, 60, 180].includes(points)) {
                    chartPoints = points;
                }
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
        // Ensure payout history is up to date
        verifyPayoutsAgainstOfficial();
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

    // Show manual refresh button with theme color and appropriate text color
    const textColor = theme === THEME.DEEPSEA ? '#ffffff' : '#000000';
    $("#refreshButton").css({
        'background-color': theme.PRIMARY,
        'color': textColor
    }).show();
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
            // Refresh payout history from the earnings API
            verifyPayoutsAgainstOfficial();
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

// Ensure SSE connection is closed when navigating away
window.addEventListener('beforeunload', cleanupEventSource);
