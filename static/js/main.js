"use strict";

/**
 * main.js - Slim entry point that imports/initializes all modules.
 * 
 * Module load order (via script tags in dashboard.html):
 *   1. utils.js - Formatters, helpers, unit conversions
 *   2. config.js - Global configuration, timezone, thresholds
 *   3. arrow-indicator.js - Metric change indicators
 *   4. block-annotations.js - Chart block/day annotations
 *   5. chart-manager.js - Chart.js setup, config, updates
 *   6. payout-tracker.js - Payout tracking, history, verification
 *   7. sse-client.js - SSE connection, reconnection, events
 *   8. metrics-display.js - DOM updates, block checks, notifications
 *   9. main.js - updateUI + document.ready initialization (this file)
 */

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
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: flex-end;
        }
        
        .metric-divider {
            display: inline-flex;
            align-items: center;
            margin-left: auto;
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
        .sparkline {
            width: 60px;
            height: 16px;
            margin-left: 0.5rem;
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
    function updateVarianceDivider(metricId, varianceId, varianceValue, formatFn, progress) {
        const metricEl = document.getElementById(metricId);
        if (!metricEl) {
            return;
        }
        const para = metricEl.parentNode;
        ensureElementStyles();

        if (!para.querySelector('.main-metric')) {
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
            if (progress !== undefined && progress !== null) {
                formatted = `Loading... ${progress}%`;
            } else {
                formatted = 'Loading...';
            }
        } else if (typeof formatFn === 'function') {
            formatted = formatFn(varianceValue);
        } else {
            formatted = (varianceValue >= 0 ? '+' : '') +
                numberWithCommas(Math.round(varianceValue)) + ' SATS';
        }

        // Determine color class similar to pool luck styling
        let colorClass = 'normal-luck';
        if (!needsData) {
            if (varianceValue > 0) {
                colorClass = 'lucky';
            } else if (varianceValue < 0) {
                colorClass = 'unlucky';
            }
        }

        const existing = document.getElementById(varianceId);
        if (existing) {
            existing.textContent = formatted;
            existing.className = 'metric-value metric-divider-value ' + colorClass;
            if (needsData) {
                existing.setAttribute('title', 'Variance requires about 3 hours of data');
            } else {
                existing.removeAttribute('title');
            }
        } else {
            const div = createDivider(varianceId, formatted, '[3hr \u0394]', colorClass);
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
            const poolHashrate = document.getElementById("pool_total_hashrate");
            if (!poolHashrate) {
                return;
            }
            const poolHashratePara = poolHashrate.parentNode;

            // Ensure grid layout and structure
            ensureElementStyles();

            // Structure parent for proper grid layout (similar to the other metrics)
            if (!poolHashratePara.querySelector('.main-metric')) {
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

                // Update the text and styling with tighter spacing
                poolFeesSats.textContent = "(" + formattedPoolFee + ")";
                poolFeesSats.setAttribute(
                    "style",
                    "color: #ff5555 !important; font-weight: bold !important; margin-left: 4px; display: inline;"
                );
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
        const hashrate24hr = document.getElementById("hashrate_24hr");
        if (!hashrate24hr) {
            return;
        }
        const hashrate24hrPara = hashrate24hr.parentNode;

        // Structure parent for proper grid layout
        if (!hashrate24hrPara.querySelector('.main-metric')) {
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
        const hashrate3hr = document.getElementById("hashrate_3hr");
        if (!hashrate3hr) {
            return;
        }
        const hashrate3hrPara = hashrate3hr.parentNode;

        // Structure parent for proper grid layout
        if (!hashrate3hrPara.querySelector('.main-metric')) {
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

        if (lastBlockNumber === null || data.block_number !== lastBlockNumber) {
            lastBlockNumber = data.block_number;
            lastBlockTime = Date.now();
            try {
                localStorage.setItem('dashboardLastBlockNumber', lastBlockNumber.toString());
                localStorage.setItem('dashboardLastBlockTime', lastBlockTime.toString());
            } catch (e) {
                console.error('Error saving block timer to localStorage:', e);
            }
        }

        (function updateBlockTimerUI() {
            const blockEl = document.getElementById('block_number');
            if (!blockEl) {
                return;
            }
            const para = blockEl.parentNode;
            ensureElementStyles();

            if (!para.querySelector('.main-metric')) {
                const metricEl = blockEl;
                const indicatorEl = document.getElementById('indicator_block_number');
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

            const elapsed = lastBlockTime ? Math.floor((Date.now() - lastBlockTime) / 1000) : 0;
            const formatted = formatDuration(elapsed);
            const colorClass = getBlockTimerClass(elapsed);
            const existing = document.getElementById('block_timer');
            if (existing) {
                existing.textContent = formatted;
                existing.className = 'metric-value metric-divider-value ' + colorClass;
            } else {
                const div = createDivider('block_timer', formatted, '[Block Timer]', colorClass);
                container.appendChild(div);
            }
        })();

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

        if (data.network_hashrate_variance_3hr !== undefined) {
            updateVarianceDivider(
                "network_hashrate",
                "variance_network_hashrate",
                data.network_hashrate_variance_3hr,
                function(v) {
                    const sign = v >= 0 ? '+' : '';
                    const abs = Math.abs(v);
                    if (abs >= 1000) {
                        return sign + (abs / 1000).toFixed(2) + ' ZH/s';
                    }
                    return sign + numberWithCommas(Math.round(abs)) + ' EH/s';
                },
                data.network_hashrate_variance_progress
            );
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
        if (data.power_usage_estimated) {
            updateElementText("daily_power_cost", "Calculating...");
        } else if (data.daily_power_cost != null) {
            const dailyPowerCost = data.daily_power_cost;
            updateElementText("daily_power_cost", formatCurrencyValue(dailyPowerCost, currency));
        } else {
            updateElementText("daily_power_cost", formatCurrencyValue(0, currency));
        }

        // Break-even electricity price divider
        const bePrice = data.break_even_electricity_price;
        let formattedBe;
        if (data.power_usage_estimated || bePrice == null) {
            formattedBe = 'Calculating...';
        } else {
            formattedBe = formatCurrencyValue(bePrice, currency) + '/kWh';
        }

        const metricElPower = document.getElementById('daily_power_cost');
        if (!metricElPower) {
            return;
        }
        const powerCostPara = metricElPower.parentNode;
        ensureElementStyles();
        if (!powerCostPara.querySelector('.main-metric')) {
            const metricEl = metricElPower;
            const indicatorEl = document.getElementById('indicator_daily_power_cost');
            const mainMetric = document.createElement('span');
            mainMetric.className = 'main-metric';
            if (metricEl && indicatorEl) {
                let node = metricEl.nextSibling;
                while (node && node !== indicatorEl) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) {
                        powerCostPara.removeChild(node);
                    }
                    node = nextNode;
                }
                metricEl.parentNode.insertBefore(mainMetric, metricEl);
                mainMetric.appendChild(metricEl);
                mainMetric.appendChild(indicatorEl);
            }
            const dividerContainer = document.createElement('span');
            dividerContainer.className = 'metric-divider-container';
            powerCostPara.appendChild(dividerContainer);
        }

        let beContainer = powerCostPara.querySelector('.metric-divider-container');
        if (!beContainer) {
            beContainer = document.createElement('span');
            beContainer.className = 'metric-divider-container';
            powerCostPara.appendChild(beContainer);
        }

        const existingBe = document.getElementById('break_even_price');
        if (existingBe) {
            existingBe.textContent = formattedBe;
        } else {
            const beDiv = createDivider('break_even_price', formattedBe, '[Break-Even]');
            beContainer.appendChild(beDiv);
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
                data.estimated_earnings_per_day_sats_variance_3hr,
                null,
                data.estimated_earnings_per_day_sats_variance_progress
            );
        }
        if (data.estimated_earnings_next_block_sats_variance_3hr !== undefined) {
            updateVarianceDivider(
                "estimated_earnings_next_block_sats",
                "variance_earnings_block",
                data.estimated_earnings_next_block_sats_variance_3hr,
                null,
                data.estimated_earnings_next_block_sats_variance_progress
            );
        }
        if (data.estimated_rewards_in_window_sats_variance_3hr !== undefined) {
            updateVarianceDivider(
                "estimated_rewards_in_window_sats",
                "variance_rewards_window",
                data.estimated_rewards_in_window_sats_variance_3hr,
                null,
                data.estimated_rewards_in_window_sats_variance_progress
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

        if (window.SparklineModule) {
            SparklineModule.updateSparklines(data);
        }
        // Add this call before storing current metrics as previous metrics
        trackPayoutPerformance(data);

        // Store current metrics for next comparison
        previousMetrics = { ...data };

    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

// Update unread notifications badge in navigation with animation effects


// Add keyboard event listener for Alt+W to reset wallet address
$(document).keydown(function (event) {
    // Check if Alt+W is pressed (key code 87 is 'W')
    if (event.altKey && event.keyCode === 87) {
        resetWalletAddress();
        $.ajax({
            url: "/api/notifications/clear",
            method: "POST",
            data: JSON.stringify({
                include_block: true
            }),
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
        if (window.SparklineModule) {
            try {
                SparklineModule.initSparklines();
            } catch (err) {
                console.error("Error initializing sparklines:", err);
            }
        }
    } catch (e) {
        console.error("Error handling theme:", e);
    }

    // Initialize chart points preference from localStorage
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
    updateChartPointsButtons();

    // Modify the initializeChart function to use blue colors for the chart

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

    // Live block timer update every second
    blockTimerInterval = setInterval(updateBlockTimerValue, 1000);

    // Add manual refresh button and style it based on theme
    $("body").append('<button id="refreshButton" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; border: none; padding: 8px 16px; display: none; cursor: pointer;">Refresh Data</button>');

    const theme = getCurrentTheme();
    const refreshTextColor = theme === THEME.DEEPSEA ? '#ffffff' : '#000000';
    $("#refreshButton").css({
        'background-color': theme.PRIMARY,
        'color': refreshTextColor
    });

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

// Note: beforeunload listener for SSE cleanup is in sse-client.js
