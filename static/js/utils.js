"use strict";

/**
 * utils.js - Utility functions: formatters, helpers, unit conversions
 */

// Default timezone constant (also defined in blocks.js for the blocks page)
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

// Hashrate Normalization Utilities
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

// Helper function to safely format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
        return "Never";
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
    return formattedLuck;
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

// Utility to format x-axis labels based on the time span of data
function formatChartLabels(labelTimestamps, timeZone) {
    const timeSpanMinutes = (labelTimestamps[labelTimestamps.length - 1].getTime() -
        labelTimestamps[0].getTime()) / 60000;

    const useExtendedLabels = timeSpanMinutes >= 1440;

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        month: 'short',
        day: 'numeric'
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const labels = labelTimestamps.map(ts => {
        const base = timeFormatter.format(ts).replace(/\s[AP]M$/i, '');
        if (useExtendedLabels) {
            return `${dateFormatter.format(ts)}\n${base}`;
        }
        return base;
    });

    return { labels, useExtendedLabels };
}

if (typeof window !== 'undefined') {
    window.formatChartLabels = formatChartLabels;
}

// --- Block timer helpers ---
function formatDuration(seconds) {
    if (seconds < 0) {
        seconds = 0;
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function getBlockTimerClass(seconds) {
    if (seconds < 8 * 60) {
        return 'very-lucky';
    } else if (seconds < 10 * 60) {
        return 'lucky';
    } else if (seconds <= 12 * 60) {
        return 'normal-luck';
    }
    return 'unlucky';
}

// Function to format BTC values consistently
function formatBTC(btcValue) {
    return parseFloat(btcValue).toFixed(8);
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
