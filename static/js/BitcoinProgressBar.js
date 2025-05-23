/**
 * BitcoinMinuteRefresh.js - Simplified Bitcoin-themed floating uptime monitor
 * 
 * This module creates a Bitcoin-themed terminal that shows server uptime.
 * Now includes DeepSea theme support.
 */

const BitcoinMinuteRefresh = (function () {
    // Constants
    const STORAGE_KEY = 'bitcoin_last_refresh_time';
    // Default fallback colors if CSS vars aren't available
    const FALLBACK_BITCOIN_COLOR = '#f2a900';
    const FALLBACK_DEEPSEA_COLOR = '#0088cc';

    const DOM_IDS = {
        TERMINAL: 'bitcoin-terminal',
        STYLES: 'bitcoin-terminal-styles',
        CLOCK: 'terminal-clock',
        UPTIME_HOURS: 'uptime-hours',
        UPTIME_MINUTES: 'uptime-minutes',
        UPTIME_SECONDS: 'uptime-seconds',
        MINIMIZED_UPTIME: 'minimized-uptime-value',
        SHOW_BUTTON: 'bitcoin-terminal-show',
        MEM_GAUGE: 'memory-gauge-fill',
        MEM_TEXT: 'memory-percent',
        CONN_TEXT: 'connection-count',
        SCHED_STATUS: 'scheduler-status',
        SCHED_LAST: 'scheduler-last',
        DATA_AGE: 'data-age',
        PREV_BTN: 'monitor-prev',
        NEXT_BTN: 'monitor-next'
    };
    // Add these new keys to the STORAGE_KEYS constant
    const STORAGE_KEYS = {
        THEME: 'useDeepSeaTheme',
        COLLAPSED: 'bitcoin_terminal_collapsed',
        SERVER_OFFSET: 'serverTimeOffset',
        SERVER_START: 'serverStartTime',
        REFRESH_EVENT: 'bitcoin_refresh_event',
        POSITION_LEFT: 'bitcoin_terminal_left',
        POSITION_TOP: 'bitcoin_terminal_top',
        SNAP_POINT: 'bitcoin_terminal_snap_point',
        COLLAPSED_SNAP_POINT: 'bitcoin_terminal_collapsed_snap_point'
    };
    const SELECTORS = {
        HEADER: '.terminal-header',
        TITLE: '.terminal-title',
        TIMER: '.uptime-timer',
        SEPARATORS: '.uptime-separator',
        UPTIME_TITLE: '.uptime-title',
        MINI_LABEL: '.mini-uptime-label',
        TERMINAL_DOT: '.terminal-dot'
    };

    // Duration (ms) for collapse/expand animations
    const STATE_TRANSITION_MS = 350;

    // Private variables
    let terminalElement = null;
    let uptimeElement = null;
    let serverTimeOffset = 0;
    let serverStartTime = null;
    let uptimeInterval = null;
    let isInitialized = false;
    let refreshCallback = null;
    let currentThemeColor = '';
    let currentThemeRGB = '';
    let dragListenersAdded = false;

    // Helper function to check if DeepSea theme is active
    function isDeepSea() {
        return localStorage.getItem('useDeepSeaTheme') === 'true';
    }

    /**
     * Get theme colors from CSS variables
     */
    function getThemeColors() {
        // Try to get CSS variables from document root
        const rootStyles = getComputedStyle(document.documentElement);
        let primaryColor = rootStyles.getPropertyValue('--primary-color').trim();
        let primaryColorRGB = rootStyles.getPropertyValue('--primary-color-rgb').trim();

        // If CSS vars not available, use theme toggle state
        if (!primaryColor) {
            const isDeepSea = localStorage.getItem(STORAGE_KEYS.THEME) === 'true';
            primaryColor = isDeepSea ? FALLBACK_DEEPSEA_COLOR : FALLBACK_BITCOIN_COLOR;
            primaryColorRGB = isDeepSea ? '0, 136, 204' : '242, 169, 0';
        }

        return {
            color: primaryColor,
            rgb: primaryColorRGB
        };
    }

    /**
     * Logging helper function
     * @param {string} message - Message to log
     * @param {string} level - Log level (log, warn, error)
     */
    function log(message, level = 'log') {
        const prefix = "BitcoinMinuteRefresh: ";
        if (level === 'error') {
            console.error(prefix + message);
        } else if (level === 'warn') {
            console.warn(prefix + message);
        } else {
            console.log(prefix + message);
        }
    }

    /**
     * Helper function to set multiple styles on an element
     * @param {Element} element - The DOM element to style
     * @param {Object} styles - Object with style properties
     */
    function applyStyles(element, styles) {
        Object.keys(styles).forEach(key => {
            element.style[key] = styles[key];
        });
    }

    /**
     * Apply the current theme color 
     */
    function applyThemeColor() {
        // Get current theme colors
        const theme = getThemeColors();
        currentThemeColor = theme.color;
        currentThemeRGB = theme.rgb;

        // Don't try to update DOM elements if they don't exist yet
        if (!terminalElement) return;

        // Create theme config (no textShadow)
        const themeConfig = {
            color: currentThemeColor,
            borderColor: currentThemeColor,
            boxShadow: `0 0 5px rgba(${currentThemeRGB}, 0.3)`,
            borderColorRGBA: `rgba(${currentThemeRGB}, 0.5)`
        };

        // Apply styles to terminal
        applyStyles(terminalElement, {
            borderColor: themeConfig.color,
            color: themeConfig.color,
            boxShadow: themeConfig.boxShadow
        });

        // Update header border
        const headerElement = terminalElement.querySelector(SELECTORS.HEADER);
        if (headerElement) {
            headerElement.style.borderColor = themeConfig.color;
        }

        // Update terminal title (remove textShadow)
        const titleElement = terminalElement.querySelector(SELECTORS.TITLE);
        if (titleElement) {
            applyStyles(titleElement, {
                color: themeConfig.color,
                textShadow: 'none'
            });
        }

        // Update uptime timer border
        const uptimeTimer = terminalElement.querySelector(SELECTORS.TIMER);
        if (uptimeTimer) {
            uptimeTimer.style.borderColor = themeConfig.borderColorRGBA;
        }

        // Update uptime separators (remove textShadow)
        const separators = terminalElement.querySelectorAll(SELECTORS.SEPARATORS);
        separators.forEach(sep => {
            sep.style.textShadow = 'none';
        });

        // Update uptime title (remove textShadow)
        const uptimeTitle = terminalElement.querySelector(SELECTORS.UPTIME_TITLE);
        if (uptimeTitle) {
            uptimeTitle.style.textShadow = 'none';
        }

        // Update minimized view
        const miniLabel = terminalElement.querySelector(SELECTORS.MINI_LABEL);
        if (miniLabel) {
            miniLabel.style.color = themeConfig.color;
        }

        // Update show button if it exists
        const showButton = document.getElementById(DOM_IDS.SHOW_BUTTON);
        if (showButton) {
            showButton.style.backgroundColor = themeConfig.color;
            showButton.style.color = isDeepSea() ? '#ffffff' : '#000000';
            showButton.style.boxShadow = `0 0 10px rgba(${currentThemeRGB}, 0.5)`;
        }
    }

    /**
     * Listen for theme changes
     */
    function setupThemeChangeListener() {
        // Listen for theme change events from localStorage
        window.addEventListener('storage', function (e) {
            if (e.key === STORAGE_KEYS.THEME) {
                applyThemeColor();
            }
        });

        // Listen for custom theme change events
        document.addEventListener('themeChanged', function () {
            applyThemeColor();
        });

        // Watch for class changes on HTML element that might indicate theme changes
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.attributeName === 'class') {
                    applyThemeColor();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    /**
     * Debounce function to limit execution frequency
     */
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Add dragging functionality with snapping to the terminal
     */
    function addDraggingBehavior() {
        // Add snapping behavior first
        addSnappingBehavior();

        // Find the terminal element
        const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
            document.querySelector('.bitcoin-terminal') ||
            document.getElementById('retro-terminal-bar');

        if (!terminal) {
            log('Terminal element not found for drag behavior', 'warn');
            return;
        }

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        // Candidate snap point tracked during drag
        let snapCandidate = null;

        // Duration for snap animations (ms)
        const SNAP_ANIMATION_DURATION = 200;

        // Smoothly animate terminal to a snap point
        function animateSnap(x, y, name) {
            terminal.classList.add('snapping');
            terminal.classList.add('snapped');
            terminal.setAttribute('data-snap-point', name);

            const key = terminal.classList.contains('collapsed')
                ? STORAGE_KEYS.COLLAPSED_SNAP_POINT
                : STORAGE_KEYS.SNAP_POINT;
            localStorage.setItem(key, name);

            terminal.style.transition = `left ${SNAP_ANIMATION_DURATION}ms ease-out, top ${SNAP_ANIMATION_DURATION}ms ease-out`;
            terminal.style.left = x + 'px';
            terminal.style.top = y + 'px';
            terminal.style.right = 'auto';
            terminal.style.bottom = 'auto';
            terminal.style.transform = 'none';

            setTimeout(() => {
                terminal.style.transition = '';
                terminal.classList.remove('snapping');
                localStorage.setItem(STORAGE_KEYS.POSITION_LEFT, x);
                localStorage.setItem(STORAGE_KEYS.POSITION_TOP, y);
            }, SNAP_ANIMATION_DURATION);
        }

        // Function to handle mouse down (drag start)
        function handleMouseDown(e) {
            // Only enable dragging in desktop view
            if (window.innerWidth < 768) return;

            // Don't handle drag if clicking on controls
            if (e.target.closest(SELECTORS.TERMINAL_DOT)) return;

            isDragging = true;
            terminal.classList.add('dragging');

            // Reset any snap candidate
            snapCandidate = null;

            // Calculate start position
            startX = e.clientX;
            startY = e.clientY;

            // Get current position
            const style = window.getComputedStyle(terminal);

            // Handle horizontal position
            if (style.left !== 'auto') {
                startLeft = parseInt(style.left) || 0;
            } else {
                // Calculate from right if left is not set
                startLeft = window.innerWidth - (parseInt(style.right) || 0) - terminal.offsetWidth;
            }

            // Handle vertical position
            if (style.top !== 'auto') {
                startTop = parseInt(style.top) || 0;
            } else {
                // Calculate from bottom if top is not set
                startTop = window.innerHeight - (parseInt(style.bottom) || 0) - terminal.offsetHeight;
            }

            e.preventDefault(); // Prevent text selection
        }

        // Function to handle mouse move (dragging) with debounce for better performance
        const handleMouseMove = debounce(function (e) {
            if (!isDragging) return;

            // Calculate the movement
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;

            // Constrain to window boundaries
            const maxLeft = window.innerWidth - terminal.offsetWidth;
            const maxTop = window.innerHeight - terminal.offsetHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            // Check if we're near a snap point
            const candidate = window.findClosestSnapPoint(newLeft, newTop);

            if (candidate) {
                // Visual feedback for snapping
                terminal.classList.add('snapping');
                // Remember candidate but don't move yet
                snapCandidate = candidate;
            } else {
                terminal.classList.remove('snapping');
                snapCandidate = null;
            }

            // Update position
            terminal.style.left = newLeft + 'px';
            terminal.style.top = newTop + 'px';
            terminal.style.right = 'auto';
            terminal.style.bottom = 'auto';
            terminal.style.transform = 'none'; // Remove transformations
        }, 10);

        // Function to handle mouse up (drag end)
        function handleMouseUp() {
            if (isDragging) {
                isDragging = false;
                terminal.classList.remove('dragging');

                // Determine final position
                const style = window.getComputedStyle(terminal);
                const left = parseInt(style.left) || 0;
                const top = parseInt(style.top) || 0;

                const finalSnap = snapCandidate || window.findClosestSnapPoint(left, top);

                if (finalSnap) {
                    animateSnap(finalSnap.x, finalSnap.y, finalSnap.name);
                } else {
                    terminal.classList.remove('snapped');
                    terminal.removeAttribute('data-snap-point');
                    snapCandidate = null;

                    const key = terminal.classList.contains('collapsed')
                        ? STORAGE_KEYS.COLLAPSED_SNAP_POINT
                        : STORAGE_KEYS.SNAP_POINT;
                    localStorage.removeItem(key);

                    localStorage.setItem(STORAGE_KEYS.POSITION_LEFT, left);
                    localStorage.setItem(STORAGE_KEYS.POSITION_TOP, top);
                }
            }
        }

        // Find the terminal header for dragging
        const terminalHeader = terminal.querySelector(SELECTORS.HEADER);
        if (terminalHeader) {
            terminalHeader.addEventListener('mousedown', handleMouseDown);
        } else {
            // If no header found, make the whole terminal draggable
            terminal.addEventListener('mousedown', handleMouseDown);
        }

        // Add touch support for mobile/tablet - similar changes to mouse events
        function handleTouchStart(e) {
            if (window.innerWidth < 768) return;
            if (e.target.closest(SELECTORS.TERMINAL_DOT)) return;

            const touch = e.touches[0];
            isDragging = true;
            terminal.classList.add('dragging');

            // Reset any snap candidate
            snapCandidate = null;

            startX = touch.clientX;
            startY = touch.clientY;

            const style = window.getComputedStyle(terminal);

            // Handle horizontal position
            if (style.left !== 'auto') {
                startLeft = parseInt(style.left) || 0;
            } else {
                startLeft = window.innerWidth - (parseInt(style.right) || 0) - terminal.offsetWidth;
            }

            // Handle vertical position
            if (style.top !== 'auto') {
                startTop = parseInt(style.top) || 0;
            } else {
                startTop = window.innerHeight - (parseInt(style.bottom) || 0) - terminal.offsetHeight;
            }

            e.preventDefault();
        }

        function handleTouchMove(e) {
            if (!isDragging) return;

            const touch = e.touches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;

            const maxLeft = window.innerWidth - terminal.offsetWidth;
            const maxTop = window.innerHeight - terminal.offsetHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            // Check for snap points
            const candidate = window.findClosestSnapPoint(newLeft, newTop);

            if (candidate) {
                terminal.classList.add('snapping');
                snapCandidate = candidate;
            } else {
                terminal.classList.remove('snapping');
                snapCandidate = null;
            }

            terminal.style.left = newLeft + 'px';
            terminal.style.top = newTop + 'px';
            terminal.style.right = 'auto';
            terminal.style.bottom = 'auto';
            terminal.style.transform = 'none';

            e.preventDefault();
        }

        function handleTouchEnd() {
            if (isDragging) {
                isDragging = false;
                terminal.classList.remove('dragging');

                const style = window.getComputedStyle(terminal);
                const left = parseInt(style.left) || 0;
                const top = parseInt(style.top) || 0;

                const finalSnap = snapCandidate || window.findClosestSnapPoint(left, top);

                if (finalSnap) {
                    animateSnap(finalSnap.x, finalSnap.y, finalSnap.name);
                } else {
                    terminal.classList.remove('snapped');
                    terminal.removeAttribute('data-snap-point');
                    snapCandidate = null;

                    const key = terminal.classList.contains('collapsed')
                        ? STORAGE_KEYS.COLLAPSED_SNAP_POINT
                        : STORAGE_KEYS.SNAP_POINT;
                    localStorage.removeItem(key);

                    localStorage.setItem(STORAGE_KEYS.POSITION_LEFT, left);
                    localStorage.setItem(STORAGE_KEYS.POSITION_TOP, top);
                }
            }
        }

        if (terminalHeader) {
            terminalHeader.addEventListener('touchstart', handleTouchStart);
        } else {
            terminal.addEventListener('touchstart', handleTouchStart);
        }

        // Add event listeners only once to prevent memory leaks
        if (!dragListenersAdded) {
            // Add mousemove and mouseup listeners to document
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            // Add touch event listeners
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

            // Handle window resize
            window.addEventListener('resize', function () {
                if (window.innerWidth < 768) {
                    // Reset position for mobile view
                    terminal.style.left = '50%';
                    terminal.style.top = 'auto';
                    terminal.style.bottom = '20px';
                    terminal.style.right = 'auto';
                    terminal.style.transform = 'translateX(-50%)';
                } else {
                    // Ensure terminal stays visible in desktop view
                    const maxLeft = window.innerWidth - terminal.offsetWidth;
                    const maxTop = window.innerHeight - terminal.offsetHeight;
                    const currentLeft = parseInt(window.getComputedStyle(terminal).left) || 0;
                    const currentTop = parseInt(window.getComputedStyle(terminal).top) || 0;

                    if (currentLeft > maxLeft) {
                        terminal.style.left = maxLeft + 'px';
                    }
                    if (currentTop > maxTop) {
                        terminal.style.top = maxTop + 'px';
                    }
                }
            });

            // Mark listeners as added
            dragListenersAdded = true;
        }
    }

    /**
     * Add snapping functionality to the draggable terminal
     */
    function addSnappingBehavior() {
        // Get terminal height to calculate proper bottom positions
        const getTerminalHeight = () => {
            const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
                document.querySelector('.bitcoin-terminal');

            // Different height calculation based on collapsed state
            if (terminal && terminal.classList.contains('collapsed')) {
                return terminal.offsetHeight || 40; // Approximated collapsed height
            }
            return terminal ? terminal.offsetHeight : 150;
        };

        // Calculate proper bottom position with safe margin
        const calculateBottomY = () => {
            const terminalHeight = getTerminalHeight();
            // Add 20px safety margin to avoid cutting off
            return window.innerHeight - terminalHeight - 20;
        };

        // Helper function to get terminal width
        const getTerminalWidth = () => {
            const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
                document.querySelector('.bitcoin-terminal');
            return terminal ? terminal.offsetWidth : 230;
        };

        // Define snap points for expanded state
        const expandedSnapPoints = [
            // Original points
            { name: 'topLeft', x: 20, y: 20 },
            { name: 'topRight', x: window.innerWidth - getTerminalWidth() - 20, y: 20 },
            { name: 'bottomLeft', x: 20, y: calculateBottomY() },
            { name: 'bottomRight', x: window.innerWidth - getTerminalWidth() - 20, y: calculateBottomY() },
            { name: 'center', x: (window.innerWidth - getTerminalWidth()) / 2, y: 20 },
            { name: 'centerBottom', x: (window.innerWidth - getTerminalWidth()) / 2, y: calculateBottomY() },

            // New edge snap points
            { name: 'topCenter', x: (window.innerWidth - getTerminalWidth()) / 2, y: 20 },
            { name: 'leftCenter', x: 20, y: (window.innerHeight - getTerminalHeight()) / 2 },
            { name: 'rightCenter', x: window.innerWidth - getTerminalWidth() - 20, y: (window.innerHeight - getTerminalHeight()) / 2 },
            { name: 'trueCenter', x: (window.innerWidth - getTerminalWidth()) / 2, y: (window.innerHeight - getTerminalHeight()) / 2 },

            // Quarter positions
            { name: 'topLeftQuarter', x: window.innerWidth / 4 - getTerminalWidth() / 2, y: 20 },
            { name: 'topRightQuarter', x: (window.innerWidth / 4) * 3 - getTerminalWidth() / 2, y: 20 },
            { name: 'bottomLeftQuarter', x: window.innerWidth / 4 - getTerminalWidth() / 2, y: calculateBottomY() },
            { name: 'bottomRightQuarter', x: (window.innerWidth / 4) * 3 - getTerminalWidth() / 2, y: calculateBottomY() },

            // Side positions at thirds
            { name: 'leftUpperThird', x: 20, y: window.innerHeight / 3 - getTerminalHeight() / 2 },
            { name: 'leftLowerThird', x: 20, y: (window.innerHeight / 3) * 2 - getTerminalHeight() / 2 },
            { name: 'rightUpperThird', x: window.innerWidth - getTerminalWidth() - 20, y: window.innerHeight / 3 - getTerminalHeight() / 2 },
            { name: 'rightLowerThird', x: window.innerWidth - getTerminalWidth() - 20, y: (window.innerHeight / 3) * 2 - getTerminalHeight() / 2 },

            // Top and bottom third positions
            { name: 'topLeftThird', x: window.innerWidth / 3 - getTerminalWidth() / 2, y: 20 },
            { name: 'topRightThird', x: (window.innerWidth / 3) * 2 - getTerminalWidth() / 2, y: 20 },
            { name: 'bottomLeftThird', x: window.innerWidth / 3 - getTerminalWidth() / 2, y: calculateBottomY() },
            { name: 'bottomRightThird', x: (window.innerWidth / 3) * 2 - getTerminalWidth() / 2, y: calculateBottomY() }
        ];

        // Define snap points for minimized/collapsed state - optimized for smaller height
        const collapsedSnapPoints = [
            // Original points
            { name: 'topLeft', x: 20, y: 20 },
            { name: 'topRight', x: window.innerWidth - getTerminalWidth() - 20, y: 20 },
            { name: 'bottomLeft', x: 20, y: calculateBottomY() },
            { name: 'bottomRight', x: window.innerWidth - getTerminalWidth() - 20, y: calculateBottomY() },
            { name: 'center', x: (window.innerWidth - getTerminalWidth()) / 2, y: 20 },
            { name: 'centerBottom', x: (window.innerWidth - getTerminalWidth()) / 2, y: calculateBottomY() },

            // New edge snap points - same names as expanded for consistency
            { name: 'topCenter', x: (window.innerWidth - getTerminalWidth()) / 2, y: 20 },
            { name: 'leftCenter', x: 20, y: (window.innerHeight - getTerminalHeight()) / 2 },
            { name: 'rightCenter', x: window.innerWidth - getTerminalWidth() - 20, y: (window.innerHeight - getTerminalHeight()) / 2 },
            { name: 'trueCenter', x: (window.innerWidth - getTerminalWidth()) / 2, y: (window.innerHeight - getTerminalHeight()) / 2 },

            // Quarter positions
            { name: 'topLeftQuarter', x: window.innerWidth / 4 - getTerminalWidth() / 2, y: 20 },
            { name: 'topRightQuarter', x: (window.innerWidth / 4) * 3 - getTerminalWidth() / 2, y: 20 },
            { name: 'bottomLeftQuarter', x: window.innerWidth / 4 - getTerminalWidth() / 2, y: calculateBottomY() },
            { name: 'bottomRightQuarter', x: (window.innerWidth / 4) * 3 - getTerminalWidth() / 2, y: calculateBottomY() },

            // Side positions at thirds
            { name: 'leftUpperThird', x: 20, y: window.innerHeight / 3 - getTerminalHeight() / 2 },
            { name: 'leftLowerThird', x: 20, y: (window.innerHeight / 3) * 2 - getTerminalHeight() / 2 },
            { name: 'rightUpperThird', x: window.innerWidth - getTerminalWidth() - 20, y: window.innerHeight / 3 - getTerminalHeight() / 2 },
            { name: 'rightLowerThird', x: window.innerWidth - getTerminalWidth() - 20, y: (window.innerHeight / 3) * 2 - getTerminalHeight() / 2 },

            // Top and bottom third positions
            { name: 'topLeftThird', x: window.innerWidth / 3 - getTerminalWidth() / 2, y: 20 },
            { name: 'topRightThird', x: (window.innerWidth / 3) * 2 - getTerminalWidth() / 2, y: 20 },
            { name: 'bottomLeftThird', x: window.innerWidth / 3 - getTerminalWidth() / 2, y: calculateBottomY() },
            { name: 'bottomRightThird', x: (window.innerWidth / 3) * 2 - getTerminalWidth() / 2, y: calculateBottomY() }
        ];

        // Snap sensitivity - how close the terminal needs to be to snap (in pixels)
        const snapThreshold = 80;

        // Add a method to find the closest snap point based on current state
        function findClosestSnapPoint(x, y) {
            let closest = null;
            let minDistance = Number.MAX_VALUE;

            // Determine which set of snap points to use based on collapsed state
            const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
                document.querySelector('.bitcoin-terminal');
            const isCollapsed = terminal && terminal.classList.contains('collapsed');

            // Update positions before checking
            updateSnapPoints();

            // Use appropriate snap points array based on collapsed state
            const relevantSnapPoints = isCollapsed ? collapsedSnapPoints : expandedSnapPoints;

            relevantSnapPoints.forEach(point => {
                // Calculate Euclidean distance
                const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));

                if (distance < minDistance && distance < snapThreshold) {
                    minDistance = distance;
                    closest = point;
                }
            });

            return closest;
        }

        // Store this in the module scope for use in other functions
        window.findClosestSnapPoint = findClosestSnapPoint;

        // Update snap points on window resize
        function updateSnapPoints() {
            const bottomY = calculateBottomY();
            const termWidth = getTerminalWidth();
            const halfTermWidth = termWidth / 2;
            const termHeight = getTerminalHeight();
            const halfTermHeight = termHeight / 2;
            const verticalCenter = (window.innerHeight - termHeight) / 2;

            // Update original snap points
            expandedSnapPoints[1].x = window.innerWidth - termWidth - 20; // topRight
            expandedSnapPoints[3].x = window.innerWidth - termWidth - 20; // bottomRight
            expandedSnapPoints[4].x = (window.innerWidth - termWidth) / 2; // center
            expandedSnapPoints[5].x = (window.innerWidth - termWidth) / 2; // centerBottom

            expandedSnapPoints[2].y = bottomY; // bottomLeft
            expandedSnapPoints[3].y = bottomY; // bottomRight
            expandedSnapPoints[5].y = bottomY; // centerBottom

            // Update new edge snap points for expanded
            expandedSnapPoints[6].x = (window.innerWidth - termWidth) / 2; // topCenter
            expandedSnapPoints[7].y = verticalCenter; // leftCenter
            expandedSnapPoints[8].x = window.innerWidth - termWidth - 20; // rightCenter
            expandedSnapPoints[8].y = verticalCenter; // rightCenter
            expandedSnapPoints[9].x = (window.innerWidth - termWidth) / 2; // trueCenter
            expandedSnapPoints[9].y = verticalCenter; // trueCenter

            // Update quarter positions for expanded
            expandedSnapPoints[10].x = window.innerWidth / 4 - halfTermWidth; // topLeftQuarter
            expandedSnapPoints[11].x = (window.innerWidth / 4) * 3 - halfTermWidth; // topRightQuarter
            expandedSnapPoints[12].x = window.innerWidth / 4 - halfTermWidth; // bottomLeftQuarter
            expandedSnapPoints[12].y = bottomY; // bottomLeftQuarter
            expandedSnapPoints[13].x = (window.innerWidth / 4) * 3 - halfTermWidth; // bottomRightQuarter
            expandedSnapPoints[13].y = bottomY; // bottomRightQuarter

            // Update thirds positions for expanded
            expandedSnapPoints[14].y = window.innerHeight / 3 - halfTermHeight; // leftUpperThird
            expandedSnapPoints[15].y = (window.innerHeight / 3) * 2 - halfTermHeight; // leftLowerThird
            expandedSnapPoints[16].x = window.innerWidth - termWidth - 20; // rightUpperThird
            expandedSnapPoints[16].y = window.innerHeight / 3 - halfTermHeight; // rightUpperThird
            expandedSnapPoints[17].x = window.innerWidth - termWidth - 20; // rightLowerThird
            expandedSnapPoints[17].y = (window.innerHeight / 3) * 2 - halfTermHeight; // rightLowerThird

            expandedSnapPoints[18].x = window.innerWidth / 3 - halfTermWidth; // topLeftThird
            expandedSnapPoints[19].x = (window.innerWidth / 3) * 2 - halfTermWidth; // topRightThird
            expandedSnapPoints[20].x = window.innerWidth / 3 - halfTermWidth; // bottomLeftThird
            expandedSnapPoints[20].y = bottomY; // bottomLeftThird
            expandedSnapPoints[21].x = (window.innerWidth / 3) * 2 - halfTermWidth; // bottomRightThird
            expandedSnapPoints[21].y = bottomY; // bottomRightThird

            // Do the same for collapsed snap points
            collapsedSnapPoints[1].x = window.innerWidth - termWidth - 20; // topRight
            collapsedSnapPoints[3].x = window.innerWidth - termWidth - 20; // bottomRight
            collapsedSnapPoints[4].x = (window.innerWidth - termWidth) / 2; // center
            collapsedSnapPoints[5].x = (window.innerWidth - termWidth) / 2; // centerBottom

            collapsedSnapPoints[2].y = bottomY; // bottomLeft
            collapsedSnapPoints[3].y = bottomY; // bottomRight
            collapsedSnapPoints[5].y = bottomY; // centerBottom

            // Update new edge snap points for collapsed
            collapsedSnapPoints[6].x = (window.innerWidth - termWidth) / 2; // topCenter
            collapsedSnapPoints[7].y = verticalCenter; // leftCenter
            collapsedSnapPoints[8].x = window.innerWidth - termWidth - 20; // rightCenter
            collapsedSnapPoints[8].y = verticalCenter; // rightCenter
            collapsedSnapPoints[9].x = (window.innerWidth - termWidth) / 2; // trueCenter
            collapsedSnapPoints[9].y = verticalCenter; // trueCenter

            // Update quarter positions for collapsed
            collapsedSnapPoints[10].x = window.innerWidth / 4 - halfTermWidth; // topLeftQuarter
            collapsedSnapPoints[11].x = (window.innerWidth / 4) * 3 - halfTermWidth; // topRightQuarter
            collapsedSnapPoints[12].x = window.innerWidth / 4 - halfTermWidth; // bottomLeftQuarter
            collapsedSnapPoints[12].y = bottomY; // bottomLeftQuarter
            collapsedSnapPoints[13].x = (window.innerWidth / 4) * 3 - halfTermWidth; // bottomRightQuarter
            collapsedSnapPoints[13].y = bottomY; // bottomRightQuarter

            // Update thirds positions for collapsed
            collapsedSnapPoints[14].y = window.innerHeight / 3 - halfTermHeight; // leftUpperThird
            collapsedSnapPoints[15].y = (window.innerHeight / 3) * 2 - halfTermHeight; // leftLowerThird
            collapsedSnapPoints[16].x = window.innerWidth - termWidth - 20; // rightUpperThird
            collapsedSnapPoints[16].y = window.innerHeight / 3 - halfTermHeight; // rightUpperThird
            collapsedSnapPoints[17].x = window.innerWidth - termWidth - 20; // rightLowerThird
            collapsedSnapPoints[17].y = (window.innerHeight / 3) * 2 - halfTermHeight; // rightLowerThird

            collapsedSnapPoints[18].x = window.innerWidth / 3 - halfTermWidth; // topLeftThird
            collapsedSnapPoints[19].x = (window.innerWidth / 3) * 2 - halfTermWidth; // topRightThird
            collapsedSnapPoints[20].x = window.innerWidth / 3 - halfTermWidth; // bottomLeftThird
            collapsedSnapPoints[20].y = bottomY; // bottomLeftThird
            collapsedSnapPoints[21].x = (window.innerWidth / 3) * 2 - halfTermWidth; // bottomRightThird
            collapsedSnapPoints[21].y = bottomY; // bottomRightThird
        }

        // Initial setup
        window.addEventListener('resize', function () {
            // Delay the update to ensure terminal dimensions are stable
            setTimeout(updateSnapPoints, 100);
        });

        // Call once on init to set correct values
        setTimeout(updateSnapPoints, 200);

        // Return helper functions to manage snap point transitions
        return {
            getSnapPointMapping: function () {
                // Direct mapping between expanded and collapsed snap points
                return {
                    // Original points
                    'topLeft': 'topLeft',
                    'topRight': 'topRight',
                    'bottomLeft': 'bottomLeft',
                    'bottomRight': 'bottomRight',
                    'center': 'center',
                    'centerBottom': 'centerBottom',

                    // New points
                    'topCenter': 'topCenter',
                    'leftCenter': 'leftCenter',
                    'rightCenter': 'rightCenter',
                    'trueCenter': 'trueCenter',
                    'topLeftQuarter': 'topLeftQuarter',
                    'topRightQuarter': 'topRightQuarter',
                    'bottomLeftQuarter': 'bottomLeftQuarter',
                    'bottomRightQuarter': 'bottomRightQuarter',
                    'leftUpperThird': 'leftUpperThird',
                    'leftLowerThird': 'leftLowerThird',
                    'rightUpperThird': 'rightUpperThird',
                    'rightLowerThird': 'rightLowerThird',
                    'topLeftThird': 'topLeftThird',
                    'topRightThird': 'topRightThird',
                    'bottomLeftThird': 'bottomLeftThird',
                    'bottomRightThird': 'bottomRightThird'
                };
            },

            // Get appropriate snap points based on state
            getSnapPoints: function (isCollapsed) {
                return isCollapsed ? collapsedSnapPoints : expandedSnapPoints;
            }
        };
    }

    /**
     * Create and inject the retro terminal element into the DOM
     */
    function createTerminalElement() {
        // Container element
        terminalElement = document.createElement('div');
        terminalElement.id = DOM_IDS.TERMINAL;
        terminalElement.className = 'bitcoin-terminal';

        // Terminal content with multiple pages
        terminalElement.innerHTML = `
          <div class="terminal-header">
            <div class="terminal-title">SYSTEM MONITOR v.3</div>
            <div class="terminal-controls">
              <div class="terminal-dot minimize" title="Minimize" onclick="BitcoinMinuteRefresh.toggleTerminal()">
                <span class="control-symbol">-</span>
              </div>
              <div class="terminal-dot close" title="Close" onclick="BitcoinMinuteRefresh.hideTerminal()">
                <span class="control-symbol">x</span>
              </div>
            </div>
          </div>
          <div class="terminal-content">
            <div class="monitor-page" data-page="0">
              <div class="status-row">
                <div class="status-indicator">
                  <div class="status-dot connected"></div>
                  <span>LIVE</span>
                </div>
                <span id="${DOM_IDS.CLOCK}" class="terminal-clock">00:00:00</span>
              </div>
              <div id="uptime-timer" class="uptime-timer">
                <div class="uptime-title">UPTIME</div>
                <div class="uptime-display">
                  <div class="uptime-value">
                    <span id="${DOM_IDS.UPTIME_HOURS}" class="uptime-number">00</span>
                    <span class="uptime-label">H</span>
                  </div>
                  <div class="uptime-separator">:</div>
                  <div class="uptime-value">
                    <span id="${DOM_IDS.UPTIME_MINUTES}" class="uptime-number">00</span>
                    <span class="uptime-label">M</span>
                  </div>
                  <div class="uptime-separator">:</div>
                  <div class="uptime-value">
                    <span id="${DOM_IDS.UPTIME_SECONDS}" class="uptime-number">00</span>
                    <span class="uptime-label">S</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="monitor-page" data-page="1" style="display:none">
              <div class="page-title">MEMORY USAGE</div>
              <div class="memory-gauge"><div id="${DOM_IDS.MEM_GAUGE}" class="memory-gauge-fill"></div></div>
              <div id="${DOM_IDS.MEM_TEXT}" class="memory-text">0%</div>
            </div>
            <div class="monitor-page" data-page="2" style="display:none">
              <div class="page-title">CONNECTIONS</div>
              <div id="${DOM_IDS.CONN_TEXT}" class="connections-text">0</div>
            </div>
            <div class="monitor-page" data-page="3" style="display:none">
              <div class="page-title">SCHEDULER</div>
              <div id="${DOM_IDS.SCHED_STATUS}" class="scheduler-text"></div>
              <div id="${DOM_IDS.SCHED_LAST}" class="scheduler-last"></div>
            </div>
            <div class="monitor-page" data-page="4" style="display:none">
              <div class="page-title">DATA AGE</div>
              <div id="${DOM_IDS.DATA_AGE}" class="data-age"></div>
            </div>
            <div class="page-controls">
              <span id="${DOM_IDS.PREV_BTN}" class="page-btn">&#9664;</span>
              <span id="${DOM_IDS.NEXT_BTN}" class="page-btn">&#9654;</span>
            </div>
          </div>
          <div class="terminal-minimized">
            <div class="minimized-uptime">
              <span class="mini-uptime-label">UPTIME</span>
              <span id="${DOM_IDS.MINIMIZED_UPTIME}">00:00:00</span>
            </div>
            <div class="minimized-status-dot connected"></div>
          </div>
        `;

        // Append to body
        document.body.appendChild(terminalElement);

        // Add custom styles if not already present
        if (!document.getElementById(DOM_IDS.STYLES)) {
            addStyles();
        }

        // Cache element references
        uptimeElement = document.getElementById('uptime-timer');

        // IMPORTANT: Delay position restoration to ensure correct height calculation
        setTimeout(() => {
            restoreTerminalPosition();
            // Add dragging behavior after position is set
            addDraggingBehavior();
        }, 100);

        // Start minimized on mobile, or if previously collapsed
        if (
            window.innerWidth < 768 ||
            localStorage.getItem(STORAGE_KEYS.COLLAPSED) === 'true'
        ) {
            terminalElement.classList.add('collapsed');
            localStorage.setItem(STORAGE_KEYS.COLLAPSED, 'true');
        }

        // Add custom styles if not already present
        if (!document.getElementById(DOM_IDS.STYLES)) {
            addStyles();
        }
    }

    /**
     * Restore terminal position from localStorage
     */
    function restoreTerminalPosition() {
        // Only restore position on desktop
        if (window.innerWidth >= 768 && terminalElement) {
            const savedLeft = localStorage.getItem(STORAGE_KEYS.POSITION_LEFT);
            const savedTop = localStorage.getItem(STORAGE_KEYS.POSITION_TOP);
            const isCollapsed = terminalElement.classList.contains('collapsed');

            // Get the appropriate snap point based on current state
            const savedSnapPoint = isCollapsed
                ? localStorage.getItem(STORAGE_KEYS.COLLAPSED_SNAP_POINT)
                : localStorage.getItem(STORAGE_KEYS.SNAP_POINT);

            // Calculate terminal height now that it's in the DOM
            const termHeight = terminalElement.offsetHeight;
            const termWidth = terminalElement.offsetWidth;
            const safeBottomY = window.innerHeight - termHeight - 20;
            const safeRightX = window.innerWidth - termWidth - 20;

            if (savedSnapPoint) {
                // If we have a saved snap point, use it to position with freshly calculated dimensions
                const snapPoints = isCollapsed ? {
                    // Collapsed snap points
                    topLeft: { x: 20, y: 20 },
                    topRight: { x: safeRightX, y: 20 },
                    bottomLeft: { x: 20, y: safeBottomY },
                    bottomRight: { x: safeRightX, y: safeBottomY },
                    center: { x: (window.innerWidth - termWidth) / 2, y: 20 },
                    centerBottom: { x: (window.innerWidth - termWidth) / 2, y: safeBottomY }
                } : {
                    // Expanded snap points
                    topLeft: { x: 20, y: 20 },
                    topRight: { x: safeRightX, y: 20 },
                    bottomLeft: { x: 20, y: safeBottomY },
                    bottomRight: { x: safeRightX, y: safeBottomY },
                    center: { x: (window.innerWidth - termWidth) / 2, y: 20 },
                    centerBottom: { x: (window.innerWidth - termWidth) / 2, y: safeBottomY }
                };

                if (snapPoints[savedSnapPoint]) {
                    terminalElement.style.left = snapPoints[savedSnapPoint].x + 'px';
                    terminalElement.style.top = snapPoints[savedSnapPoint].y + 'px';
                    terminalElement.classList.add('snapped');
                    terminalElement.setAttribute('data-snap-point', savedSnapPoint);

                    // Reset any conflicting styles
                    terminalElement.style.right = 'auto';
                    terminalElement.style.bottom = 'auto';
                    terminalElement.style.transform = 'none';
                }
            } else if (savedLeft && savedTop) {
                // Otherwise use saved coordinates 
                // But make sure they're still valid for current window size
                const maxLeft = window.innerWidth - terminalElement.offsetWidth;
                const maxTop = window.innerHeight - terminalElement.offsetHeight;

                const left = Math.max(0, Math.min(parseInt(savedLeft), maxLeft));
                const top = Math.max(0, Math.min(parseInt(savedTop), maxTop));

                terminalElement.style.left = left + 'px';
                terminalElement.style.top = top + 'px';
                terminalElement.style.right = 'auto';
                terminalElement.style.bottom = 'auto';
                terminalElement.style.transform = 'none';
            } else {
                // Default position if nothing saved
                terminalElement.style.right = '20px';
                terminalElement.style.bottom = '20px';
                terminalElement.style.left = 'auto';
                terminalElement.style.top = 'auto';
            }
        }
    }

    // Helper function for determining terminal height
    function getTerminalHeight() {
        const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
            document.querySelector('.bitcoin-terminal');
        return terminal ? terminal.offsetHeight : 150;
    }

    /**
     * Add CSS styles for the terminal
     */
    function addStyles() {
        // Get current theme colors for initial styling
        const theme = getThemeColors();

        const styleElement = document.createElement('style');
        styleElement.id = DOM_IDS.STYLES;

        styleElement.textContent = `
      /* Terminal Container */
      .bitcoin-terminal {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 210px;
        height: 190px;
        background-color: #000000;
        border: 1px solid var(--primary-color, ${theme.color});
        color: var(--primary-color, ${theme.color});
        font-family: 'VT323', monospace;
        z-index: 9999;
        overflow: hidden;
        padding: 8px;
        transition: all 0.3s ease;
        box-shadow: 0 0 5px rgba(var(--primary-color-rgb, ${theme.rgb}), 0.3);
      }
      
      /* Terminal Header */
      .terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--primary-color, ${theme.color});
        padding-bottom: 5px;
        margin-bottom: 8px;
        cursor: grab;
      }

      .terminal-header:active,
      .bitcoin-terminal.dragging .terminal-header {
        cursor: grabbing;
      }
      
      .terminal-title {
        color: var(--primary-color, ${theme.color});
        font-weight: bold;
        font-size: 1.1rem;
        animation: terminal-flicker 4s infinite;
        text-shadow: none !important;
      }
      
      /* Control Dots */
      .terminal-controls {
        display: flex;
        gap: 5px;
        margin-left: 5px;
      }
      
      .terminal-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #555;
        cursor: pointer;
        transition: background-color 0.3s;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      
      .control-symbol {
        color: #333;
        font-size: 9px;
        font-weight: bold;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        line-height: 1;
      }
      
      .terminal-dot.minimize:hover {
        background-color: #ffcc00;
      }
      
      .terminal-dot.minimize:hover .control-symbol {
        color: #664e00;
      }
      
      .terminal-dot.close:hover {
        background-color: #ff3b30;
      }
      
      .terminal-dot.close:hover .control-symbol {
        color: #7a0200;
      }
      
      /* Terminal Content */
      .terminal-content {
        position: relative;
      }
      
      /* Status Row */
      .status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      /* Status Indicator */
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
      }
      
      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      
      .status-dot.connected {
        background-color: #32CD32;
        box-shadow: 0 0 5px #32CD32;
        animation: pulse 2s infinite;
      }
      
      .terminal-clock {
        font-size: 1rem;
        font-weight: bold;
      }
      
      /* Uptime Display */
      .uptime-timer {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 5px;
        background-color: #111;
        border: 1px solid rgba(var(--primary-color-rgb, ${theme.rgb}), 0.5);
        margin-top: 5px;
      }
      
      .uptime-display {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2px;
        margin-top: 5px;
      }
      
      .uptime-value {
        display: flex;
        align-items: baseline;
      }
      
      .uptime-number {
        font-size: 1.4rem;
        font-weight: bold;
        background-color: #000;
        padding: 2px 5px;
        border-radius: 3px;
        min-width: 32px;
        display: inline-block;
        text-align: center;
        letter-spacing: 2px;
        color: #dee2e6;
      }
      
      .uptime-label {
        font-size: 0.7rem;
        opacity: 0.7;
        margin-left: 2px;
      }
      
      .uptime-separator {
        font-size: 1.4rem;
        font-weight: bold;
        padding: 0 2px;
      }
      
      .uptime-title {
        font-size: 0.7rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 3px;
      }
      
      /* Show button */
      #${DOM_IDS.SHOW_BUTTON} {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background-color: var(--primary-color, ${theme.color});
        color: ${isDeepSea() ? '#ffffff' : '#000000'};
        border: none;
        padding: 8px 12px;
        font-family: 'VT323', monospace;
        cursor: pointer;
        z-index: 9999;
        display: none;
        box-shadow: 0 0 10px rgba(var(--primary-color-rgb, ${theme.rgb}), 0.5);
        opacity: 0.85;
      }

      /* Page system */
      .monitor-page {
        text-align: center;
      }

      .page-title {
        font-size: 0.8rem;
        font-weight: bold;
        margin-bottom: 4px;
        color: var(--primary-color, ${theme.color});
      }

      .page-controls {
        display: flex;
        justify-content: space-between;
        margin-top: 5px;
      }

      .page-btn {
        cursor: pointer;
        user-select: none;
        padding: 0 5px;
        font-weight: bold;
      }

      .memory-gauge {
        width: 100%;
        height: 8px;
        background: #222;
        border: 1px solid rgba(var(--primary-color-rgb, ${theme.rgb}), 0.5);
        margin-bottom: 4px;
      }

      .memory-gauge-fill {
        height: 100%;
        background: var(--primary-color, ${theme.color});
        width: 0%;
      }

      .memory-text,
      .connections-text,
      .scheduler-text,
      .scheduler-last,
      .data-age {
        font-size: 0.9rem;
        margin-top: 4px;
        color: #ffffff;
      }
      
      /* CRT scanline effect */
      .terminal-content::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.15),
          rgba(0, 0, 0, 0.15) 1px,
          transparent 1px,
          transparent 2px
        );
        pointer-events: none;
        z-index: 1;
      }
      
      /* Minimized view styling */
      .terminal-minimized {
        display: none;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 4px 10px;
        background-color: #000;
        position: relative;
      }
      
      .terminal-minimized::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.15),
          rgba(0, 0, 0, 0.15) 1px,
          transparent 1px,
          transparent 2px
        );
        pointer-events: none;
        z-index: 1;
      }
      
      .minimized-uptime {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        z-index: 2;
      }
      
      .mini-uptime-label {
        font-size: 0.6rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
        margin-left: 45px;
        color: var(--primary-color, ${theme.color});
      }
      
      #${DOM_IDS.MINIMIZED_UPTIME} {
        font-size: 0.9rem;
        font-weight: bold;
        margin-left: 45px;
        color: #dee2e6;
      }
      
      .minimized-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-left: 10px;
        position: relative;
        z-index: 2;
      }
      
      /* Collapsed state */
      .bitcoin-terminal.collapsed {
        width: 175px;
        height: 80px;
        padding: 5px;
      }
      
      .bitcoin-terminal.collapsed .terminal-content {
        display: none;
      }
      
      .bitcoin-terminal.collapsed .terminal-minimized {
        display: flex;
      }
      
      .bitcoin-terminal.collapsed .terminal-header {
        border-bottom: none;
        margin-bottom: 2px;
        padding-bottom: 2px;
      }
      
      /* Animations */
      @keyframes pulse {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }
      
      @keyframes terminal-flicker {
        0% { opacity: 0.97; }
        5% { opacity: 0.95; }
        10% { opacity: 0.97; }
        15% { opacity: 0.94; }
        20% { opacity: 0.98; }
        50% { opacity: 0.95; }
        80% { opacity: 0.96; }
        90% { opacity: 0.94; }
        100% { opacity: 0.98; }
      }
      
      /* Media Queries */
      @media (max-width: 768px) {
        .bitcoin-terminal {
          left: 50%;
          right: auto;
          transform: translateX(-50%);
          width: 210px;
          height: 190px;
          bottom: 10px;
        }

        .bitcoin-terminal.collapsed {
          width: 190px;
          height: 80px;
          left: 50%;
          right: auto;
          transform: translateX(-50%);
        }
      }
      /* Snapping styles */
      .bitcoin-terminal.snapping {
        box-shadow: 0 0 6px var(--primary-color, ${theme.color}) !important;
        transition: box-shadow 0.2s ease;
      }

      .bitcoin-terminal.snapped {
        box-shadow: 0 0 4px var(--primary-color, ${theme.color}) !important;
      }
    `;

        document.head.appendChild(styleElement);
    }

    /**
     * Update the terminal clock
     */
    function updateClock() {
        try {
            const now = new Date(Date.now() + (serverTimeOffset || 0));
            // Use the global timezone setting if available
            const timeZone = window.dashboardTimezone || 'America/Los_Angeles';

            // Format the time in the configured timezone
            const timeString = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: timeZone
            });

            // Update clock in normal view
            const clockElement = document.getElementById(DOM_IDS.CLOCK);
            if (clockElement) {
                clockElement.textContent = timeString;
            }
        } catch (e) {
            log("Error updating clock: " + e.message, 'error');
        }
    }

    /**
     * Update the uptime display
     */
    function updateUptime() {
        if (serverStartTime) {
            try {
                const currentServerTime = Date.now() + serverTimeOffset;
                const diff = currentServerTime - serverStartTime;

                // Calculate hours, minutes, seconds
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);

                // Format numbers with leading zeros
                const formattedTime = {
                    hours: String(hours).padStart(2, '0'),
                    minutes: String(minutes).padStart(2, '0'),
                    seconds: String(seconds).padStart(2, '0')
                };

                // Update the main uptime display with digital clock style
                const elements = {
                    hours: document.getElementById(DOM_IDS.UPTIME_HOURS),
                    minutes: document.getElementById(DOM_IDS.UPTIME_MINUTES),
                    seconds: document.getElementById(DOM_IDS.UPTIME_SECONDS),
                    minimized: document.getElementById(DOM_IDS.MINIMIZED_UPTIME)
                };

                // Update each element if it exists
                if (elements.hours) elements.hours.textContent = formattedTime.hours;
                if (elements.minutes) elements.minutes.textContent = formattedTime.minutes;
                if (elements.seconds) elements.seconds.textContent = formattedTime.seconds;

                // Update the minimized uptime display
                if (elements.minimized) {
                    elements.minimized.textContent = `${formattedTime.hours}:${formattedTime.minutes}:${formattedTime.seconds}`;
                }
            } catch (e) {
                log("Error updating uptime: " + e.message, 'error');
            }
        }
    }

    /**
     * Start animation frame loop for smooth updates
     */
    function startAnimationLoop() {
        let lastUpdate = 0;
        const updateInterval = 1000; // Update every second

        function animationFrame(timestamp) {
            // Only update once per second to save resources
            if (timestamp - lastUpdate >= updateInterval) {
                updateClock();
                updateUptime();
                lastUpdate = timestamp;
            }

            // Continue the animation loop
            requestAnimationFrame(animationFrame);
        }

        // Start the loop
        requestAnimationFrame(animationFrame);
    }

    // Page handling and health data
    let currentPage = 0;
    let healthInterval = null;

    function showPage(index) {
        const pages = terminalElement ? terminalElement.querySelectorAll('.monitor-page') : [];
        if (!pages.length) return;
        currentPage = (index + pages.length) % pages.length;
        pages.forEach((p, i) => {
            p.style.display = i === currentPage ? 'block' : 'none';
        });
    }

    function nextPage() { showPage(currentPage + 1); }
    function prevPage() { showPage(currentPage - 1); }

    async function fetchHealth() {
        try {
            const resp = await fetch('/api/health');
            if (!resp.ok) return;
            const data = await resp.json();
            updateHealth(data);
        } catch (e) {
            log('Health fetch error: ' + e.message, 'error');
        }
    }

    function updateHealth(data) {
        if (!data) return;
        const memFill = document.getElementById(DOM_IDS.MEM_GAUGE);
        const memText = document.getElementById(DOM_IDS.MEM_TEXT);
        if (memFill && data.memory && data.memory.percent != null) {
            const pct = Math.round(data.memory.percent);
            memFill.style.width = pct + '%';
            if (memText) {
                const used = Math.round(data.memory.usage_mb);
                const total = data.memory.total_mb ? Math.round(data.memory.total_mb) : 0;
                memText.textContent = `${used}MB / ${total}MB (${pct}%)`;
            }
        }

        const connText = document.getElementById(DOM_IDS.CONN_TEXT);
        if (connText && typeof data.connections !== 'undefined') {
            connText.textContent = data.connections;
        }

        const schedStatus = document.getElementById(DOM_IDS.SCHED_STATUS);
        if (schedStatus) {
            const running = data.scheduler && data.scheduler.running ? 'RUNNING' : 'STOPPED';
            schedStatus.textContent = running;
            // Highlight scheduler status when healthy
            schedStatus.style.color = running === 'RUNNING' ? 'limegreen' : '#ffffff';
        }

        const schedLast = document.getElementById(DOM_IDS.SCHED_LAST);
        if (schedLast && data.scheduler && data.scheduler.last_successful_run) {
            const age = Math.floor((Date.now() - data.scheduler.last_successful_run * 1000) / 1000);
            schedLast.textContent = age + 's ago';
        }

        const dataAge = document.getElementById(DOM_IDS.DATA_AGE);
        if (dataAge && data.data && data.data.age_seconds != null) {
            dataAge.textContent = data.data.age_seconds + 's';
        }
    }

    /**
     * Notify other tabs that data has been refreshed
     */
    function notifyRefresh() {
        const now = Date.now();
        localStorage.setItem(STORAGE_KEY, now.toString());
        localStorage.setItem(STORAGE_KEYS.REFRESH_EVENT, 'refresh-' + now);
        log("Notified other tabs of refresh at " + new Date(now).toISOString());
    }

    /**
     * Initialize the uptime monitor
     */
    function initialize(refreshFunc) {
        // Store the refresh callback
        refreshCallback = refreshFunc;

        // Create the terminal element if it doesn't exist
        if (!document.getElementById(DOM_IDS.TERMINAL)) {
            createTerminalElement();
        } else {
            // Get references to existing elements
            terminalElement = document.getElementById(DOM_IDS.TERMINAL);
            uptimeElement = document.getElementById('uptime-timer');
        }

        // Apply theme colors
        applyThemeColor();

        // Set up listener for theme changes
        setupThemeChangeListener();

        // Try to get stored server time information
        try {
            serverTimeOffset = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_OFFSET) || '0');
            serverStartTime = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_START) || '0');
        } catch (e) {
            log("Error reading server time from localStorage: " + e.message, 'error');
        }

        // Clear any existing intervals
        if (uptimeInterval) {
            clearInterval(uptimeInterval);
        }

        // Use requestAnimationFrame for smoother animations
        startAnimationLoop();

        // Listen for storage events to sync across tabs
        window.removeEventListener('storage', handleStorageChange);
        window.addEventListener('storage', handleStorageChange);

        // Handle visibility changes
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Page controls
        const prevBtn = document.getElementById(DOM_IDS.PREV_BTN);
        const nextBtn = document.getElementById(DOM_IDS.NEXT_BTN);
        if (prevBtn) prevBtn.addEventListener('click', prevPage);
        if (nextBtn) nextBtn.addEventListener('click', nextPage);

        showPage(0);
        fetchHealth();
        if (healthInterval) clearInterval(healthInterval);
        healthInterval = setInterval(fetchHealth, 10000);

        // Mark as initialized
        isInitialized = true;

        log("Initialized");
    }

    /**
     * Handle storage changes for cross-tab synchronization
     */
    function handleStorageChange(event) {
        if (event.key === STORAGE_KEYS.REFRESH_EVENT) {
            log("Detected refresh from another tab");

            // If another tab refreshed, consider refreshing this one too
            // But don't refresh if it was just refreshed recently (5 seconds)
            const lastRefreshTime = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
            if (typeof refreshCallback === 'function' && Date.now() - lastRefreshTime > 5000) {
                refreshCallback();
            }
        } else if (event.key === STORAGE_KEYS.SERVER_OFFSET || event.key === STORAGE_KEYS.SERVER_START) {
            try {
                serverTimeOffset = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_OFFSET) || '0');
                serverStartTime = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_START) || '0');
            } catch (e) {
                log("Error reading updated server time: " + e.message, 'error');
            }
        } else if (event.key === STORAGE_KEYS.THEME) {
            // Update theme when theme preference changes
            applyThemeColor();
        }
    }

    /**
     * Handle visibility changes
     */
    function handleVisibilityChange() {
        if (!document.hidden) {
            log("Page became visible, updating");

            // Apply current theme when page becomes visible
            applyThemeColor();

            // Update immediately when page becomes visible
            updateClock();
            updateUptime();

            // Check if we need to do a refresh based on time elapsed
            if (typeof refreshCallback === 'function') {
                const lastRefreshTime = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
                if (Date.now() - lastRefreshTime > 60000) { // More than a minute since last refresh
                    refreshCallback();
                }
            }
        }
    }

    /**
     * Update server time information
     */
    function updateServerTime(timeOffset, startTime) {
        serverTimeOffset = timeOffset;
        serverStartTime = startTime;

        // Store in localStorage for cross-page sharing
        localStorage.setItem(STORAGE_KEYS.SERVER_OFFSET, serverTimeOffset.toString());
        localStorage.setItem(STORAGE_KEYS.SERVER_START, serverStartTime.toString());

        // Update the uptime immediately
        updateUptime();

        log("Server time updated - offset: " + serverTimeOffset + " ms");
    }

    /**
 * Toggle terminal collapsed state
 */
    function toggleTerminal() {
        if (!terminalElement) return;

        // Get the current state and snap point before toggling
        const wasCollapsed = terminalElement.classList.contains('collapsed');
        const currentSnapPoint = terminalElement.getAttribute('data-snap-point');

        // Toggle collapsed state
        terminalElement.classList.toggle('collapsed');
        localStorage.setItem(STORAGE_KEYS.COLLAPSED, terminalElement.classList.contains('collapsed'));

        // If we have a snap point, we need to handle the transition
        if (currentSnapPoint) {
            const isNowCollapsed = terminalElement.classList.contains('collapsed');
            const snapper = addSnappingBehavior();
            const mapping = snapper.getSnapPointMapping();

            // Since our snap point names match in both states,
            // we just need to save to the appropriate localStorage key
            if (isNowCollapsed) {
                localStorage.setItem(STORAGE_KEYS.COLLAPSED_SNAP_POINT, currentSnapPoint);
            } else {
                localStorage.setItem(STORAGE_KEYS.SNAP_POINT, currentSnapPoint);
            }

            // Apply position transition with slight delay to allow collapsed CSS to take effect
            setTimeout(() => {
                // Create smooth transition
                terminalElement.style.transition = 'all 0.3s ease-out';

                // Calculate the height-adjusted position
                const termHeight = terminalElement.offsetHeight;
                const termWidth = terminalElement.offsetWidth;
                const safeBottomY = window.innerHeight - termHeight - 20;
                const safeRightX = window.innerWidth - termWidth - 20;

                // Get snap point coordinates for new state
                const snapPoints = isNowCollapsed ? {
                    topLeft: { x: 20, y: 20 },
                    topRight: { x: safeRightX, y: 20 },
                    bottomLeft: { x: 20, y: safeBottomY },
                    bottomRight: { x: safeRightX, y: safeBottomY },
                    center: { x: (window.innerWidth - termWidth) / 2, y: 20 },
                    centerBottom: { x: (window.innerWidth - termWidth) / 2, y: safeBottomY }
                } : {
                    topLeft: { x: 20, y: 20 },
                    topRight: { x: safeRightX, y: 20 },
                    bottomLeft: { x: 20, y: safeBottomY },
                    bottomRight: { x: safeRightX, y: safeBottomY },
                    center: { x: (window.innerWidth - termWidth) / 2, y: 20 },
                    centerBottom: { x: (window.innerWidth - termWidth) / 2, y: safeBottomY }
                };

                // Move to newly sized position
                if (snapPoints[currentSnapPoint]) {
                    terminalElement.style.left = snapPoints[currentSnapPoint].x + 'px';
                    terminalElement.style.top = snapPoints[currentSnapPoint].y + 'px';
                    terminalElement.style.right = 'auto';
                    terminalElement.style.bottom = 'auto';

                    // The snap point stays the same, but we need to update its position
                    terminalElement.setAttribute('data-snap-point', currentSnapPoint);
                }

                // Remove transition after animation completes
                setTimeout(() => {
                    terminalElement.style.transition = '';
                }, STATE_TRANSITION_MS);
            }, STATE_TRANSITION_MS);
        }
    }

    /**
     * Hide the terminal and show the restore button
     */
    function hideTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'none';

        // Create show button if it doesn't exist
        if (!document.getElementById(DOM_IDS.SHOW_BUTTON)) {
            const showButton = document.createElement('button');
            showButton.id = DOM_IDS.SHOW_BUTTON;
            showButton.textContent = 'Show Monitor';
            showButton.onclick = showTerminal;
            document.body.appendChild(showButton);

            // Apply current theme to the button
            const theme = getThemeColors();
            showButton.style.backgroundColor = theme.color;
            showButton.style.boxShadow = `0 0 10px rgba(${theme.rgb}, 0.5)`;
        }

        document.getElementById(DOM_IDS.SHOW_BUTTON).style.display = 'block';
    }

    /**
     * Show the terminal and hide the restore button
     */
    function showTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'block';
        const showButton = document.getElementById(DOM_IDS.SHOW_BUTTON);
        if (showButton) {
            showButton.style.display = 'none';
        }
    }

    // Public API
    return {
        initialize: initialize,
        notifyRefresh: notifyRefresh,
        updateServerTime: updateServerTime,
        toggleTerminal: toggleTerminal,
        hideTerminal: hideTerminal,
        showTerminal: showTerminal,
        updateTheme: applyThemeColor
    };
})();

// Auto-initialize when document is ready
document.addEventListener('DOMContentLoaded', function () {
    // Check if manualRefresh function exists in global scope
    if (typeof window.manualRefresh === 'function') {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);
    } else {
        console.log("BitcoinMinuteRefresh: No refresh function found, will need to be initialized manually");
    }

    // Update theme based on current setting
    setTimeout(() => BitcoinMinuteRefresh.updateTheme(), 100);
});
