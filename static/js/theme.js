// Add this flag at the top of your file, outside the function
let isApplyingTheme = false;

// Bitcoin Orange theme (default)
const BITCOIN_THEME = {
    PRIMARY: '#f2a900',
    PRIMARY_RGB: '242, 169, 0',
    SHARED: {
        GREEN: '#32CD32',
        RED: '#ff5555',
        YELLOW: '#ffd700'
    },
    CHART: {
        GRADIENT_START: '#f2a900',
        GRADIENT_END: 'rgba(242, 169, 0, 0.2)',
        ANNOTATION: '#ffd700',
        BLOCK_EVENT: '#00ff00'
    }
};

// DeepSea theme (blue alternative)
const DEEPSEA_THEME = {
    PRIMARY: '#0088cc',
    PRIMARY_RGB: '0, 136, 204',
    SHARED: {
        GREEN: '#32CD32',
        RED: '#ff5555',
        YELLOW: '#ffd700'
    },
    CHART: {
        GRADIENT_START: '#0088cc',
        GRADIENT_END: 'rgba(0, 136, 204, 0.2)',
        ANNOTATION: '#00b3ff',
        BLOCK_EVENT: '#00ff00'
    }
};

// Global theme constants
const THEME = {
    BITCOIN: BITCOIN_THEME,
    DEEPSEA: DEEPSEA_THEME,
    SHARED: BITCOIN_THEME.SHARED
};

// Function to get the current theme based on localStorage setting
function getCurrentTheme() {
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    return useDeepSea ? DEEPSEA_THEME : BITCOIN_THEME;
}

// Make globals available
window.THEME = THEME;
window.getCurrentTheme = getCurrentTheme;

// Use window-scoped variable to prevent conflicts
window.themeProcessing = false;

// Function to update the dashboard header for theme changes
function updateDashboardDataText(useDeepSea) {
    try {
        const headerElement = document.querySelector('h1.text-center');
        if (headerElement) {
            // Get the anchor element inside the h1 (this contains the visible text)
            const anchorElement = headerElement.querySelector('a');
            if (!anchorElement) return;

            // Get the current header text
            let headerText = anchorElement.textContent.trim();
            let newHeaderText;

            // If switching to DeepSea theme, replace Bitcoin references
            if (useDeepSea) {
                newHeaderText = headerText.replace("BTC-OS", "DeepSea");
                newHeaderText = newHeaderText.replace("BITCOIN", "DEEPSEA");
            } else {
                // If switching back to Bitcoin theme, restore original names
                newHeaderText = headerText.replace("DeepSea", "BTC-OS");
                newHeaderText = newHeaderText.replace("DEEPSEA", "BTC-OS");
            }

            // Update the visible text content
            anchorElement.textContent = newHeaderText;

            // Update the data-text attribute with the modified text
            if (headerElement.hasAttribute('data-text')) {
                headerElement.setAttribute('data-text', newHeaderText);
            }

            // Update page title too
            if (document.title.includes("Dashboard")) {
                if (useDeepSea) {
                    document.title = document.title.replace("BTC-OS", "DeepSea");
                } else {
                    document.title = document.title.replace("DeepSea", "BTC-OS");
                }
            }

            console.log(`Header updated to: ${newHeaderText}`);
        }
    } catch (e) {
        console.error("Error updating dashboard data-text:", e);
    }
}

