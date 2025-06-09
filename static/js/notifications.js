"use strict";

// Global variables
let currentFilter = "all";
let currentOffset = 0;
const pageSize = 20;
let hasMoreNotifications = true;
let isLoading = false;

// Timezone configuration
let dashboardTimezone = 'America/Los_Angeles'; // Default
window.dashboardTimezone = dashboardTimezone; // Make it globally accessible

// Initialize when document is ready
$(document).ready(() => {
    console.log("Notification page initializing...");

    // Fetch timezone configuration
    fetchTimezoneConfig();

    // Set up filter buttons
    $('.filter-button').click(function () {
        $('.filter-button').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        resetAndLoadNotifications();
    });

    // Set up action buttons
    $('#mark-all-read').click(markAllAsRead);
    $('#clear-read').click(clearReadNotifications);
    $('#clear-all').click(clearAllNotifications);
    $('#load-more').click(loadMoreNotifications);

    // Initial load of notifications
    loadNotifications();

    // Start polling for unread count
    startUnreadCountPolling();

    // Initialize BitcoinMinuteRefresh if available
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
        BitcoinMinuteRefresh.initialize(refreshNotifications);
        console.log("BitcoinMinuteRefresh initialized with refresh function");
    }

    // Start periodic update of notification timestamps every 30 seconds
    setInterval(updateNotificationTimestamps, 30000);
});

// Fetch timezone configuration from server
function fetchTimezoneConfig() {
    return fetch('/api/timezone')
        .then(response => response.json())
        .then(data => {
            if (data && data.timezone) {
                dashboardTimezone = data.timezone;
                window.dashboardTimezone = dashboardTimezone; // Make it globally accessible
                console.log(`Notifications page using timezone: ${dashboardTimezone}`);

                // Store in localStorage for future use
                try {
                    localStorage.setItem('dashboardTimezone', dashboardTimezone);
                } catch (e) {
                    console.error("Error storing timezone in localStorage:", e);
                }

                // Update all timestamps with the new timezone
                updateNotificationTimestamps();
                return dashboardTimezone;
            }
        })
        .catch(error => {
            console.error('Error fetching timezone config:', error);
            return null;
        });
}

// Load notifications with current filter
function loadNotifications() {
    if (isLoading) return;

    isLoading = true;
    showLoading();

    const params = {
        limit: pageSize,
        offset: currentOffset
    };

    if (currentFilter !== "all") {
        params.category = currentFilter;
    }

    $.ajax({
        url: `/api/notifications?${$.param(params)}`,
        method: "GET",
        dataType: "json",
        success: (data) => {
            renderNotifications(data.notifications, currentOffset === 0);
            updateUnreadBadge(data.unread_count);

            // Update load more button state
            hasMoreNotifications = data.notifications.length === pageSize;
            $('#load-more').prop('disabled', !hasMoreNotifications);

            isLoading = false;
        },
        error: (xhr, status, error) => {
            console.error("Error loading notifications:", error);
            showError("Failed to load notifications. Please try again.");
            isLoading = false;
        }
    });
}

// Reset offset and load notifications
function resetAndLoadNotifications() {
    currentOffset = 0;
    loadNotifications();
}

// Load more notifications
function loadMoreNotifications() {
    if (!hasMoreNotifications || isLoading) return;

    currentOffset += pageSize;
    loadNotifications();
}

// Refresh notifications (for periodic updates)
function refreshNotifications() {
    // Only refresh if we're on the first page
    if (currentOffset === 0) {
        resetAndLoadNotifications();
    } else {
        // Just update the unread count
        updateUnreadCount();
    }
}

// This refreshes all timestamps on the page periodically
function updateNotificationTimestamps() {
    $('.notification-item').each(function () {
        const timestampStr = $(this).attr('data-timestamp');
        if (timestampStr) {
            try {
                const timestamp = new Date(timestampStr);

                // Update relative time
                $(this).find('.notification-time').text(formatTimestamp(timestamp));

                // Update full timestamp with configured timezone
                if ($(this).find('.full-timestamp').length) {
                    const options = {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                        timeZone: window.dashboardTimezone || 'America/Los_Angeles'
                    };

                    const fullTimestamp = timestamp.toLocaleString('en-US', options);
                    $(this).find('.full-timestamp').text(fullTimestamp);
                }
            } catch (e) {
                console.error("Error updating timestamp:", e, timestampStr);
            }
        }
    });
}

