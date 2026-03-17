"use strict";

/**
 * metrics-display.js - Hashrate/earnings/pool stats DOM updates, block updates,
 * congrats messages, sound effects, notification badge, wallet reset, and hashrate notices
 */

// Global variables
let previousMetrics = {};
let latestMetrics = null;
let initialLoad = true;
let trendData = [];
let trendLabels = [];
let trendChart = null;

// Server time variables for uptime calculation
let serverTimeOffset = 0;
let serverStartTime = null;

// Track block timing for network block intervals
let lastBlockNumber = null;
let lastBlockTime = null;
let blockTimerInterval = null;

// Restore last block timer info from localStorage so the timer persists
try {
    const storedTime = localStorage.getItem('dashboardLastBlockTime');
    if (storedTime) {
        const parsedTime = parseInt(storedTime, 10);
        if (!isNaN(parsedTime)) {
            lastBlockTime = parsedTime;
        }
    }

    const storedNumber = localStorage.getItem('dashboardLastBlockNumber');
    if (storedNumber) {
        const parsedNumber = parseInt(storedNumber, 10);
        if (!isNaN(parsedNumber)) {
            lastBlockNumber = parsedNumber;
        }
    }
} catch (e) {
    console.error('Error loading block timer from localStorage:', e);
}

function updateBlockTimerValue() {
    if (!lastBlockTime) {
        return;
    }
    const elapsed = Math.floor((Date.now() - lastBlockTime) / 1000);
    const timerEl = document.getElementById('block_timer');
    if (timerEl) {
        timerEl.textContent = formatDuration(elapsed);
        timerEl.className = 'metric-value metric-divider-value ' + getBlockTimerClass(elapsed);
    }
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

        // Update DATUM GATEWAY status icon
        if (latestMetrics.pool_fees_percentage !== undefined && latestMetrics.pool_fees_percentage >= 0.9 && latestMetrics.pool_fees_percentage <= 1.3) {
            updateElementHTML("datum_status", "<span class='status-green'>CONNECTED</span> <i class='fa-solid fa-satellite-dish satellite-dish satellite-dish-connected'></i>");
        } else {
            updateElementHTML("datum_status", "<span class='status-red'>OFFLINE</span> <i class='fa-solid fa-plug-circle-xmark datum-plug datum-plug-offline'></i>");
        }
    }
}

// Check for block updates and show congratulatory messages
function checkForBlockUpdates(data) {
    if (previousMetrics.last_block_height !== undefined &&
        data.last_block_height !== previousMetrics.last_block_height) {
        showCongrats("Congrats! New Block Found: " + data.last_block_height);
        playBlockSound();
        if (trendChart && trendChart.data && trendChart.data.labels.length > 0) {
            const ts = new Date().toISOString();
            blockAnnotations.push(ts);
            saveBlockAnnotations(chartPoints);
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
    }, 30000); // 30 seconds display time

    // Add click to dismiss
    $congrats.off('click').on('click', function () {
        $(this).fadeOut(500);
    });
}

// Play celebratory audio when a new block is found
function playBlockSound() {
    const audioSrc = '/static/audio/block.mp3';
    const blockAudio = new Audio(audioSrc);
    const bgAudio = document.getElementById('backgroundAudio');
    let originalVolume = null;

    if (bgAudio && !bgAudio.muted && !bgAudio.paused) {
        originalVolume = bgAudio.volume;
        bgAudio.volume = Math.max(0, originalVolume * 0.3);
    }

    const restoreVolume = () => {
        if (originalVolume !== null && bgAudio) {
            bgAudio.volume = originalVolume;
        }
    };

    blockAudio.addEventListener('ended', restoreVolume);
    blockAudio.addEventListener('error', restoreVolume);

    blockAudio.play().catch(restoreVolume);
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

// Initialize notification badge checking
function initNotificationBadge() {
    // Update immediately
    updateNotificationBadge();

    // Update every 60 seconds
    setInterval(updateNotificationBadge, 60000);
}

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