// Fixed applyDeepSeaTheme function with recursion protection
function applyDeepSeaTheme() {
    // Check if we're already applying the theme to prevent recursion
    if (window.themeProcessing) {
        console.log("Theme application already in progress, avoiding recursion");
        return;
    }

    // Set the guard flag
    isApplyingTheme = true;

    try {
        console.log("Applying DeepSea theme...");

        // Update the data-text attribute for DeepSea theme
        updateDashboardDataText(true);

        // Create or update CSS variables for the DeepSea theme
        const styleElement = document.createElement('style');
        styleElement.id = 'deepSeaThemeStyles'; // Give it an ID so we can check if it exists

        // Enhanced CSS with clean, organized structure
        styleElement.textContent = `
            /* Base theme variables */
            :root {
                --primary-color: #0088cc;
                --primary-color-rgb: 0, 136, 204;
                --accent-color: #00b3ff;
                --bg-gradient: linear-gradient(135deg, #0a0a0a, #131b20);
            }
        
            /* Card styling */
            .card {
                border: 1px solid var(--primary-color) !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.3) !important;
            }
            
            .card-header, .card > .card-header {
                background: linear-gradient(to right, var(--primary-color), #006699) !important;
                border-bottom: 1px solid var(--primary-color) !important;
                color: #fff !important;
            }
            
            /* Navigation */
            .nav-link {
                border: 1px solid var(--primary-color) !important;
                color: var(--primary-color) !important;
            }
            
            .nav-link:hover, .nav-link.active {
                background-color: var(--primary-color) !important;
                color: #fff !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
            
            /* Interface elements */
            #terminal-cursor {
                background-color: var(--primary-color) !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.8) !important;
            }
            
            #lastUpdated {
                color: var(--primary-color) !important;
            }
            
            h1, .text-center h1 {
                color: var(--primary-color) !important;
            }
            
            .nav-badge {
                background-color: var(--primary-color) !important;
            }
            
            /* Bitcoin progress elements */
            .bitcoin-progress-inner {
                background: linear-gradient(90deg, var(--primary-color), var(--accent-color)) !important;
            }
            
            .bitcoin-progress-container {
                border: 1px solid var(--primary-color) !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
            
            /* Theme toggle button styling */
            #themeToggle, button.theme-toggle, .toggle-theme-btn {
                background: transparent !important;
                border: 1px solid var(--primary-color) !important;
                color: var(--primary-color) !important;
                transition: all 0.3s ease !important;
            }
            
            #themeToggle:hover, button.theme-toggle:hover, .toggle-theme-btn:hover {
                background-color: rgba(var(--primary-color-rgb), 0.1) !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.3) !important;
            }
            
            /* ===== SPECIAL CASE FIXES ===== */
            
            /* Pool hashrate - always white */
            [id^="pool_"] {
                color: #ffffff !important;
            }
            
            /* Block page elements */
            .stat-item strong,
            .block-height,
            .block-detail-title {
                color: var(--primary-color) !important;
            }
            
            /* Block inputs and button styles */
            .block-input:focus {
                outline: none !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
            
            .block-button:hover {
                background-color: var(--primary-color) !important;
                color: #000 !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
            
            /* Notification page elements */
            .filter-button.active {
                background-color: var(--primary-color) !important;
                color: #000 !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
            
            .filter-button:hover,
            .action-button:hover:not(.danger),
            .load-more-button:hover {
                background-color: rgba(var(--primary-color-rgb), 0.2) !important;
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.3) !important;
            }
            
            /* Block cards and modals */
            .block-card:hover {
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
                transform: translateY(-2px);
            }
            
            .block-modal-content {
                box-shadow: 0 0 10px rgba(var(--primary-color-rgb), 0.5) !important;
            }
           
            .block-modal-close:hover,
            .block-modal-close:focus {
                color: var(--accent-color) !important;
            }
            
            /* ===== COLOR CATEGORIES ===== */
            
            /* YELLOW - SATOSHI EARNINGS & BTC PRICE */
            [id$="_sats"],
            #btc_price,
            .metric-value[id$="_sats"],
            .est_time_to_payout:not(.green):not(.red) {
                color: #ffd700 !important;
            }
            
            /* GREEN - POSITIVE USD VALUES */
            .metric-value.green,
            span.green,
            #daily_revenue:not([style*="color: #ff"]),
            #monthly_profit_usd:not([style*="color: #ff"]),
            #daily_profit_usd:not([style*="color: #ff"]),
            .status-green,
            #pool_luck.very-lucky,
            #pool_luck.lucky {
                color: #32CD32 !important;
            }

            #btc_price {
                cursor: pointer;
            }

            /* ----- RETRO LED ----- */
            .retro-led {
                display: inline-block;
                width: 8px;
                height: 8px;
                background: #00ff00;
                border-radius: 2px;
                margin-left: 6px;
                box-shadow: 0 0 4px #00ff00, 0 0 2px #00ff00;
                position: relative;
                top: -1.5px;
            }

            /* ----- RETRO LED (OFFLINE) ----- */
            .retro-led-offline {
                display: inline-block;
                width: 8px;
                height: 8px;
                background: #ff5555;
                border-radius: 2px;
                margin-left: 6px;
                box-shadow: 0 0 4px #ff5555, 0 0 2px #ff5555;
                position: relative;
                top: -1.5px;
                opacity: 0.7;
            }
            
            /* Light green for "lucky" status */
            #pool_luck.lucky {
                color: #90EE90 !important;
            }
            
            /* NORMAL LUCK - KHAKI */
            #pool_luck.normal-luck {
                color: #F0E68C !important;
            }
            
            /* RED - NEGATIVE VALUES & WARNINGS */
            .metric-value.red,
            span.red,
            .status-red,
            #daily_power_cost,
            #pool_luck.unlucky {
                color: #ff5555 !important;
            }
            
            .offline-dot {
                background: #ff5555 !important;
                box-shadow: 0 0 10px #ff5555, 0 0 10px #ff5555 !important;
            }
            
            /* WHITE - NETWORK STATS & WORKER DATA */
            #block_number,
            #difficulty,
            #network_hashrate,
            #workers_hashing,
            #last_share,
            #blocks_found,
            #last_block_height,
            #hashrate_24hr,
            #hashrate_3hr,
            #hashrate_10min,
            #hashrate_60sec {
                color: #ffffff !important;
            }
            
            /* CYAN - TIME AGO IN LAST BLOCK */
            #last_block_time {
                color: #00ffff !important;
            }
            
            /* ANIMATIONS */
            @keyframes waitingPulse {
                0%, 100% { box-shadow: 0 0 10px var(--primary-color), 0 0 10px var(--primary-color) !important; opacity: 0.8; }
                50% { box-shadow: 0 0 10px var(--primary-color), 0 0 10px var(--primary-color) !important; opacity: 1; }
            }
            
            @keyframes glow {
                0%, 100% { box-shadow: 0 0 10px var(--primary-color), 0 0 10px var(--primary-color) !important; }
                50% { box-shadow: 0 0 10px var(--primary-color), 0 0 10px var(--primary-color) !important; }
            }
        `;

        // Check if our style element already exists
        const existingStyle = document.getElementById('deepSeaThemeStyles');
        if (existingStyle) {
            existingStyle.parentNode.removeChild(existingStyle);
        }

        // Add our new style element to the head
        document.head.appendChild(styleElement);

        // Update page title
        document.title = document.title.replace("BTC-OS", "DeepSea");
        document.title = document.title.replace("Bitcoin", "DeepSea");

        // Update header text
        const headerElement = document.querySelector('h1');
        if (headerElement) {
            headerElement.innerHTML = headerElement.innerHTML.replace("BTC-OS", "DeepSea");
            headerElement.innerHTML = headerElement.innerHTML.replace("BITCOIN", "DEEPSEA");
        }

        // Update chart controls label
        updateChartControlsLabel(true);

        // Update theme toggle button
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.style.borderColor = '#0088cc';
            themeToggle.style.color = '#0088cc';
        }

        console.log("DeepSea theme applied with color adjustments");
    } finally {
        // Reset the guard flag when done, even if there's an error
        setTimeout(() => { isApplyingTheme = false; }, 100);
    }
}