// Show loading indicator
function showLoading() {
    if (currentOffset === 0) {
        // First page load, show loading message
        $('#notifications-container').html('<div class="loading-message">Loading notifications<span class="terminal-cursor"></span></div>');
    } else {
        // Pagination load, show loading below
        $('#load-more').prop('disabled', true).text('Loading...');
    }
}

// Show error message
function showError(message) {
    $('#notifications-container').html(`<div class="error-message">${message}</div>`);
    $('#load-more').hide();
}

// Render notifications in the container
function renderNotifications(notifications, isFirstPage) {
    const container = $('#notifications-container');

    // If first page and no notifications
    if (isFirstPage && (!notifications || notifications.length === 0)) {
        container.html($('#empty-template').html());
        $('#load-more').hide();
        return;
    }

    // If first page, clear container
    if (isFirstPage) {
        container.empty();
    }

    // Render each notification
    notifications.forEach(notification => {
        const notificationElement = createNotificationElement(notification);
        container.append(notificationElement);
    });

    // Show/hide load more button
    $('#load-more').show().prop('disabled', !hasMoreNotifications);
}

// Create notification element from template
function createNotificationElement(notification) {
    const template = $('#notification-template').html();
    const element = $(template);

    // Set data attributes
    element.attr('data-id', notification.id)
        .attr('data-level', notification.level)
        .attr('data-category', notification.category)
        .attr('data-read', notification.read)
        .attr('data-timestamp', notification.timestamp);

    // Set icon based on level
    const iconElement = element.find('.notification-icon i');
    switch (notification.level) {
        case 'success':
            iconElement.addClass('fa-check-circle');
            break;
        case 'info':
            iconElement.addClass('fa-info-circle');
            break;
        case 'warning':
            iconElement.addClass('fa-exclamation-triangle');
            break;
        case 'error':
            iconElement.addClass('fa-times-circle');
            break;
        default:
            iconElement.addClass('fa-bell');
    }

    // Important: Do not append "Z" here, as that can cause timezone issues
    // Create a date object from the notification timestamp
    let notificationDate;
    try {
        // Parse the timestamp directly without modifications
        notificationDate = new Date(notification.timestamp);

        // Validate the date object - if invalid, try alternative approach
        if (isNaN(notificationDate.getTime())) {
            console.warn("Invalid date from notification timestamp, trying alternative format");

            // Try adding Z to make it explicit UTC if not already ISO format
            if (!notification.timestamp.endsWith('Z') && !notification.timestamp.includes('+')) {
                notificationDate = new Date(notification.timestamp + 'Z');
            }
        }
    } catch (e) {
        console.error("Error parsing notification date:", e);
        notificationDate = new Date(); // Fallback to current date
    }

    // Format the timestamp using the configured timezone
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: window.dashboardTimezone || 'America/Los_Angeles'
    };

    // Format full timestamp with configured timezone
    let fullTimestamp;
    try {
        fullTimestamp = notificationDate.toLocaleString('en-US', options);
    } catch (e) {
        console.error("Error formatting timestamp with timezone:", e);
        fullTimestamp = notificationDate.toLocaleString('en-US'); // Fallback without timezone
    }

    // Append the message and formatted timestamp using text() to avoid XSS
    const msgElem = element.find('.notification-message');
    msgElem.text(notification.message);
    msgElem.append(`<br><span class="full-timestamp">${fullTimestamp}</span>`);

    // Set metadata for relative time display
    element.find('.notification-time').text(formatTimestamp(notificationDate));
    element.find('.notification-category').text(notification.category);

    // Set up action buttons
    element.find('.mark-read-button').on('click', (e) => {
        e.stopPropagation();
        markAsRead(notification.id);
    });
    element.find('.delete-button').on('click', (e) => {
        e.stopPropagation();
        deleteNotification(notification.id);
    });

    // Hide delete button for block notifications
    if (notification.category === 'block') {
        element.find('.delete-button').hide();
    }

    // Hide mark as read button if already read
    if (notification.read) {
        element.find('.mark-read-button').hide();
    }

    return element;
}

