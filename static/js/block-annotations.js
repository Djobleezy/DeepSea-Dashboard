"use strict";

/**
 * block-annotations.js - Block annotation and day separator management for charts
 */

// Stored block annotations as ISO timestamp strings
let blockAnnotations = [];

function parseOldLabel(label, tz) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const offset = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getTime() - now;
    const parts = label.split(':');
    if (parts.length < 2) return null;
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    if (isNaN(hour) || isNaN(minute)) return null;
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    let ts = base.getTime() - offset;
    const diff = ts - now;
    if (diff > 12 * 60 * 60 * 1000) ts -= dayMs;
    else if (diff < -12 * 60 * 60 * 1000) ts += dayMs;
    return new Date(ts).toISOString();
}

function pruneBlockAnnotations(minutes = 180, maxEntries = 100) {
    const tz = window.dashboardTimezone || DEFAULT_TIMEZONE;
    const cutoff = Date.now() - minutes * 60 * 1000;

    try {
        blockAnnotations = blockAnnotations
            .map(ts => {
                if (typeof ts === 'string' && ts.match(/^\d{1,2}:\d{2}$/)) {
                    if (minutes > 1440) {
                        // Legacy entries without a date can't be mapped across days
                        return null;
                    }
                    return parseOldLabel(ts, tz);
                }
                return ts;
            })
            .filter(ts => {
                if (!ts) return false;
                const time = new Date(ts).getTime();
                return !isNaN(time) && time >= cutoff;
            });

        if (maxEntries && blockAnnotations.length > maxEntries) {
            blockAnnotations.splice(0, blockAnnotations.length - maxEntries);
        }
    } catch (e) {
        console.error('Error pruning block annotations', e);
        blockAnnotations = [];
    }
}

function clearBlockAnnotations() {
    blockAnnotations = [];
    try {
        localStorage.removeItem('blockAnnotations');
    } catch (e) {
        console.error('Error clearing block annotations', e);
    }
    if (trendChart) {
        updateBlockAnnotations(trendChart);
        trendChart.update('none');
    }
}

window.clearBlockAnnotations = clearBlockAnnotations;

function loadBlockAnnotations(minutes = 180, maxEntries = 100) {
    if (!isFinite(minutes)) {
        minutes = 43200; // 30 days fallback when requesting all data
    }
    const tz = window.dashboardTimezone || DEFAULT_TIMEZONE;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    // Compute cutoff based on requested minutes
    const cutoff = Date.now() - minutes * 60 * 1000;

    try {
        const stored = localStorage.getItem('blockAnnotations');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    blockAnnotations = parsed.map(item => {
                        if (typeof item === 'string' && item.match(/^\d{1,2}:\d{2}$/)) {
                            return parseOldLabel(item, tz);
                        }
                        return item;
                    });
                }
            }
    } catch (e) {
        console.error('Error loading block annotations', e);
        blockAnnotations = [];
    }

    pruneBlockAnnotations(minutes, maxEntries);

    // Fetch past block events from the server and merge with stored annotations
    fetch(`/api/block-events?minutes=${minutes}`)
        .then(resp => resp.json())
        .then(data => {
            if (data && Array.isArray(data.events)) {
                data.events.forEach(ev => {
                    try {
                        const d = new Date(ev.timestamp);
                        if (d.getTime() < cutoff) return;
                        const iso = d.toISOString();
                        if (!blockAnnotations.includes(iso)) {
                            blockAnnotations.push(iso);
                        }
                    } catch (err) {
                        console.error('Error processing block event', err);
                    }
                });
                saveBlockAnnotations(minutes);
                if (trendChart) {
                    updateBlockAnnotations(trendChart);
                    trendChart.update('none');
                }
            }
        })
        .catch(err => console.error('Error fetching block events', err));
}