// Make the function accessible globally
window.applyDeepSeaTheme = applyDeepSeaTheme;

// Toggle theme with hard page refresh
function toggleTheme() {
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') !== 'true';

    // Update the data-text attribute based on the new theme
    updateDashboardDataText(useDeepSea);

    // Save the new theme preference
    saveThemePreference(useDeepSea);

    // Show a themed loading message
    const loadingMessage = document.createElement('div');
    loadingMessage.id = 'theme-loader';

    const icon = document.createElement('div');
    icon.id = 'loader-icon';
    icon.innerHTML = useDeepSea ? '🌊' : '₿';

    const text = document.createElement('div');
    text.id = 'loader-text';
    text.textContent = 'Applying ' + (useDeepSea ? 'DeepSea' : 'Bitcoin') + ' Theme';

    loadingMessage.appendChild(icon);
    loadingMessage.appendChild(text);

    // Apply immediate styling
    loadingMessage.style.position = 'fixed';
    loadingMessage.style.top = '0';
    loadingMessage.style.left = '0';
    loadingMessage.style.width = '100%';
    loadingMessage.style.height = '100%';
    loadingMessage.style.backgroundColor = useDeepSea ? '#0c141a' : '#111111';
    loadingMessage.style.color = useDeepSea ? '#0088cc' : '#f2a900';
    loadingMessage.style.display = 'flex';
    loadingMessage.style.flexDirection = 'column';
    loadingMessage.style.justifyContent = 'center';
    loadingMessage.style.alignItems = 'center';
    loadingMessage.style.zIndex = '9999';
    loadingMessage.style.fontFamily = "'VT323', monospace";

    document.body.appendChild(loadingMessage);

    // Persist current chart point selection before reloading
    try {
        const points = window.chartPoints || 180;
        localStorage.setItem('chartPointsPreference', points.toString());
    } catch (e) {
        console.error('Error saving chart points preference', e);
    }

    // Short delay before refreshing
    setTimeout(() => {
        // Hard reload the page
        window.location.reload();
    }, 500);
}