function formatTimestamp(timestamp) {
    // Ensure we have a valid date object
    let dateObj = timestamp;
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
        try {
            dateObj = new Date(timestamp);
        } catch (e) {
            console.error("Invalid timestamp in formatTimestamp:", e);
            return "unknown time";
        }
    }

    // Calculate time difference in local timezone context
    const now = new Date();
    const diffMs = now - dateObj;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
        return "just now";
    } else if (diffMin < 60) {
        return `${diffMin}m ago`;
    } else if (diffHour < 24) {
        return `${diffHour}h ago`;
    } else if (diffDay < 30) {
        return `${diffDay}d ago`;
    } else {
        // Format as date for older notifications using configured timezone
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: window.dashboardTimezone || 'America/Los_Angeles'
        };
        return dateObj.toLocaleDateString('en-US', options);
    }
}

// Mark a notification as read
function markAsRead(notificationId) {
    $.ajax({
        url: "/api/notifications/mark_read",
        method: "POST",
        data: JSON.stringify({ notification_id: notificationId }),
        contentType: "application/json",
        success: (data) => {
            // Update UI
            $(`[data-id="${notificationId}"]`).attr('data-read', 'true');
            $(`[data-id="${notificationId}"]`).find('.mark-read-button').hide();

            // Update unread badge
            updateUnreadBadge(data.unread_count);
        },
        error: (xhr, status, error) => {
            console.error("Error marking notification as read:", error);
        }
    });
}

// Mark all notifications as read
function markAllAsRead() {
    $.ajax({
        url: "/api/notifications/mark_read",
        method: "POST",
        data: JSON.stringify({}),
        contentType: "application/json",
        success: (data) => {
            // Update UI
            $('.notification-item').attr('data-read', 'true');
            $('.mark-read-button').hide();

            // Update unread badge
            updateUnreadBadge(0);
        },
        error: (xhr, status, error) => {
            console.error("Error marking all notifications as read:", error);
        }
    });
}

// Delete a notification
function deleteNotification(notificationId) {
    $.ajax({
        url: "/api/notifications/delete",
        method: "POST",
        data: JSON.stringify({ notification_id: notificationId }),
        contentType: "application/json",
        success: (data) => {
            // Remove from UI with animation
            $(`[data-id="${notificationId}"]`).fadeOut(300, function () {
                $(this).remove();

                // Check if container is empty now
                if ($('#notifications-container').children().length === 0) {
                    $('#notifications-container').html($('#empty-template').html());
                    $('#load-more').hide();
                }
            });

            // Update unread badge
            updateUnreadBadge(data.unread_count);
        },
        error: (xhr, status, error) => {
            console.error("Error deleting notification:", error);
        }
    });
}

// Clear read notifications
function clearReadNotifications() {
    if (!confirm("Are you sure you want to clear all read notifications?")) {
        return;
    }

    $.ajax({
        url: "/api/notifications/clear",
        method: "POST",
        data: JSON.stringify({
            // Special parameter to clear only read notifications
            read_only: true
        }),
        contentType: "application/json",
        success: () => {
            // Reload notifications
            resetAndLoadNotifications();
        },
        error: (xhr, status, error) => {
            console.error("Error clearing read notifications:", error);
        }
    });
}

// Clear all notifications
function clearAllNotifications() {
    if (!confirm("Are you sure you want to clear ALL notifications? This cannot be undone.")) {
        return;
    }

    $.ajax({
        url: "/api/notifications/clear",
        method: "POST",
        data: JSON.stringify({}),
        contentType: "application/json",
        success: () => {
            // Reload notifications
            resetAndLoadNotifications();
        },
        error: (xhr, status, error) => {
            console.error("Error clearing all notifications:", error);
        }
    });
}

// Update unread badge
function updateUnreadBadge(count) {
    $('#unread-badge').text(count);

    // Add special styling if unread
    if (count > 0) {
        $('#unread-badge').addClass('has-unread');
    } else {
        $('#unread-badge').removeClass('has-unread');
    }
}

// Update unread count from API
function updateUnreadCount() {
    $.ajax({
        url: "/api/notifications/unread_count",
        method: "GET",
        success: (data) => {
            updateUnreadBadge(data.unread_count);
        },
        error: (xhr, status, error) => {
            console.error("Error updating unread count:", error);
        }
    });
}

// Start polling for unread count
function startUnreadCountPolling() {
    // Update every 30 seconds
    setInterval(updateUnreadCount, 30000);
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