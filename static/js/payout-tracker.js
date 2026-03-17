"use strict";

/**
 * payout-tracker.js - Payout tracking, history, and verification
 */

// Add this to the top of main.js with other global variables
let lastPayoutTracking = {
    lastUnpaidEarnings: null,
    payoutHistory: [],
    avgDays: null
};

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
            status: 'pending',
            lightningId: ''
        };

        add_payout_record(payoutRecord);
        displayPayoutComparison(payoutRecord);
    }

    lastPayoutTracking.lastUnpaidEarnings = currentUnpaidEarnings;
}

// Deprecated: average payout interval is now sourced from the earnings API
// and no longer calculated from local history.
function updateAvgDaysFromHistory() {
    // This function intentionally left blank.
}


// Update the displayPayoutComparison function to use better formatting
function displayPayoutComparison(comparison) {

    // Update the UI with the latest payout comparison
    const payoutInfoCard = $("#payoutMiscCard .card-body");

    // Remove old comparison element if exists
    $("#payout-comparison").remove();

    // Skip displaying the line entirely when Matrix theme is active
    const useMatrix = localStorage.getItem('useMatrixTheme') === 'true';
    if (useMatrix) {
        return;
    }

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
            sanitizePayoutHistory();
        }
    } catch (e) {
        console.error("Error loading payout history from localStorage:", e);
    }
}

function sanitizePayoutHistory() {
    if (!Array.isArray(lastPayoutTracking.payoutHistory)) {
        lastPayoutTracking.payoutHistory = [];
        return;
    }
    let changed = false;
    lastPayoutTracking.payoutHistory = lastPayoutTracking.payoutHistory.filter(entry => {
        const date = new Date(entry.timestamp);
        if (isNaN(date) || entry.amountBTC === undefined) {
            changed = true;
            return false;
        }
        entry.timestamp = date;
        entry.amountBTC = parseFloat(entry.amountBTC);
        return true;
    });
    if (changed) {
        try {
            localStorage.setItem('payoutHistory', JSON.stringify(lastPayoutTracking.payoutHistory));
        } catch (e) {
            console.error('Error saving sanitized payout history:', e);
        }
    }
}

function save_payout_history() {
    try {
        localStorage.setItem('payoutHistory', JSON.stringify(lastPayoutTracking.payoutHistory));
        fetch('/api/payout-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: lastPayoutTracking.payoutHistory })
        });
    } catch (e) {
        console.error('Error saving payout history:', e);
    }
}

function add_payout_record(record) {
    lastPayoutTracking.payoutHistory.unshift(record);
    if (lastPayoutTracking.payoutHistory.length > 30) {
        lastPayoutTracking.payoutHistory = lastPayoutTracking.payoutHistory.slice(0, 30);
    }
    save_payout_history();
}

function get_latest_payout() {
    return lastPayoutTracking.payoutHistory && lastPayoutTracking.payoutHistory[0] ?
        lastPayoutTracking.payoutHistory[0] : null;
}

function format_payout_html(payout) {
    if (!payout) {
        return '<p class="text-muted">No payout information available.</p>';
    }

    const theme = getCurrentTheme();
    const payoutDate = formatPayoutDate(payout.timestamp);
    const btcAmount = formatBTC(payout.amountBTC);

    let fiatValueStr = 'N/A';
    if (payout.amountBTC !== undefined) {
        const currency = latestMetrics?.currency || 'USD';
        const btcPrice = latestMetrics?.btc_price || 0;
        if (btcPrice > 0) {
            const fiatValue = parseFloat(payout.amountBTC) * btcPrice;
            const symbol = getCurrencySymbol(currency);
            fiatValueStr = `${symbol}${numberWithCommas(fiatValue.toFixed(2))}`;
        } else if (payout.fiat_value !== undefined && payout.rate !== undefined) {
            const symbol = getCurrencySymbol(currency);
            fiatValueStr = `${symbol}${numberWithCommas(payout.fiat_value.toFixed(2))}`;
        }
    }

    let txLink = '';
    if (payout.officialId) {
        txLink += `<a href="https://mempool.guide/tx/${payout.officialId}" target="_blank" class="btn btn-sm btn-secondary ms-2" style="font-size: 12px; width: 90px;" title="View transaction on mempool.guide"><i class="fa-solid fa-external-link-alt"></i> View TX</a>`;
    }
    if (payout.lightningId) {
        txLink += `<a href="https://ocean.xyz/info/tx/lightning/${payout.lightningId}" target="_blank" class="btn btn-sm btn-secondary ms-2" style="font-size: 12px; width: 90px;" title="View Lightning transaction"><i class="fa-solid fa-bolt"></i> LN TX</a>`;
    }

    const interval = lastPayoutTracking.avgDays ? `${lastPayoutTracking.avgDays.toFixed(2)} days` : 'N/A';
    const statusDisplay = payout.status || 'pending';
    const statusClass = payout.verified ? 'green' : 'yellow';

    return `
        <div style="font-size: 14px;">
            <div style="display: flex; justify-content: center;">
                <div style="width: 100%; max-width: 200px;">
                    <p><strong>Date:</strong> <span class="metric-value white">${payoutDate}</span></p>
                    <p><strong>Amount:</strong> <span class="metric-value yellow">${btcAmount} BTC</span></p>
                    <p><strong>Fiat Value:</strong> <span class="metric-value green">${fiatValueStr}</span></p>
                    <p><strong>Last Payout Interval:</strong> <span class="metric-value yellow">${interval}</span></p>
                    <p><strong>Status:</strong> <span class="metric-value ${statusClass}">${statusDisplay}</span> ${txLink}</p>
                </div>
            </div>
        </div>`;
}