function saveBlockAnnotations(minutes = 180, maxEntries = 100) {
    pruneBlockAnnotations(minutes, maxEntries);
    try {
        localStorage.setItem('blockAnnotations', JSON.stringify(blockAnnotations));
    } catch (e) {
        console.error('Error saving block annotations', e);
    }
}

function updateBlockAnnotations(chart) {
    if (!chart || !chart.options) return;
    if (!chart.options.plugins) chart.options.plugins = {};
    if (!chart.options.plugins.annotation) chart.options.plugins.annotation = { annotations: {} };

    let anns = chart.options.plugins.annotation.annotations;
    if (!anns) {
        anns = {};
        chart.options.plugins.annotation.annotations = anns;
    }

    Object.keys(anns).forEach(key => {
        if (key.startsWith('blockEvent')) delete anns[key];
    });

    const theme = getCurrentTheme();
    const tz = window.dashboardTimezone || DEFAULT_TIMEZONE;
    const useExtendedLabels = chart.data && Array.isArray(chart.data.labels) &&
        chart.data.labels.some(lbl => lbl.includes(',') || lbl.includes('\n'));
    const formatter = new Intl.DateTimeFormat('en-US', useExtendedLabels ? {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    } : {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const validLabels = chart.data && Array.isArray(chart.data.labels)
        ? new Set(chart.data.labels)
        : new Set();
    let idx = 0;
    blockAnnotations.forEach(ts => {
        let label = formatter.format(new Date(ts)).replace(/\s[AP]M$/i, '');
        if (useExtendedLabels) {
            const parts = label.split(', ');
            label = `${parts[0]}\n${parts[1]}`;
        }
        if (!validLabels.has(label)) return;
        anns['blockEvent' + idx] = {
            type: 'line',
            xMin: label,
            xMax: label,
            borderColor: theme.CHART.BLOCK_EVENT,
            borderWidth: 2,
            borderDash: [4, 2],
            label: {
                enabled: true,
                content: label,
                backgroundColor: 'rgba(0,0,0,0.8)',
                color: theme.CHART.BLOCK_EVENT,
                font: {
                    family: "'VT323', monospace",
                    size: 16,
                    weight: 'bold'
                },
                padding: { top: 4, bottom: 4, left: 8, right: 8 },
                borderRadius: 0,
                position: 'start'
            }
        };
        idx++;
    });
}

function updateDaySeparators(chart, labelTimestamps) {
    if (!chart || !chart.options || !Array.isArray(labelTimestamps)) return;

    if (!chart.options.plugins) chart.options.plugins = {};
    if (!chart.options.plugins.annotation) {
        chart.options.plugins.annotation = { annotations: {} };
    }

    const anns = chart.options.plugins.annotation.annotations || {};
    Object.keys(anns).forEach(key => {
        if (key.startsWith('daySeparator')) delete anns[key];
    });

    if (labelTimestamps.length <= 1440) {
        return;
    }

    const theme = getCurrentTheme();
    const formatter = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric'
    });

    let lastDay = labelTimestamps[labelTimestamps.length - 1].getDate();
    let sepIdx = 0;

    for (let i = labelTimestamps.length - 2; i >= 0; i--) {
        const ts = labelTimestamps[i];
        const currentDay = ts.getDate();
        if (currentDay !== lastDay) {
            anns['daySeparator' + sepIdx] = {
                type: 'line',
                xMin: i + 1,
                xMax: i + 1,
                borderColor: theme.CHART.DAY_SEPARATOR,
                borderWidth: 1,
                borderDash: [2, 2],
                label: {
                    enabled: true,
                    content: formatter.format(labelTimestamps[i + 1]),
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    color: theme.CHART.DAY_SEPARATOR,
                    font: {
                        family: "'VT323', monospace",
                        size: 14,
                        weight: 'bold'
                    },
                    padding: { top: 4, bottom: 4, left: 6, right: 6 },
                    borderRadius: 0,
                    position: 'start'
                }
            };
            sepIdx++;
            lastDay = currentDay;
        }
    }
}