// Set theme preference to localStorage
function saveThemePreference(useDeepSea) {
    try {
        localStorage.setItem('useDeepSeaTheme', useDeepSea);
    } catch (e) {
        console.error("Error saving theme preference:", e);
    }
}

// Check if this is the first startup by checking for the "firstStartup" flag
function isFirstStartup() {
    return localStorage.getItem('hasStartedBefore') !== 'true';
}

// Mark that the app has started before
function markAppStarted() {
    try {
        localStorage.setItem('hasStartedBefore', 'true');
    } catch (e) {
        console.error("Error marking app as started:", e);
    }
}

// Initialize DeepSea as default on first startup
function initializeDefaultTheme() {
    if (isFirstStartup()) {
        console.log("First startup detected, setting DeepSea as default theme");
        saveThemePreference(true); // Set DeepSea theme as default (true)
        markAppStarted();
        return true;
    }
    return false;
}

// Modified loadThemePreference function to update data-text attribute
function loadThemePreference() {
    try {
        // Check if it's first startup - if so, set DeepSea as default
        const isFirstTime = initializeDefaultTheme();

        // Get theme preference from localStorage
        const themePreference = localStorage.getItem('useDeepSeaTheme');
        const useDeepSea = themePreference === 'true' || isFirstTime;

        // Update the data-text attribute based on the current theme
        updateDashboardDataText(useDeepSea);

        // Apply theme based on preference
        if (useDeepSea) {
            applyDeepSeaTheme();
            updateChartControlsLabel(true);
        } else {
            // Make sure the toggle button is styled correctly for Bitcoin theme
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.style.borderColor = '#f2a900';
                themeToggle.style.color = '#f2a900';
                updateChartControlsLabel(false);
            }
        }
    } catch (e) {
        console.error("Error loading theme preference:", e);
    }
}

// Apply theme on page load
document.addEventListener('DOMContentLoaded', loadThemePreference);

// For pages that load content dynamically, also check when the window loads
window.addEventListener('load', loadThemePreference);

function updateChartControlsLabel(useDeepSea) {
    // Find the label element (adjust selector if needed)
    const label = document.querySelector('.chart-controls-label');
    if (label) {
        label.textContent = useDeepSea ? 'Depth:' : 'History:';
    }
}