// Fetch the latest payment from the earnings API
async function fetchLatestPayment() {
    try {
        const res = await fetch('/api/earnings');
        const data = await res.json();
        if (data && Array.isArray(data.payments) && data.payments.length > 0) {
            return data.payments[0];
        }
    } catch (e) {
        console.error('Failed to fetch latest payment:', e);
    }
    return null;
}

// Update payout history using the latest earnings data then invoke callback
async function refreshPayoutHistoryFromEarnings(callback) {
    try {
        const payment = await fetchLatestPayment();
        if (payment) {
            const record = {
                timestamp: new Date(payment.date_iso || payment.date),
                amountBTC: payment.amount_btc,
                verified: true,
                officialId: payment.txid || '',
                lightningId: payment.lightning_txid || '',
                status: payment.status || 'confirmed'
            };
            if (payment.rate) {
                record.rate = payment.rate;
                record.fiat_value = payment.amount_btc * payment.rate;
            }
            const first = get_latest_payout();
            const newTime = record.timestamp.toISOString();
            const firstTime = first ? new Date(first.timestamp).toISOString() : null;
            if (!first || firstTime !== newTime || parseFloat(first.amountBTC) !== parseFloat(record.amountBTC)) {
                add_payout_record(record);
            }
        }
    } finally {
        if (typeof callback === 'function') callback();
    }
}

// Update the init function to add the summary display
function initPayoutTracking() {
    loadPayoutHistory();

    // Add a button to view payout history with theme-aware styling
    const theme = getCurrentTheme();
    const useMatrix = localStorage.getItem('useMatrixTheme') === 'true';
    const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true' && !useMatrix;

    // Create button with theme-aware text color
    const viewHistoryButton = $("<button>", {
        id: "view-payout-history",
        text: "VIEW LAST PAYOUT",
        click: togglePayoutHistoryDisplay,
        class: "btn btn-sm mt-2 d-block",
        style: `
            background-color: ${theme.PRIMARY};
            color: ${isDeepSea ? 'white' : 'black'};
            border-radius: 0;
            font-style: bold;
        `
    });

    const viewHistoryWrapper = $("<p>", {
        id: "last-payout-btn-wrapper",
        class: "mt-2 mb-0"
    }).append(viewHistoryButton);

    $("#est_time_to_payout").parent().after(viewHistoryWrapper);

    // Create a container for the payout history (initially hidden)
    $("<div>", {
        id: "payout-history-container",
        style: "display: none; margin-top: 10px;"
    }).insertAfter(viewHistoryWrapper);

    // Update theme-change listener for the button with fixed colors for each theme
    $(document).on('themeChanged', function () {
        const updatedTheme = getCurrentTheme();
        const matrixActive = localStorage.getItem('useMatrixTheme') === 'true';
        const isDeepSeaActive = localStorage.getItem('useDeepSeaTheme') === 'true' && !matrixActive;

        $("#view-payout-history").css({
            'background-color': updatedTheme.PRIMARY,
            // Use black text for Matrix and Bitcoin themes
            'color': isDeepSeaActive ? 'white' : 'black'
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
        // Show loading message while fetching data
        showPayoutLoading();

        // Show the container and update button text
        container.slideDown();
        button.text("HIDE LAST PAYOUT");

        // Refresh history from earnings API then display summary
        refreshPayoutHistoryFromEarnings(displayPayoutSummary);
    }
}

// Enhanced function to display complete payout summary information
function displayPayoutSummary() {
    const container = $("#payout-history-container");
    const theme = getCurrentTheme();
    container.empty();

    const summaryElement = $(
        `<div id="payout-summary" class="mb-3 p-2">
            <h6 style="color:${theme.PRIMARY};margin-bottom:8px; font-weight: bold; font-size: 18px; text-align: center;">Last Payout Summary</h6>
            <div id="summary-content"></div>
        </div>`
    );

    const contentArea = summaryElement.find('#summary-content');
    const latest = get_latest_payout();
    contentArea.html(format_payout_html(latest));

    container.append(summaryElement);

    const viewMoreLink = $("<div class='text-center'></div>");
    const matrixActive = localStorage.getItem('useMatrixTheme') === 'true';
    const isDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true' && !matrixActive;
    viewMoreLink.html(
        `<a href='/earnings' class='btn btn-sm' style='background-color:${theme.PRIMARY};color:${isDeepSea ? 'white' : 'black'};'>
            Complete Payout History
        </a>`
    );
    container.append(viewMoreLink);
}

// Display a loading message in the payout history container
function showPayoutLoading() {
    const container = $('#payout-history-container');
    container.html(
        "<div class='loading-message'>Loading payout summary<span class='terminal-cursor'></span></div>"
    );
}

// Enhanced function to verify and enrich payout history with data from earnings
async function verifyPayoutsAgainstOfficial() {
    sanitizePayoutHistory();
    try {
        const res = await fetch('/api/earnings');
        const data = await res.json();
        if (!data || !data.payments || !data.payments.length) return;

        lastPayoutTracking.avgDays =
            (data.avg_days_between_payouts !== undefined && data.avg_days_between_payouts !== null)
                ? data.avg_days_between_payouts
                : null;

        const officialPayments = data.payments.sort((a, b) =>
            new Date(b.date_iso || b.date) - new Date(a.date_iso || a.date)
        );

        const detectedPayouts = lastPayoutTracking.payoutHistory;

        detectedPayouts.forEach(detectedPayout => {
            const payoutDate = new Date(detectedPayout.timestamp);

            const matchingPayment = officialPayments.find(payment => {
                const paymentDate = new Date(payment.date_iso || payment.date);
                return Math.abs(paymentDate - payoutDate) < (2 * 60 * 60 * 1000) &&
                    Math.abs(parseFloat(payment.amount_btc) - parseFloat(detectedPayout.amountBTC)) < 0.00001;
            });

            if (matchingPayment) {
                detectedPayout.verified = true;
                detectedPayout.officialId = matchingPayment.txid || '';
                detectedPayout.lightningId = matchingPayment.lightning_txid || '';
                detectedPayout.status = matchingPayment.status || 'confirmed';

                if (matchingPayment.rate) {
                    detectedPayout.rate = matchingPayment.rate;
                    detectedPayout.fiat_value = parseFloat(detectedPayout.amountBTC) * matchingPayment.rate;
                }
            } else {
                detectedPayout.verified = false;
            }
        });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        officialPayments.forEach(payment => {
            const paymentDate = new Date(payment.date_iso || payment.date);
            if (paymentDate < thirtyDaysAgo) return;

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
                    lightningId: payment.lightning_txid || '',
                    status: payment.status || 'confirmed',
                    officialRecordOnly: true
                };

                if (payment.rate) {
                    syntheticPayout.rate = payment.rate;
                    syntheticPayout.fiat_value = parseFloat(payment.amount_btc) * payment.rate;
                }

                lastPayoutTracking.payoutHistory.push(syntheticPayout);
            }
        });

        lastPayoutTracking.payoutHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (lastPayoutTracking.payoutHistory.length > 30) {
            lastPayoutTracking.payoutHistory = lastPayoutTracking.payoutHistory.slice(0, 30);
        }

        if ($("#payout-history-container").is(":visible")) {
            displayPayoutSummary();
        }

        save_payout_history();
    } catch (error) {
        console.error("Failed to fetch earnings data:", error);
    }
}
